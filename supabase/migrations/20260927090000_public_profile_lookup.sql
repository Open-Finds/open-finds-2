-- Friend search and friend/group names.
--
-- profiles is readable only by its owner, which is right: a row also holds
-- Stripe ids, subscription state and dietary preferences. But that meant a
-- search for someone else's username always came back empty, and friends and
-- group members showed as "Unknown".
--
-- Rather than open the table, these two functions return only the public
-- fields (id, display_name, username):
--   find_profile_by_username  exact, case-insensitive match; one row at most,
--                             so the user list cannot be paged through
--   get_public_profiles       names for users already connected to the
--                             caller: a friendship in any state, or a shared
--                             friend group

CREATE OR REPLACE FUNCTION find_profile_by_username(p_username text)
RETURNS TABLE (id uuid, display_name text, username text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name, p.username
  FROM profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.username IS NOT NULL
    AND lower(p.username) = lower(ltrim(btrim(p_username), '@'))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_public_profiles(p_ids uuid[])
RETURNS TABLE (id uuid, display_name text, username text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name, p.username
  FROM profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id = ANY (p_ids)
    AND (
      p.id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM friendships f
        WHERE (f.requester_id = auth.uid() AND f.addressee_id = p.id)
           OR (f.addressee_id = auth.uid() AND f.requester_id = p.id)
      )
      OR EXISTS (
        SELECT 1
        FROM friend_groups g
        WHERE (g.owner_id = auth.uid()
               OR EXISTS (SELECT 1 FROM friend_group_members me
                          WHERE me.group_id = g.id AND me.user_id = auth.uid()))
          AND (g.owner_id = p.id
               OR EXISTS (SELECT 1 FROM friend_group_members them
                          WHERE them.group_id = g.id AND them.user_id = p.id))
      )
    );
$$;

REVOKE ALL ON FUNCTION find_profile_by_username(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_profile_by_username(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_public_profiles(uuid[]) TO authenticated;
