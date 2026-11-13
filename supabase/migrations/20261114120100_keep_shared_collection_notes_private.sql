CREATE OR REPLACE FUNCTION public.get_collection_venues(p_collection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_access_collection(p_collection_id) THEN
    RAISE EXCEPTION 'Collection not found';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      (CASE WHEN sv.user_id = (SELECT auth.uid())::text THEN to_jsonb(sv)
        ELSE jsonb_build_object(
          'id', sv.id, 'user_id', sv.user_id, 'created_at', sv.created_at,
          'name', sv.name, 'address', sv.address, 'type', sv.type,
          'link', sv.link, 'lat', sv.lat, 'lon', sv.lon, 'tags', sv.tags,
          'photo_url', sv.photo_url,
          'collection', NULL, 'personal_note', NULL, 'visited', false, 'rating', NULL
        )
      END) || jsonb_build_object('added_by', cv.added_by, 'added_at', cv.created_at)
      ORDER BY cv.created_at DESC
    )
    FROM public.collection_venues cv
    JOIN public.saved_venues sv ON sv.id = cv.venue_id
    WHERE cv.collection_id = p_collection_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_collection_venues(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_venues(uuid) TO authenticated;
