/*
# M02 — move plan ownership from the device UUID to auth.uid()

## The problem
plans/stops/rsvps/trips are owned by a random UUID kept in the browser's
localStorage and presented as an x-user-id header. Two consequences:

1. It is a bearer claim. Anyone who learns a device id can act as that owner.
2. Ownership is bound to a browser, not a person. Clearing site data or
   switching devices orphans every plan permanently, even while signed in.

## Why this is not a straight cutover
Nothing in the database maps a device UUID to an auth user. That association
exists in exactly one place: a browser that holds the localStorage id *and*
has a session. So the rows cannot be reattributed by a server-side backfill —
there is nothing to join on.

## The approach: dual-key with claiming
- plans and trips gain `owner_id uuid` referencing auth.users.
- A row is yours if `owner_id = auth.uid()`, OR — only while `owner_id` is
  still NULL — if its device id matches your x-user-id header.
- On sign-in the client calls claim_device_rows(), which stamps owner_id onto
  that device's unclaimed rows. Each user migrates their own data by using the
  app; nothing is moved without a session that can prove the association.
- New rows written by a signed-in user get owner_id immediately.

Once `SELECT count(*) FROM plans WHERE owner_id IS NULL` reaches zero (see the
unclaimed_rows view), the device branch can be dropped in a follow-up
migration and the header path retired entirely. That deletion is deliberately
NOT done here: while any unclaimed row exists, removing it would orphan data.

## Guests are unaffected
Share links and guest RSVP continue to run through the SECURITY DEFINER RPCs
added in the M01 migration, which never consulted ownership.
*/

-- ════════════════════════════════════════════════════════════
-- 1. OWNERSHIP COLUMNS
-- ════════════════════════════════════════════════════════════

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_plans_owner_id ON plans (owner_id);
CREATE INDEX IF NOT EXISTS idx_trips_owner_id ON trips (owner_id);
-- Claiming looks rows up by device id; without this it is a sequential scan.
CREATE INDEX IF NOT EXISTS idx_plans_user_id_unclaimed
  ON plans (user_id) WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_trips_user_id_unclaimed
  ON trips (user_id) WHERE owner_id IS NULL;

-- ════════════════════════════════════════════════════════════
-- 2. THE OWNERSHIP PREDICATE
-- ════════════════════════════════════════════════════════════

