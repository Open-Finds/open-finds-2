/*
Round 3 #8: the host is on their own plan's RSVP list from the start.

Hosts used to type their own name into the share page's RSVP form, which
also sent them a "someone RSVP'd" notification about themselves. Now every
plan a signed-in host creates gets the host's RSVP ("In") straight away,
marked is_host so RSVP lists can badge it. Trip days are skipped: trips are
answered stop by stop instead.

Existing plans are left as they are.
*/

ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS is_host boolean NOT NULL DEFAULT false;

-- One host row per plan.
CREATE UNIQUE INDEX IF NOT EXISTS rsvps_one_host_per_plan ON rsvps (plan_id) WHERE is_host;

CREATE OR REPLACE FUNCTION add_host_rsvp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.owner_id IS NULL OR NEW.trip_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- The name friends know them by; plans.host_name can be the placeholder "You".
  SELECT NULLIF(btrim(display_name), '') INTO v_name FROM profiles WHERE id = NEW.owner_id;
  v_name := left(COALESCE(v_name, NULLIF(btrim(NEW.host_name), ''), 'Host'), 80);

  INSERT INTO rsvps (plan_id, name, status, user_id, auth_uid, is_host)
  VALUES (NEW.id, v_name, 'in', NEW.user_id, NEW.owner_id, true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_add_host_rsvp ON plans;
CREATE TRIGGER trg_add_host_rsvp
  AFTER INSERT ON plans
  FOR EACH ROW EXECUTE FUNCTION add_host_rsvp();

-- Guests can see which response is the host's. Otherwise unchanged from
-- 20260916100000_identity_owner_id_transition.sql.
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
                         'status', r.status, 'created_at', r.created_at,
                         'is_host', r.is_host)
      ORDER BY r.is_host DESC, r.created_at
    ), '[]'::jsonb)
    INTO v_rsvps FROM rsvps r WHERE r.plan_id = p_plan_id;

  RETURN jsonb_build_object('plan', v_plan, 'stops', v_stops, 'rsvps', v_rsvps);
END;
$$;
