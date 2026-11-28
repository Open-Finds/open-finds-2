-- ROLLBACK for supabase/migrations/20261123120000_universal_venues_foundation.sql
-- Undoes: the shared venues table, the saved_venues.venue_id link, its rules and triggers
-- Data effect: none while the table is unused. Refuses to run once any venue exists
-- or any save is linked, so shared venue data is never dropped by accident.
-- Safe to run twice.

DO $$
BEGIN
  IF to_regclass('public.venues') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.venues) THEN
      RAISE EXCEPTION 'venues has rows: export them before rolling back';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'saved_venues' AND column_name = 'venue_id')
       AND EXISTS (SELECT 1 FROM public.saved_venues WHERE venue_id IS NOT NULL) THEN
      RAISE EXCEPTION 'saved_venues has linked rows: export them before rolling back';
    END IF;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS saved_venues_lock_venue_link ON public.saved_venues;
DROP FUNCTION IF EXISTS public.lock_saved_venue_link();
DROP INDEX IF EXISTS public.saved_venues_one_per_canonical_venue;
DROP INDEX IF EXISTS public.idx_saved_venues_venue_id;
ALTER TABLE public.saved_venues DROP COLUMN IF EXISTS venue_id;
DROP TABLE IF EXISTS public.venues;
DROP FUNCTION IF EXISTS public.touch_venue_updated_at();
