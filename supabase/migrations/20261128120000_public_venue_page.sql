/*
# Public venue pages

Each saved venue has a page at /#/venue/<id> that anyone with the link can
open, signed in or not (2026-11-28). saved_venues stays owner-only under RLS;
this function returns just the public facts about the place:

  name, address, category type, source link, coordinates, Google photo, and
  only the structured tags (category:, cuisine:, specialty:, attribute:).

Never returned: who saved it, their note, rating, visited flag, collection,
or their free-text tags (which can be personal). is_mine tells a signed-in
caller that the venue is already theirs, so the app opens the full page.

The id is a random uuid, so a page can only be found through a shared link.
*/
CREATE OR REPLACE FUNCTION get_public_venue(p_id uuid)
RETURNS TABLE (
  id uuid, name text, address text, type text, link text,
  lat double precision, lon double precision, tags text[],
  photo_url text, is_mine boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.id, v.name, v.address, v.type::text, v.link,
         v.lat::double precision, v.lon::double precision,
         ARRAY(SELECT t FROM unnest(COALESCE(v.tags, '{}')) AS t
               WHERE t ~ '^(category|cuisine|specialty|attribute):'),
         v.photo_url,
         (auth.uid() IS NOT NULL AND v.user_id = auth.uid()::text)
  FROM saved_venues v
  WHERE v.id = p_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_public_venue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_venue(uuid) TO anon, authenticated;