/*
One definition of "mine", used by every policy below.

The device branch is deliberately gated on `owner_id IS NULL`. Without that
gate a claimed row would still be reachable by anyone presenting the original
device id, so claiming would strengthen nothing. With it, claiming is a
one-way upgrade: the moment a row has an owner, the bearer path is closed for
that row forever.
*/
CREATE OR REPLACE FUNCTION app_is_owner(p_owner uuid, p_device text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    CASE
      WHEN p_owner IS NOT NULL THEN p_owner = auth.uid()
      ELSE p_device IS NOT NULL AND p_device = app_request_device_id()
    END;
$$;

REVOKE ALL ON FUNCTION app_is_owner(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_owner(uuid, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- 3. CLAIMING
-- ════════════════════════════════════════════════════════════

/*
Stamps owner_id onto the calling user's unclaimed rows for one device id.
SECURITY DEFINER because the rows are, by definition, not yet visible under
the post-claim policy. Only ever claims rows that have no owner, so it cannot
take a plan away from an account that already holds it.
*/
CREATE OR REPLACE FUNCTION claim_device_rows(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_device text := btrim(coalesce(p_device_id, ''));
  v_plans int := 0;
  v_trips int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'A signed-in session is required to claim plans';
  END IF;
  IF v_device = '' OR length(v_device) > 100 THEN
    RAISE EXCEPTION 'A valid device id is required';
  END IF;

  UPDATE plans SET owner_id = v_uid
   WHERE user_id = v_device AND owner_id IS NULL;
  GET DIAGNOSTICS v_plans = ROW_COUNT;

  UPDATE trips SET owner_id = v_uid
   WHERE user_id = v_device AND owner_id IS NULL;
  GET DIAGNOSTICS v_trips = ROW_COUNT;

  RETURN jsonb_build_object('plans', v_plans, 'trips', v_trips);
END;
$$;

REVOKE ALL ON FUNCTION claim_device_rows(text) FROM PUBLIC;
-- Signed-in callers only; anon has no auth.uid() to claim with.
GRANT EXECUTE ON FUNCTION claim_device_rows(text) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 4. POLICIES — plans
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "owner_select_plans" ON plans;
CREATE POLICY "owner_select_plans" ON plans FOR SELECT
  TO anon, authenticated
  USING (app_is_owner(owner_id, user_id));

DROP POLICY IF EXISTS "owner_insert_plans" ON plans;
CREATE POLICY "owner_insert_plans" ON plans FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    -- A signed-in user may only create rows owned by themselves. An anonymous
    -- caller may still create device-scoped rows (owner_id must be NULL), which
    -- keeps the no-account flow working.
    CASE
      WHEN auth.uid() IS NOT NULL THEN owner_id = auth.uid() OR owner_id IS NULL
      ELSE owner_id IS NULL
    END
    AND user_id = app_request_device_id()
  );

DROP POLICY IF EXISTS "owner_update_plans" ON plans;
CREATE POLICY "owner_update_plans" ON plans FOR UPDATE
  TO anon, authenticated
  USING (app_is_owner(owner_id, user_id))
  WITH CHECK (app_is_owner(owner_id, user_id));

DROP POLICY IF EXISTS "owner_delete_plans" ON plans;
CREATE POLICY "owner_delete_plans" ON plans FOR DELETE
  TO anon, authenticated
  USING (app_is_owner(owner_id, user_id));

-- ════════════════════════════════════════════════════════════
-- 5. POLICIES — trips
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "owner_select_trips" ON trips;
CREATE POLICY "owner_select_trips" ON trips FOR SELECT
  TO anon, authenticated
  USING (app_is_owner(owner_id, user_id));

DROP POLICY IF EXISTS "owner_insert_trips" ON trips;
CREATE POLICY "owner_insert_trips" ON trips FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    CASE
      WHEN auth.uid() IS NOT NULL THEN owner_id = auth.uid() OR owner_id IS NULL
      ELSE owner_id IS NULL
    END
    AND user_id = app_request_device_id()
  );

DROP POLICY IF EXISTS "owner_update_trips" ON trips;
CREATE POLICY "owner_update_trips" ON trips FOR UPDATE
  TO anon, authenticated
  USING (app_is_owner(owner_id, user_id))
  WITH CHECK (app_is_owner(owner_id, user_id));

DROP POLICY IF EXISTS "owner_delete_trips" ON trips;
CREATE POLICY "owner_delete_trips" ON trips FOR DELETE
  TO anon, authenticated
  USING (app_is_owner(owner_id, user_id));

-- ════════════════════════════════════════════════════════════
-- 6. POLICIES — child tables, scoped through the parent plan
-- ════════════════════════════════════════════════════════════

/*
These read `plans` inside the policy, so they inherit the plan's own RLS: the
parent is visible exactly when the caller owns it, by either key. That is the
behaviour we want, and it means these policies need no ownership logic of
their own.
*/

-- stops
DROP POLICY IF EXISTS "owner_select_stops" ON stops;
CREATE POLICY "owner_select_stops" ON stops FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans p WHERE p.id = stops.plan_id));

DROP POLICY IF EXISTS "owner_insert_stops" ON stops;
CREATE POLICY "owner_insert_stops" ON stops FOR INSERT
  TO anon, authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM plans p WHERE p.id = stops.plan_id));

DROP POLICY IF EXISTS "owner_update_stops" ON stops;
CREATE POLICY "owner_update_stops" ON stops FOR UPDATE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans p WHERE p.id = stops.plan_id))
  WITH CHECK (EXISTS (SELECT 1 FROM plans p WHERE p.id = stops.plan_id));

