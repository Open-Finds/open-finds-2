-- ROLLBACK for supabase/migrations/20261124120000_save_verified_venue.sql
-- Undoes: the server-only save_verified_venue function, and puts back the Phase 1 link protection
--   (address edits no longer clear a link).
-- Data effect: none. Shared venues and links already made are kept; new verified saves
--   then fall back to the app's normal, unlinked save.
-- Safe to run twice.

DROP FUNCTION IF EXISTS public.save_verified_venue(uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.lock_saved_venue_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.venue_id := NULL;
    ELSE
      NEW.venue_id := OLD.venue_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_saved_venue_link() FROM PUBLIC, anon, authenticated;
