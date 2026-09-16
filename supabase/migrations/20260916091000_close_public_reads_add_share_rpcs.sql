/*
# Close public reads on plans/stops/rsvps/trips, move sharing to explicit RPCs

## The problem
Every one of these tables grants `SELECT ... USING (true)` to `anon`. The anon
key ships inside the browser bundle, so anyone can enumerate the entire
database: every plan title, venue address, date, time, and the names of guests
who never signed up for anything. `stops` and `rsvps` additionally had INSERT
re-opened to `WITH CHECK (true)` by migration 20260810113215, which undid part
of the earlier lockdown, and `trips`/`stop_rsvps` were never locked at all.

## Why sharing still works afterwards
`share_link` is `/plan/<uuid>` — the plan id IS the capability. A v4 UUID has
122 bits of entropy, so possession of the link is already proof of access. What
was missing was any requirement to *present* it: `USING (true)` let callers
read rows they could not name. The RPCs below require the exact id, so every
share link in the wild keeps working and enumeration stops. No tokens are
re-issued and no existing link breaks.

## Model after this migration
- Direct table access: owners only, via the x-user-id request header.
- Guest access: SECURITY DEFINER functions that take an explicit id.
- Guest writes: RPCs that validate the parent row, instead of open INSERT.

Ownership still rides the spoofable x-user-id header. That is deliberate for
this migration — moving to auth.uid() is its own milestone, and doing both at
once would make a failed rollout impossible to diagnose.
*/

-- ════════════════════════════════════════════════════════════
-- 0. THE OWNERSHIP HELPER — and a bug it fixes
-- ════════════════════════════════════════════════════════════

/*
Every existing ownership policy reads the device id as:

    app_request_device_id()

That expression can never return a value. Postgres rejects
`request.header.x-user-id` as a configuration parameter name outright —
"custom parameter names must be two or more simple identifiers separated by
dots", and `x-user-id` contains hyphens. Nothing can set it, so
current_setting(..., missing_ok => true) returns NULL on every request, every
policy comparing against it evaluates to NULL, and NULL is not TRUE.

The practical effect is that the August lockdown did not scope ownership; it
denied every UPDATE and DELETE to everyone, including owners. Reads stayed open
only because those policies were plain USING (true).

PostgREST exposes headers as a single JSON GUC named `request.headers`, which
is a legal parameter name. This helper reads it correctly and becomes the one
place ownership is defined — so the move to auth.uid() in the identity
milestone is a change to this function rather than to fifteen policies.
*/
CREATE OR REPLACE FUNCTION app_request_device_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw text;
BEGIN
  v_raw := current_setting('request.headers', true);
  IF v_raw IS NULL OR v_raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN NULLIF(v_raw::json ->> 'x-user-id', '');
EXCEPTION WHEN others THEN
  -- Malformed header payload must deny, never error the whole query.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_request_device_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_request_device_id() TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- 1. PLANS — owner-only direct access
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "public_select_plans" ON plans;
DROP POLICY IF EXISTS "public_insert_plans" ON plans;

CREATE POLICY "owner_select_plans" ON plans FOR SELECT
  TO anon, authenticated
  USING (user_id = app_request_device_id());

CREATE POLICY "owner_insert_plans" ON plans FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id = app_request_device_id());

-- ════════════════════════════════════════════════════════════
-- 2. STOPS — owner-only, and INSERT re-closed
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "public_select_stops" ON stops;
DROP POLICY IF EXISTS "public_insert_stops" ON stops;

CREATE POLICY "owner_select_stops" ON stops FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = stops.plan_id
        AND plans.user_id = app_request_device_id()
    )
  );

CREATE POLICY "owner_insert_stops" ON stops FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = stops.plan_id
        AND plans.user_id = app_request_device_id()
    )
  );

-- ════════════════════════════════════════════════════════════
-- 3. RSVPS — owner-only reads; guest writes go through submit_plan_rsvp
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "public_select_rsvps" ON rsvps;
DROP POLICY IF EXISTS "public_insert_rsvps" ON rsvps;

CREATE POLICY "owner_select_rsvps" ON rsvps FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = rsvps.plan_id
        AND plans.user_id = app_request_device_id()
    )
  );

-- ════════════════════════════════════════════════════════════
-- 4. TRIPS + STOP_RSVPS — never locked down until now
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "public_select_trips" ON trips;
DROP POLICY IF EXISTS "public_insert_trips" ON trips;

CREATE POLICY "owner_select_trips" ON trips FOR SELECT
  TO anon, authenticated
  USING (user_id = app_request_device_id());

CREATE POLICY "owner_insert_trips" ON trips FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id = app_request_device_id());

DROP POLICY IF EXISTS "public_select_stop_rsvps" ON stop_rsvps;
DROP POLICY IF EXISTS "public_insert_stop_rsvps" ON stop_rsvps;

