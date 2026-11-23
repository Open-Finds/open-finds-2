-- ROLLBACK for supabase/migrations/20261108120000_ai_save_quick_share.sql
-- Undoes: AI Save: save_shared_venue, venue recommendations and sharing
-- Data effect: refuses to run if any venue recommendation exists (export them first); otherwise drops the empty table
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.venue_recommendations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.venue_recommendations' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Venue recommendations exist. Export them first, then delete them or remove this guard to proceed.';
    END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.save_shared_venue(jsonb);
DROP FUNCTION IF EXISTS public.publish_venue_recommendation(uuid);
DROP FUNCTION IF EXISTS public.read_venue_recommendation(uuid);
DROP TABLE IF EXISTS public.venue_recommendations;
