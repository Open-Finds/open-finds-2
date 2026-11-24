-- ROLLBACK for supabase/migrations/20261027190000_six_stop_planner.sql
-- Undoes: the six-stop limit for every account
-- Data effect: none. Puts back the earlier limit (2 free, 5 paid or unlocked)
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

CREATE OR REPLACE FUNCTION public.enforce_stop_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_owner uuid;
  v_tier text;
  v_max int := 2;
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('role', true) = 'service_role' OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT owner_id INTO v_owner FROM plans WHERE id = NEW.plan_id;
  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(subscription_tier, 'free') INTO v_tier
  FROM profiles WHERE id = v_owner;
  IF v_tier IS DISTINCT FROM 'free' OR premium_unlocked() THEN
    v_max := 5;
  END IF;

  SELECT COUNT(*) INTO v_count FROM stops WHERE plan_id = NEW.plan_id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'This plan is limited to % stops', v_max;
  END IF;
  RETURN NEW;
END;
$function$;
DELETE FROM public.app_settings WHERE key = 'planner_six_stops';
