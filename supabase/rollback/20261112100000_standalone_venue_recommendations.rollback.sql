-- ROLLBACK for supabase/migrations/20261112100000_standalone_venue_recommendations.sql
-- Undoes: standalone venue recommendations
-- Data effect: refuses to run if any standalone recommendation exists (export them first); otherwise none
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

DO $$
DECLARE n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'venue_recommendations' AND column_name = 'publisher_id') THEN
    EXECUTE 'SELECT count(*) FROM public.venue_recommendations WHERE venue_id IS NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Standalone venue recommendations exist. Export them first, then delete them or remove this guard to proceed.';
    END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.publish_standalone_venue_recommendation(jsonb);
ALTER TABLE IF EXISTS public.venue_recommendations
  DROP CONSTRAINT IF EXISTS venue_recommendation_publisher_snapshot,
  DROP CONSTRAINT IF EXISTS venue_recommendation_origin,
  DROP COLUMN IF EXISTS snapshot_key,
  DROP COLUMN IF EXISTS publisher_id;
ALTER TABLE IF EXISTS public.venue_recommendations ALTER COLUMN venue_id SET NOT NULL;
