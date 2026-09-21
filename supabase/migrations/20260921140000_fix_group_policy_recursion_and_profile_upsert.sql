/*
# Fix: friend groups have returned "infinite recursion" since August

## What broke
The 20260803 social schema has mutually recursive policies:

  friend_groups.select         → EXISTS (… FROM friend_group_members …)
  friend_group_members.select  → EXISTS (… FROM friend_groups …)

Each subquery runs under the other table's RLS, which runs the first policy
again. Postgres detects the loop and every query on either table fails with
42P17. plan_invites' SELECT policy also reads friend_group_members, so it fails
too — and the Events page calls fetchInvitedPlanIds() on load, so the plan
list has been failing behind that error as well.

This is the reason the client "couldn't get groups to work". Found by driving
the app as a signed-in user; the SQL suite never exercised these tables.

## Fix
SECURITY DEFINER helpers answer "do I own this group" / "am I in this group"
without going back through RLS, and the policies use those. No permissions
change — the same people see the same rows — it just terminates.
*/

-- ════════════════════════════════════════════════════════════
-- 1. RECURSION-FREE HELPERS
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION owns_friend_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM friend_groups WHERE id = p_group_id AND owner_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION is_friend_group_member(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM friend_group_members WHERE group_id = p_group_id AND user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION owns_friend_group(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_friend_group_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owns_friend_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_friend_group_member(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. POLICIES
-- ════════════════════════════════════════════════════════════

-- friend_groups: owner, or a member. The direct owner check is a plain row
-- predicate so INSERT … RETURNING sees the new row (see 20260921130000).
DROP POLICY IF EXISTS "select_own_groups" ON friend_groups;
CREATE POLICY "select_own_groups" ON friend_groups FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid() OR is_friend_group_member(id));

-- friend_group_members: yourself, or any member of a group you own.
DROP POLICY IF EXISTS "select_group_members" ON friend_group_members;
CREATE POLICY "select_group_members" ON friend_group_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR owns_friend_group(group_id));

DROP POLICY IF EXISTS "insert_group_members" ON friend_group_members;
CREATE POLICY "insert_group_members" ON friend_group_members FOR INSERT
  TO authenticated
  WITH CHECK (owns_friend_group(group_id));

DROP POLICY IF EXISTS "delete_group_members" ON friend_group_members;
CREATE POLICY "delete_group_members" ON friend_group_members FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR owns_friend_group(group_id));

-- plan_invites: same membership check, recursion-free. The plans clause is
-- updated to the dual-key ownership introduced in M02.
DROP POLICY IF EXISTS "select_plan_invites" ON plan_invites;
CREATE POLICY "select_plan_invites" ON plan_invites FOR SELECT
  TO authenticated
  USING (
    invited_by = auth.uid()
    OR invited_user_id = auth.uid()
    OR (group_id IS NOT NULL AND is_friend_group_member(group_id))
    OR EXISTS (SELECT 1 FROM plans p WHERE p.id = plan_invites.plan_id AND p.owner_id = auth.uid())
  );

-- ════════════════════════════════════════════════════════════
-- 3. PROFILES: writes must not silently miss
-- ════════════════════════════════════════════════════════════

/*
completeOnboarding(), updateDietaryPreferences() and friends run UPDATE …
WHERE id = auth.uid(). An account with no profiles row — anything created
outside the app's own signup, e.g. from the dashboard — matches zero rows,
nothing errors, and the user is shown onboarding on every visit forever.

A profile row is created for every auth user on insert, and backfilled for
any that are missing, so those UPDATEs always have a row to hit.
*/
INSERT INTO profiles (id, display_name)
SELECT u.id, COALESCE(split_part(u.email, '@', 1), 'Member')
  FROM auth.users u
  LEFT JOIN profiles p ON p.id = u.id
 WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION ensure_profile_for_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, COALESCE(split_part(NEW.email, '@', 1), 'Member'))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_profile ON auth.users;
CREATE TRIGGER trg_ensure_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION ensure_profile_for_new_user();