CREATE POLICY "owner_select_stop_rsvps" ON stop_rsvps FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = stop_rsvps.plan_id
        AND plans.user_id = app_request_device_id()
    )
  );

-- ════════════════════════════════════════════════════════════
-- 5. SHARE READ RPCS
-- ════════════════════════════════════════════════════════════

/*
Returns a plan with its stops and RSVPs for anyone presenting the plan id.
Canceled plans are still returned so the guest page can say so explicitly
rather than showing a dead end.
*/
CREATE OR REPLACE FUNCTION get_shared_plan(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan jsonb;
  v_stops jsonb;
  v_rsvps jsonb;
BEGIN
  -- user_id is stripped: under the x-user-id model it IS the ownership
  -- credential, so returning it to a guest would let them impersonate the host.
  SELECT to_jsonb(p) - 'user_id' INTO v_plan FROM plans p WHERE p.id = p_plan_id;
  IF v_plan IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg((to_jsonb(s) - 'user_id') ORDER BY s.sort_order), '[]'::jsonb)
    INTO v_stops FROM stops s WHERE s.plan_id = p_plan_id;

  -- Guest-visible RSVP list: names and status only. decline_reason and the
  -- owner columns stay private to the host.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', r.id, 'plan_id', r.plan_id, 'name', r.name,
                         'status', r.status, 'created_at', r.created_at)
      ORDER BY r.created_at
    ), '[]'::jsonb)
    INTO v_rsvps FROM rsvps r WHERE r.plan_id = p_plan_id;

  RETURN jsonb_build_object('plan', v_plan, 'stops', v_stops, 'rsvps', v_rsvps);
END;
$$;

/* Trip equivalent: the trip, its days, each day's stops, and per-stop RSVPs. */
CREATE OR REPLACE FUNCTION get_shared_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trip jsonb;
  v_days jsonb;
  v_stops jsonb;
  v_stop_rsvps jsonb;
BEGIN
  -- Same reasoning as get_shared_plan: never expose user_id.
  SELECT to_jsonb(t) - 'user_id' INTO v_trip FROM trips t WHERE t.id = p_trip_id;
  IF v_trip IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg((to_jsonb(p) - 'user_id') ORDER BY p.day_number), '[]'::jsonb)
    INTO v_days FROM plans p WHERE p.trip_id = p_trip_id;

  SELECT COALESCE(jsonb_agg((to_jsonb(s) - 'user_id') ORDER BY s.sort_order), '[]'::jsonb)
    INTO v_stops
    FROM stops s
    WHERE s.plan_id IN (SELECT id FROM plans WHERE trip_id = p_trip_id);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', sr.id, 'stop_id', sr.stop_id, 'plan_id', sr.plan_id,
                         'trip_id', sr.trip_id, 'name', sr.name, 'status', sr.status,
                         'created_at', sr.created_at)
      ORDER BY sr.created_at
    ), '[]'::jsonb)
    INTO v_stop_rsvps FROM stop_rsvps sr WHERE sr.trip_id = p_trip_id;

  RETURN jsonb_build_object('trip', v_trip, 'days', v_days,
                            'stops', v_stops, 'stop_rsvps', v_stop_rsvps);
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 6. GUEST WRITE RPCS
-- ════════════════════════════════════════════════════════════

