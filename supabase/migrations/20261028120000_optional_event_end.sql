-- Proposed additive change. NOT applied. Review/test in staging before release.
BEGIN;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS end_time time;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE public.plans ADD CONSTRAINT plans_optional_end_pair CHECK (
  (end_time IS NULL AND end_date IS NULL) OR
  (end_time IS NOT NULL AND end_date IS NOT NULL AND end_date >= date)
);
INSERT INTO public.app_settings (key, value) VALUES ('planner_event_timing', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
COMMIT;