DROP POLICY IF EXISTS "owner_delete_stops" ON stops;
CREATE POLICY "owner_delete_stops" ON stops FOR DELETE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans p WHERE p.id = stops.plan_id));

-- rsvps
DROP POLICY IF EXISTS "owner_select_rsvps" ON rsvps;
CREATE POLICY "owner_select_rsvps" ON rsvps FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans p WHERE p.id = rsvps.plan_id));

DROP POLICY IF EXISTS "owner_update_rsvps" ON rsvps;
CREATE POLICY "owner_update_rsvps" ON rsvps FOR UPDATE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans p WHERE p.id = rsvps.plan_id))
  WITH CHECK (EXISTS (SELECT 1 FROM plans p WHERE p.id = rsvps.plan_id));

DROP POLICY IF EXISTS "owner_delete_rsvps" ON rsvps;
CREATE POLICY "owner_delete_rsvps" ON rsvps FOR DELETE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans p WHERE p.id = rsvps.plan_id));

-- stop_rsvps
DROP POLICY IF EXISTS "owner_select_stop_rsvps" ON stop_rsvps;
CREATE POLICY "owner_select_stop_rsvps" ON stop_rsvps FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans p WHERE p.id = stop_rsvps.plan_id));

DROP POLICY IF EXISTS "owner_update_stop_rsvps" ON stop_rsvps;
CREATE POLICY "owner_update_stop_rsvps" ON stop_rsvps FOR UPDATE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans p WHERE p.id = stop_rsvps.plan_id))
  WITH CHECK (EXISTS (SELECT 1 FROM plans p WHERE p.id = stop_rsvps.plan_id));

DROP POLICY IF EXISTS "owner_delete_stop_rsvps" ON stop_rsvps;
CREATE POLICY "owner_delete_stop_rsvps" ON stop_rsvps FOR DELETE
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM plans p WHERE p.id = stop_rsvps.plan_id));

-- ════════════════════════════════════════════════════════════
-- 7. MIGRATION PROGRESS
-- ════════════════════════════════════════════════════════════

/*
Tells you when the device branch can be retired. Owner-only by design: it
reports counts for the caller's own rows, not the whole table.
*/
CREATE OR REPLACE FUNCTION my_unclaimed_row_counts(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device text := btrim(coalesce(p_device_id, ''));
BEGIN
  IF v_device = '' THEN
    RETURN jsonb_build_object('plans', 0, 'trips', 0);
  END IF;
  RETURN jsonb_build_object(
    'plans', (SELECT count(*) FROM plans WHERE user_id = v_device AND owner_id IS NULL),
    'trips', (SELECT count(*) FROM trips WHERE user_id = v_device AND owner_id IS NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION my_unclaimed_row_counts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_unclaimed_row_counts(text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- 8. SHARE RPCS MUST ALSO HIDE owner_id
-- ════════════════════════════════════════════════════════════

/*
The M01 versions strip user_id from guest payloads. owner_id is new and is
likewise an ownership fact guests have no business seeing — it is a real
auth.users id, so exposing it would leak the account identifier of every host
to anyone holding a share link.
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
  SELECT to_jsonb(p) - 'user_id' - 'owner_id' INTO v_plan
    FROM plans p WHERE p.id = p_plan_id;
  IF v_plan IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg((to_jsonb(s) - 'user_id') ORDER BY s.sort_order), '[]'::jsonb)
    INTO v_stops FROM stops s WHERE s.plan_id = p_plan_id;

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
  SELECT to_jsonb(t) - 'user_id' - 'owner_id' INTO v_trip
    FROM trips t WHERE t.id = p_trip_id;
  IF v_trip IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg((to_jsonb(p) - 'user_id' - 'owner_id') ORDER BY p.day_number), '[]'::jsonb)
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

-- submit_plan_rsvp returns the new row to the guest; keep owner_id out of it.
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

  RETURN to_jsonb(v_row) - 'user_id';
END;
$$;
