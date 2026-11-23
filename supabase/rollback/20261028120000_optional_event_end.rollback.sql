-- ROLLBACK for supabase/migrations/20261028120000_optional_event_end.sql
-- Undoes: optional event end time and date on plans
-- Data effect: refuses to run if any plan has an end time or date (export them first); otherwise drops the empty columns
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

DO $$
DECLARE n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'end_time') THEN
    EXECUTE 'SELECT count(*) FROM public.plans WHERE end_time IS NOT NULL OR end_date IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Plans with an event end exist. Export them first, or remove this guard to proceed.';
    END IF;
  END IF;
END $$;
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_optional_end_pair;
ALTER TABLE public.plans DROP COLUMN IF EXISTS end_time, DROP COLUMN IF EXISTS end_date;
DELETE FROM public.app_settings WHERE key = 'planner_event_timing';
