/*
# M04 — correctness defects

Two data-integrity bugs, both of which silently produce wrong results rather
than failing.

## 1. Stop ordering has two sources of truth
`fetchStops` returns rows ordered by `sort_order`, and then every one of the
nine display call sites immediately re-sorts by `time`. So `sort_order` is
written but never read: drag-to-reorder in TripDay persists a new sequence that
the UI discards on the next render, and the reorder appears to do nothing
unless the times happen to agree already.

`sort_order` becomes the single source of truth. Where the product wants a
chronological list (after someone edits a time), the client resequences and
persists it through the same RPC, so what is shown is what is stored.

## 2. Per-stop RSVPs are keyed on a typed name
`submit_stop_rsvp` matched on `(stop_id, name)`. Two guests called "Sam" on the
same trip share one row — the second overwrites the first's answer, and the
host sees one attendee where there are two. A name is not an identity.

Identity becomes `auth_uid` for signed-in users, or a per-browser `guest_key`
for guests. `name` stays, as a display label.
*/

-- ════════════════════════════════════════════════════════════
-- 1. ATOMIC STOP REORDERING
-- ════════════════════════════════════════════════════════════

/*
reorderStops() issued one UPDATE per stop in a client-side loop, awaited in
sequence. A failure partway left the order half-written with no rollback, and a
five-stop reorder cost five round trips.

SECURITY INVOKER (the default): this deliberately runs under the caller's RLS,
so the existing stop policies decide whether the caller may touch these rows.
*/
CREATE OR REPLACE FUNCTION reorder_plan_stops(
  p_plan_id uuid,
  p_stop_ids uuid[]
)
RETURNS int
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated int;
  v_expected int;
BEGIN
  IF p_stop_ids IS NULL OR array_length(p_stop_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'An ordered list of stop ids is required';
  END IF;

  -- Reject duplicates, which would otherwise assign two stops the same index.
  IF (SELECT count(DISTINCT id) FROM unnest(p_stop_ids) AS id)
     <> array_length(p_stop_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate stop ids in the ordering';
  END IF;

  -- Every id must belong to this plan. Without this a caller could smuggle in a
  -- stop from another plan and have its sort_order rewritten.
  SELECT count(*) INTO v_expected
    FROM stops
   WHERE plan_id = p_plan_id
     AND id = ANY(p_stop_ids);

  IF v_expected <> array_length(p_stop_ids, 1) THEN
    RAISE EXCEPTION 'Some stops do not belong to this plan';
  END IF;

  -- One statement, so it is all-or-nothing.
  WITH ordering AS (
    SELECT id, (ord - 1) AS new_order
      FROM unnest(p_stop_ids) WITH ORDINALITY AS t(id, ord)
  )
  UPDATE stops s
     SET sort_order = o.new_order
    FROM ordering o
   WHERE s.id = o.id
     AND s.plan_id = p_plan_id
     AND s.sort_order IS DISTINCT FROM o.new_order;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION reorder_plan_stops(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reorder_plan_stops(uuid, uuid[]) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. GUEST IDENTITY FOR PER-STOP RSVPS
-- ════════════════════════════════════════════════════════════

ALTER TABLE stop_rsvps
  ADD COLUMN IF NOT EXISTS guest_key text;

/*
The identity a per-stop RSVP is keyed on: the account when signed in, otherwise
the browser's guest key. Older rows have neither, so they fall back to the name
they were originally keyed on — that preserves existing behaviour for historical
data without letting new rows be name-keyed.
*/
CREATE OR REPLACE FUNCTION stop_rsvp_identity(
  p_auth_uid uuid,
  p_guest_key text,
  p_name text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_auth_uid::text, NULLIF(btrim(p_guest_key), ''), 'name:' || btrim(lower(p_name)));
$$;

/*
Collapse the collisions that already exist before adding the constraint,
keeping the most recent answer per (stop, identity) — the same row the old
read-then-update would have found.
*/
DELETE FROM stop_rsvps a
USING stop_rsvps b
WHERE a.stop_id = b.stop_id
  AND stop_rsvp_identity(a.auth_uid, a.guest_key, a.name)
    = stop_rsvp_identity(b.auth_uid, b.guest_key, b.name)
  AND (a.created_at, a.ctid) < (b.created_at, b.ctid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stop_rsvps_one_per_identity
  ON stop_rsvps (stop_id, stop_rsvp_identity(auth_uid, guest_key, name));

/*
Replaces the (stop_id, name) match. Two guests with the same name now hold
separate rows, and a guest editing their answer still updates their own.
*/
CREATE OR REPLACE FUNCTION submit_stop_rsvp(
  p_stop_id uuid,
  p_name text,
  p_status text,
  p_guest_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text := btrim(p_name);
  v_guest text := NULLIF(btrim(coalesce(p_guest_key, '')), '');
  v_uid uuid := auth.uid();
  v_identity text;
  v_stop stops%ROWTYPE;
  v_plan plans%ROWTYPE;
  v_row stop_rsvps%ROWTYPE;
BEGIN
  IF v_name = '' OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'A name between 1 and 80 characters is required';
  END IF;
  IF p_status NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'Invalid RSVP status';
  END IF;
  IF v_guest IS NOT NULL AND length(v_guest) > 100 THEN
    RAISE EXCEPTION 'Invalid guest key';
  END IF;
  -- A guest with no key cannot be told apart from any other guest, so refuse
  -- rather than silently falling back to name-keying a new row.
  IF v_uid IS NULL AND v_guest IS NULL THEN
    RAISE EXCEPTION 'A guest key is required';
  END IF;

  SELECT * INTO v_stop FROM stops WHERE id = p_stop_id;
  IF v_stop.id IS NULL THEN
    RAISE EXCEPTION 'Stop not found';
  END IF;

  SELECT * INTO v_plan FROM plans WHERE id = v_stop.plan_id;
  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;
  IF COALESCE(v_plan.canceled, false) THEN
    RAISE EXCEPTION 'This plan has been canceled';
  END IF;

  v_identity := stop_rsvp_identity(v_uid, v_guest, v_name);

  UPDATE stop_rsvps
     SET status = p_status,
         name = v_name
   WHERE stop_id = p_stop_id
     AND stop_rsvp_identity(auth_uid, guest_key, name) = v_identity
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    INSERT INTO stop_rsvps (stop_id, plan_id, trip_id, name, status, user_id, auth_uid, guest_key)
    VALUES (p_stop_id, v_stop.plan_id, v_plan.trip_id, v_name, p_status,
            v_plan.user_id, v_uid, v_guest)
    RETURNING * INTO v_row;
  END IF;

  -- user_id is the host's device key; never return it to a guest.
  RETURN to_jsonb(v_row) - 'user_id';
END;
$$;

REVOKE ALL ON FUNCTION submit_stop_rsvp(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_stop_rsvp(uuid, text, text, text) TO anon, authenticated;

-- The 3-argument version is superseded; drop it so no caller can land on a
-- name-keyed path by omitting the guest key.
DROP FUNCTION IF EXISTS submit_stop_rsvp(uuid, text, text);

-- guest_key identifies a browser and is not secret, but it is still an
-- identifier we have no reason to hand to other guests.
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
