/* Proposed forward change, NOT applied by this UI task.
   User decision: all accounts may select up to six stops; active-plan and
   billing restrictions are otherwise unchanged. Deploy only after approval. */
BEGIN;
CREATE OR REPLACE FUNCTION public.enforce_stop_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL OR current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role' THEN RETURN NEW; END IF;
  -- Serialize concurrent inserts into one event; a race cannot exceed six.
  PERFORM 1 FROM plans WHERE id = NEW.plan_id FOR UPDATE;
  SELECT count(*) INTO v_count FROM stops WHERE plan_id = NEW.plan_id;
  IF v_count >= 6 THEN RAISE EXCEPTION 'A plan can have up to 6 stops'; END IF;
  RETURN NEW;
END;
$$;
INSERT INTO public.app_settings (key, value) VALUES ('planner_six_stops', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
COMMIT;
