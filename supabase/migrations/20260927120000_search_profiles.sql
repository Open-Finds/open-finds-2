-- Friend search as you type.
--
-- find_profile_by_username needs the whole username. search_profiles matches
-- any part of a username or display name and returns up to 10 people, best
-- matches first: exact username, username prefix, display-name prefix, then
-- anything containing the text. Like the other lookup it returns only the
-- public fields, never the rest of the profiles row.
--
-- The text is matched literally (strpos, not LIKE), so % and _ are not
-- wildcards, and results are capped at 10 per query.

CREATE OR REPLACE FUNCTION search_profiles(p_query text)
RETURNS TABLE (id uuid, display_name text, username text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH q AS (
    SELECT lower(ltrim(btrim(coalesce(p_query, '')), '@')) AS t
  )
  SELECT p.id, p.display_name, p.username
  FROM profiles p, q
  WHERE auth.uid() IS NOT NULL
    AND length(q.t) >= 1
    AND length(q.t) <= 50
    AND (
      strpos(lower(coalesce(p.username, '')), q.t) > 0
      OR strpos(lower(coalesce(p.display_name, '')), q.t) > 0
    )
  ORDER BY
    CASE
      WHEN lower(p.username) = q.t THEN 0
      WHEN strpos(lower(coalesce(p.username, '')), q.t) = 1 THEN 1
      WHEN strpos(lower(coalesce(p.display_name, '')), q.t) = 1 THEN 2
      ELSE 3
    END,
    length(coalesce(p.username, p.display_name, '')),
    lower(coalesce(p.username, p.display_name, ''))
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION search_profiles(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_profiles(text) TO authenticated;