/*
Replaces open INSERT on rsvps. The parent plan must exist and not be canceled,
the name is length-bounded, and status is constrained here rather than trusted.
*/
CREATE OR REPLACE FUNCTION submit_plan_rsvp(
  p_plan_id uuid,
  p_name text,
  p_status text,
  p_decline_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text := btrim(p_name);
  v_plan plans%ROWTYPE;
  v_row rsvps%ROWTYPE;
BEGIN
  IF v_name = '' OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'A name between 1 and 80 characters is required';
  END IF;
  IF p_status NOT IN ('in', 'declined', 'pending') THEN
    RAISE EXCEPTION 'Invalid RSVP status';
  END IF;

  SELECT * INTO v_plan FROM plans WHERE id = p_plan_id;
  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;
  IF COALESCE(v_plan.canceled, false) THEN
    RAISE EXCEPTION 'This plan has been canceled';
  END IF;

  INSERT INTO rsvps (plan_id, name, status, decline_reason, user_id, auth_uid)
  VALUES (
    p_plan_id, v_name, p_status,
    CASE WHEN p_status = 'declined' THEN left(COALESCE(p_decline_reason, ''), 500) ELSE NULL END,
    v_plan.user_id,
    auth.uid()
  )
  RETURNING * INTO v_row;

  -- Strip user_id: the guest must not learn the host's ownership key.
  RETURN to_jsonb(v_row) - 'user_id';
END;
$$;

/*
Replaces open INSERT on stop_rsvps, preserving the existing
update-if-(stop,name)-exists behaviour.
*/
CREATE OR REPLACE FUNCTION submit_stop_rsvp(
  p_stop_id uuid,
  p_name text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text := btrim(p_name);
  v_stop stops%ROWTYPE;
  v_plan plans%ROWTYPE;
  v_row stop_rsvps%ROWTYPE;
BEGIN
  IF v_name = '' OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'A name between 1 and 80 characters is required';
  END IF;
  IF p_status NOT IN ('in', 'out', 'pending') THEN
    RAISE EXCEPTION 'Invalid RSVP status';
  END IF;

  SELECT * INTO v_stop FROM stops WHERE id = p_stop_id;
  IF v_stop.id IS NULL THEN
    RAISE EXCEPTION 'Stop not found';
  END IF;

  SELECT * INTO v_plan FROM plans WHERE id = v_stop.plan_id;
  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  UPDATE stop_rsvps
     SET status = p_status
   WHERE stop_id = p_stop_id AND name = v_name
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    INSERT INTO stop_rsvps (stop_id, plan_id, trip_id, name, status, user_id, auth_uid)
    VALUES (p_stop_id, v_stop.plan_id, v_plan.trip_id, v_name, p_status, v_plan.user_id, auth.uid())
    RETURNING * INTO v_row;
  END IF;

  -- Strip user_id: the guest must not learn the host's ownership key.
  RETURN to_jsonb(v_row) - 'user_id';
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 7. GRANTS — these four are the only public doors left
-- ════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION get_shared_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_shared_trip(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_plan_rsvp(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_stop_rsvp(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_shared_plan(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_shared_trip(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_plan_rsvp(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_stop_rsvp(uuid, text, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- 8. REPAIR THE PRE-EXISTING UPDATE/DELETE POLICIES
-- ════════════════════════════════════════════════════════════

/*
These were written against the same unusable GUC, so they currently deny every
write to everyone rather than scoping it to the owner. Repointing them at
app_request_device_id() makes them do what their names have always claimed.
*/

-- plans
DROP POLICY IF EXISTS "owner_update_plans" ON plans;
CREATE POLICY "owner_update_plans" ON plans FOR UPDATE
  TO anon, authenticated
  USING (user_id = app_request_device_id())
  WITH CHECK (user_id = app_request_device_id());

DROP POLICY IF EXISTS "owner_delete_plans" ON plans;
CREATE POLICY "owner_delete_plans" ON plans FOR DELETE
  TO anon, authenticated
  USING (user_id = app_request_device_id());

-- stops
DROP POLICY IF EXISTS "owner_update_stops" ON stops;
CREATE POLICY "owner_update_stops" ON stops FOR UPDATE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans WHERE plans.id = stops.plan_id
                   AND plans.user_id = app_request_device_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM plans WHERE plans.id = stops.plan_id
                   AND plans.user_id = app_request_device_id()));

DROP POLICY IF EXISTS "owner_delete_stops" ON stops;
CREATE POLICY "owner_delete_stops" ON stops FOR DELETE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans WHERE plans.id = stops.plan_id
                   AND plans.user_id = app_request_device_id()));

-- rsvps
DROP POLICY IF EXISTS "owner_update_rsvps" ON rsvps;
CREATE POLICY "owner_update_rsvps" ON rsvps FOR UPDATE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans WHERE plans.id = rsvps.plan_id
                   AND plans.user_id = app_request_device_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM plans WHERE plans.id = rsvps.plan_id
                   AND plans.user_id = app_request_device_id()));

DROP POLICY IF EXISTS "owner_delete_rsvps" ON rsvps;
CREATE POLICY "owner_delete_rsvps" ON rsvps FOR DELETE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans WHERE plans.id = rsvps.plan_id
                   AND plans.user_id = app_request_device_id()));

-- trips
DROP POLICY IF EXISTS "owner_update_trips" ON trips;
CREATE POLICY "owner_update_trips" ON trips FOR UPDATE
  TO anon, authenticated
  USING (user_id = app_request_device_id())
  WITH CHECK (user_id = app_request_device_id());

DROP POLICY IF EXISTS "owner_delete_trips" ON trips;
CREATE POLICY "owner_delete_trips" ON trips FOR DELETE
  TO anon, authenticated
  USING (user_id = app_request_device_id());

-- stop_rsvps
DROP POLICY IF EXISTS "owner_update_stop_rsvps" ON stop_rsvps;
CREATE POLICY "owner_update_stop_rsvps" ON stop_rsvps FOR UPDATE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans WHERE plans.id = stop_rsvps.plan_id
                   AND plans.user_id = app_request_device_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM plans WHERE plans.id = stop_rsvps.plan_id
                   AND plans.user_id = app_request_device_id()));

DROP POLICY IF EXISTS "owner_delete_stop_rsvps" ON stop_rsvps;
CREATE POLICY "owner_delete_stop_rsvps" ON stop_rsvps FOR DELETE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans WHERE plans.id = stop_rsvps.plan_id
                   AND plans.user_id = app_request_device_id()));
