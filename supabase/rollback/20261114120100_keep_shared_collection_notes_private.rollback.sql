-- ROLLBACK for supabase/migrations/20261114120100_keep_shared_collection_notes_private.sql
-- Undoes: private notes in shared collections
-- Data effect: none. WARNING: this REOPENS the leak where other members of a shared collection see a person's private notes and ratings
-- Run only in the reverse order of the release (see supabase/rollback/README.md).
-- Safe to run twice. Tested on a production-equivalent database (docs/PRODUCTION-RELEASE-PLAN.md).

CREATE OR REPLACE FUNCTION public.get_collection_venues(p_collection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT can_access_collection(p_collection_id) THEN
    RAISE EXCEPTION 'Collection not found';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      to_jsonb(sv) || jsonb_build_object(
        'added_by', cv.added_by,
        'added_at', cv.created_at
      )
      ORDER BY cv.created_at DESC
    )
    FROM collection_venues cv
    JOIN saved_venues sv ON sv.id = cv.venue_id
    WHERE cv.collection_id = p_collection_id
  ), '[]'::jsonb);
END;
$function$;
-- The migration also took this function away from signed-out callers; put that back too.
GRANT EXECUTE ON FUNCTION public.get_collection_venues(uuid) TO anon;
