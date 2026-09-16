/*
# Lock down venue partner billing integrity

## Two holes, both of which invalidate the partner product

1. `venue_events` grants INSERT with `WITH CHECK (true)` to every authenticated
   user. That table is the billing signal — spend is `visits × visit_rate_cents`.
   Any signed-in account can therefore forge unlimited `visited` rows against
   any venue, draining a competitor's budget, or forge `impression`/`saved`
   rows to inflate their own dashboard. Until this is closed, no number shown
   to a partner is defensible and nothing should be billed from it.

2. `update_own_venue_partners` permits updating any column of one's own row,
   including `approved` and `visit_rate_cents`. A partner can self-approve past
   admin review, or set their own per-visit rate to zero. The client's
   TypeScript signature omits those fields, but a type is not a permission.

## Approach
Events: a user may record at most one event of a given type per venue per day,
and may never attribute an event to a venue they own. This keeps honest
client-side tracking working while removing the ability to manufacture volume.
Genuine server-side attribution belongs with the billing work in M07; this is
the containment step.

Privileged columns: enforced by trigger rather than policy, because Postgres
RLS cannot express per-column restrictions on UPDATE.
*/

-- ════════════════════════════════════════════════════════════
-- 1. VENUE_EVENTS — no more forged billing signal
-- ════════════════════════════════════════════════════════════

/*
The eligibility check must be SECURITY DEFINER. venue_partners is itself
protected by `select_own_venue_partners` (owner-only), so an EXISTS subquery
written directly into the policy runs under the *inserting* user's RLS and
sees zero rows for any venue they do not own — which is every venue they are
allowed to record an event for. The policy would then deny every honest event
while still being trivially satisfiable in tests run as a superuser.
*/
CREATE OR REPLACE FUNCTION venue_accepts_events(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM venue_partners vp
    WHERE vp.id = p_venue_id
      AND vp.approved = true
      AND vp.active = true
      -- A partner may never generate their own metrics.
      AND vp.owner_id <> auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION venue_accepts_events(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION venue_accepts_events(uuid) TO authenticated;

DROP POLICY IF EXISTS "insert_venue_events" ON venue_events;

CREATE POLICY "insert_venue_events" ON venue_events FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_uid = auth.uid()
    AND venue_accepts_events(venue_id)
  );

/*
One event per (user, venue, type, day). Without this, the policy above still
allows a single account to insert the same event thousands of times.
*/
/*
Adding a UNIQUE index to a populated table aborts if duplicates already exist,
which would fail the whole migration. Collapse any pre-existing duplicates to
the earliest row per group first. In practice recordVenueEvent() has no call
sites, so this is expected to be a no-op — it is here so the migration is safe
regardless of what the table actually holds.
*/
DELETE FROM venue_events a
USING venue_events b
WHERE a.auth_uid IS NOT NULL
  AND b.auth_uid IS NOT NULL
  AND a.venue_id = b.venue_id
  AND a.auth_uid = b.auth_uid
  AND a.event_type = b.event_type
  AND (a.created_at AT TIME ZONE 'UTC')::date = (b.created_at AT TIME ZONE 'UTC')::date
  AND a.ctid > b.ctid;

-- created_at::date is STABLE (it depends on the session TimeZone), and index
-- expressions must be IMMUTABLE. Pinning the zone explicitly makes it so.
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_events_one_per_user_day
  ON venue_events (venue_id, auth_uid, event_type, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE auth_uid IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- 2. VENUE_PARTNERS — privileged columns are not self-writable
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION protect_venue_partner_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The service role (admin tooling, billing jobs) bypasses this entirely.
  IF current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.approved IS DISTINCT FROM OLD.approved THEN
    RAISE EXCEPTION 'approved is set by review, not by the venue owner';
  END IF;

  IF NEW.visit_rate_cents IS DISTINCT FROM OLD.visit_rate_cents THEN
    RAISE EXCEPTION 'visit_rate_cents is set by agreement, not by the venue owner';
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id cannot be reassigned';
  END IF;

  IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    RAISE EXCEPTION 'stripe_customer_id is managed by billing';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_venue_partner_columns ON venue_partners;
CREATE TRIGGER trg_protect_venue_partner_columns
  BEFORE UPDATE ON venue_partners
  FOR EACH ROW
  EXECUTE FUNCTION protect_venue_partner_privileged_columns();

-- ════════════════════════════════════════════════════════════
-- 3. SPEND, COMPUTED SERVER-SIDE
-- ════════════════════════════════════════════════════════════

/*
The portal currently fetches up to 500 event rows and aggregates them in the
browser, so any venue past 500 lifetime events is billed on truncated data and
the arithmetic runs where the user can reach it. This aggregates in SQL over
the full table and is readable only by the venue's owner.
*/
CREATE OR REPLACE FUNCTION get_venue_event_stats(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rate int;
  v_result jsonb;
BEGIN
  SELECT visit_rate_cents INTO v_rate
  FROM venue_partners
  WHERE id = p_venue_id AND owner_id = auth.uid();

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Venue not found';
  END IF;

  SELECT jsonb_build_object(
    'impressions', COUNT(*) FILTER (WHERE event_type = 'impression'),
    'saves',       COUNT(*) FILTER (WHERE event_type = 'saved'),
    'visits',      COUNT(*) FILTER (WHERE event_type = 'visited'),
    'thisMonthVisits', COUNT(*) FILTER (
      WHERE event_type = 'visited' AND created_at >= date_trunc('month', now())
    ),
    'thisMonthSpendCents', COUNT(*) FILTER (
      WHERE event_type = 'visited' AND created_at >= date_trunc('month', now())
    ) * v_rate
  ) INTO v_result
  FROM venue_events
  WHERE venue_id = p_venue_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_venue_event_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_venue_event_stats(uuid) TO authenticated;
