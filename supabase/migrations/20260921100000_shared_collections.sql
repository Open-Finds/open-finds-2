/*
# Shared collections

From the 2026-09-19 call: "me and my friend can add the venues together, so we
save the collection together so we can both add to it." Collections are
per-user today (collections.user_id, owner-only RLS on every table).

## Model
- The owner stays collections.user_id. Members are rows in collection_members.
- Anyone who can access a collection (owner or member) can see it and add
  their own saved venues to it. Only the owner renames, deletes, or manages
  members. A member can remove a venue they added, or leave.
- Members can only be added from the owner's accepted friends, or a friend
  group the owner owns. There is no "share with anyone by id".

## Why saved_venues RLS is untouched
Members need to see each other's venues *inside* the collection, but widening
saved_venues SELECT would also pour other people's rows into everyone's "My
Venues" list, which the client reads straight through RLS. Instead
get_collection_venues() returns a shared collection's venues explicitly, and
"My Venues" stays mine.
*/

-- ════════════════════════════════════════════════════════════
-- 1. MEMBERSHIP
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS collection_members (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_members_user ON collection_members (user_id);

ALTER TABLE collection_members ENABLE ROW LEVEL SECURITY;

-- Who added a venue to the collection, so members can remove their own.
ALTER TABLE collection_venues
  ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill: everything so far was added by the collection's owner.
UPDATE collection_venues cv
   SET added_by = c.user_id
  FROM collections c
 WHERE c.id = cv.collection_id AND cv.added_by IS NULL;

-- ════════════════════════════════════════════════════════════
-- 2. ACCESS HELPERS
-- ════════════════════════════════════════════════════════════

/*
SECURITY DEFINER so the check can read collections and collection_members
without recursing into their own RLS. Both return false for anonymous callers.
*/
CREATE OR REPLACE FUNCTION owns_collection(p_collection_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM collections
     WHERE id = p_collection_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION can_access_collection(p_collection_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM collections
             WHERE id = p_collection_id AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM collection_members
                WHERE collection_id = p_collection_id AND user_id = auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION owns_collection(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION can_access_collection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owns_collection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_access_collection(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 3. POLICIES
-- ════════════════════════════════════════════════════════════

-- collections: members can read; only the owner writes.
DROP POLICY IF EXISTS "select_own_collections" ON collections;
CREATE POLICY "select_accessible_collections" ON collections FOR SELECT
  TO authenticated USING (can_access_collection(id));
-- insert/update/delete stay owner-only (unchanged).

-- collection_members: visible to everyone in the collection; written only
-- through the RPCs below (which run as definer), so no INSERT/DELETE policy.
DROP POLICY IF EXISTS "select_collection_members" ON collection_members;
CREATE POLICY "select_collection_members" ON collection_members FOR SELECT
  TO authenticated USING (can_access_collection(collection_id));

-- collection_venues: members read and add; remove your own or, as owner, any.
DROP POLICY IF EXISTS "select_own_collection_venues" ON collection_venues;
CREATE POLICY "select_accessible_collection_venues" ON collection_venues FOR SELECT
  TO authenticated USING (can_access_collection(collection_id));

DROP POLICY IF EXISTS "insert_own_collection_venues" ON collection_venues;
CREATE POLICY "insert_accessible_collection_venues" ON collection_venues FOR INSERT
  TO authenticated
  WITH CHECK (
    can_access_collection(collection_id)
    -- You may only add venues you own; the venue row itself is RLS-visible
    -- only to its owner, so this EXISTS doubles as that check.
    AND EXISTS (SELECT 1 FROM saved_venues sv
                 WHERE sv.id = collection_venues.venue_id
                   AND sv.user_id = auth.uid()::text)
    AND (added_by IS NULL OR added_by = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_collection_venues" ON collection_venues;
CREATE POLICY "delete_collection_venues" ON collection_venues FOR DELETE
  TO authenticated
  USING (owns_collection(collection_id) OR added_by = auth.uid());

-- Stamp added_by automatically so the client need not send it.
CREATE OR REPLACE FUNCTION stamp_collection_venue_added_by()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.added_by IS NULL THEN NEW.added_by := auth.uid(); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stamp_collection_venue_added_by ON collection_venues;
CREATE TRIGGER trg_stamp_collection_venue_added_by
  BEFORE INSERT ON collection_venues
  FOR EACH ROW EXECUTE FUNCTION stamp_collection_venue_added_by();

-- ════════════════════════════════════════════════════════════
-- 4. READING A SHARED COLLECTION'S VENUES
-- ════════════════════════════════════════════════════════════

/*
Returns every venue in the collection regardless of who saved it, for anyone
who can access the collection. This is the one place a member sees another
member's saved_venues rows.
*/
CREATE OR REPLACE FUNCTION get_collection_venues(p_collection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL ON FUNCTION get_collection_venues(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_collection_venues(uuid) TO authenticated;

/* Member list with display names, for the share sheet. */
CREATE OR REPLACE FUNCTION get_collection_members(p_collection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT can_access_collection(p_collection_id) THEN
    RAISE EXCEPTION 'Collection not found';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'user_id', m.user_id,
        'display_name', p.display_name,
        'username', p.username,
        'added_at', m.created_at
      ) ORDER BY m.created_at
    )
    FROM collection_members m
    LEFT JOIN profiles p ON p.id = m.user_id
    WHERE m.collection_id = p_collection_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION get_collection_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_collection_members(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 5. SHARING
-- ════════════════════════════════════════════════════════════

/*
Adds accepted friends as members. Anyone in p_user_ids who is not an accepted
friend of the caller is skipped rather than failing the whole call, and the
count of members actually added is returned so the UI can say so.
*/
CREATE OR REPLACE FUNCTION share_collection_with_users(
  p_collection_id uuid,
  p_user_ids uuid[]
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_added int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF NOT owns_collection(p_collection_id) THEN
    RAISE EXCEPTION 'Only the collection owner can share it';
  END IF;

  INSERT INTO collection_members (collection_id, user_id, added_by)
  SELECT p_collection_id, u.id, v_me
    FROM unnest(p_user_ids) AS u(id)
   WHERE u.id <> v_me
     AND EXISTS (
       SELECT 1 FROM friendships f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = v_me AND f.addressee_id = u.id)
            OR (f.addressee_id = v_me AND f.requester_id = u.id))
     )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  -- Tell the new members.
  INSERT INTO notifications (user_id, type, title, body, data)
  SELECT m.user_id, 'collection_shared',
         'A collection was shared with you',
         COALESCE(p.display_name, 'A friend') || ' shared "' || c.name || '" with you',
         jsonb_build_object('type', 'collection_shared', 'collection_id', p_collection_id)
    FROM collection_members m
    JOIN collections c ON c.id = m.collection_id
    LEFT JOIN profiles p ON p.id = v_me
   WHERE m.collection_id = p_collection_id
     AND m.added_by = v_me
     AND m.created_at > now() - interval '5 seconds';

  RETURN v_added;
END;
$$;

/* Shares with every member of a friend group the caller owns. */
CREATE OR REPLACE FUNCTION share_collection_with_group(
  p_collection_id uuid,
  p_group_id uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_ids uuid[];
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM friend_groups WHERE id = p_group_id AND owner_id = v_me) THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  SELECT COALESCE(array_agg(user_id), '{}') INTO v_ids
    FROM friend_group_members WHERE group_id = p_group_id;

  RETURN share_collection_with_users(p_collection_id, v_ids);
END;
$$;

CREATE OR REPLACE FUNCTION remove_collection_member(
  p_collection_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  -- The owner can remove anyone; a member can remove only themselves.
  IF NOT (owns_collection(p_collection_id) OR p_user_id = v_me) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  DELETE FROM collection_members
   WHERE collection_id = p_collection_id AND user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION share_collection_with_users(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION share_collection_with_group(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION remove_collection_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_collection_with_users(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION share_collection_with_group(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_collection_member(uuid, uuid) TO authenticated;
