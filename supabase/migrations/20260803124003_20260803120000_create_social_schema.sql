/*
# Social Features: Usernames, Friends, Groups, Shared Collections, Notifications

## Overview
Adds the social layer: unique usernames, friends (request/accept), friend groups,
shared venue collections, in-app notifications, push subscriptions, plan invites.

## Tables Created
1. friendships — friend requests between two users
2. friend_groups — named lists of friends
3. friend_group_members — members of a friend group
4. shared_collections — collaborative venue collections
5. shared_collection_members — members of a shared collection
6. shared_collection_venues — venues in a shared collection
7. notifications — in-app notification history
8. push_subscriptions — web push endpoints per user
9. plan_invites — tracks plan shares to users/groups

## Modified Tables
- profiles: adds username column (unique, nullable)

## Security
- RLS enabled on all new tables, scoped to authenticated
- Ownership via auth.uid(), membership via EXISTS subqueries
- plans.user_id is text, so cast auth.uid()::text when comparing
*/

-- ── Add username to profiles ──
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username text UNIQUE;
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username) WHERE username IS NOT NULL;

-- ════════════════════════════════════════
-- CREATE ALL TABLES FIRST
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT no_self_friendship CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair ON friendships (
  LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS friend_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friend_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at timestamptz DEFAULT now(),
  CONSTRAINT unique_group_member UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS shared_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared_collection_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES shared_collections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at timestamptz DEFAULT now(),
  CONSTRAINT unique_collection_member UNIQUE (collection_id, user_id)
);

CREATE TABLE IF NOT EXISTS shared_collection_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES shared_collections(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL,
  type text NOT NULL DEFAULT 'food',
  link text,
  added_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  invited_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id uuid REFERENCES friend_groups(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT check_invite_target CHECK (invited_user_id IS NOT NULL OR group_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_plan_invites_user ON plan_invites(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_plan_invites_group ON plan_invites(group_id);

-- ════════════════════════════════════════
-- ENABLE RLS ON ALL TABLES
-- ════════════════════════════════════════

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_collection_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_collection_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_invites ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════
-- POLICIES: friendships
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "select_own_friendships" ON friendships;
CREATE POLICY "select_own_friendships" ON friendships FOR SELECT
  TO authenticated USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

DROP POLICY IF EXISTS "insert_own_friendships" ON friendships;
CREATE POLICY "insert_own_friendships" ON friendships FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "update_own_friendships" ON friendships;
CREATE POLICY "update_own_friendships" ON friendships FOR UPDATE
  TO authenticated USING (auth.uid() = addressee_id OR auth.uid() = requester_id)
  WITH CHECK (auth.uid() = addressee_id OR auth.uid() = requester_id);

DROP POLICY IF EXISTS "delete_own_friendships" ON friendships;
CREATE POLICY "delete_own_friendships" ON friendships FOR DELETE
  TO authenticated USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- ════════════════════════════════════════
-- POLICIES: friend_groups
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "select_own_groups" ON friend_groups;
CREATE POLICY "select_own_groups" ON friend_groups FOR SELECT
  TO authenticated USING (
    auth.uid() = owner_id OR EXISTS (
      SELECT 1 FROM friend_group_members
      WHERE friend_group_members.group_id = friend_groups.id
      AND friend_group_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_groups" ON friend_groups;
CREATE POLICY "insert_own_groups" ON friend_groups FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_groups" ON friend_groups;
CREATE POLICY "update_own_groups" ON friend_groups FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_own_groups" ON friend_groups;
CREATE POLICY "delete_own_groups" ON friend_groups FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

-- ════════════════════════════════════════
-- POLICIES: friend_group_members
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "select_group_members" ON friend_group_members;
CREATE POLICY "select_group_members" ON friend_group_members FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM friend_groups WHERE friend_groups.id = friend_group_members.group_id AND friend_groups.owner_id = auth.uid())
    OR friend_group_members.user_id = auth.uid()
  );

DROP POLICY IF EXISTS "insert_group_members" ON friend_group_members;
CREATE POLICY "insert_group_members" ON friend_group_members FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM friend_groups WHERE friend_groups.id = group_id AND friend_groups.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_group_members" ON friend_group_members;
CREATE POLICY "delete_group_members" ON friend_group_members FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM friend_groups WHERE friend_groups.id = group_id AND friend_groups.owner_id = auth.uid())
    OR friend_group_members.user_id = auth.uid()
  );

-- ════════════════════════════════════════
-- POLICIES: shared_collections
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "select_collection_members" ON shared_collections;
CREATE POLICY "select_collection_members" ON shared_collections FOR SELECT
  TO authenticated USING (
    auth.uid() = owner_id OR EXISTS (
      SELECT 1 FROM shared_collection_members
      WHERE shared_collection_members.collection_id = shared_collections.id
      AND shared_collection_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_collections" ON shared_collections;
CREATE POLICY "insert_own_collections" ON shared_collections FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_collections" ON shared_collections;
CREATE POLICY "update_own_collections" ON shared_collections FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_own_collections" ON shared_collections;
CREATE POLICY "delete_own_collections" ON shared_collections FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

-- ════════════════════════════════════════
-- POLICIES: shared_collection_members
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "select_scm" ON shared_collection_members;
CREATE POLICY "select_scm" ON shared_collection_members FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM shared_collections WHERE shared_collections.id = collection_id AND shared_collections.owner_id = auth.uid())
    OR shared_collection_members.user_id = auth.uid()
  );

DROP POLICY IF EXISTS "insert_scm" ON shared_collection_members;
CREATE POLICY "insert_scm" ON shared_collection_members FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM shared_collections WHERE shared_collections.id = collection_id AND shared_collections.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_scm" ON shared_collection_members;
CREATE POLICY "delete_scm" ON shared_collection_members FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM shared_collections WHERE shared_collections.id = collection_id AND shared_collections.owner_id = auth.uid())
    OR shared_collection_members.user_id = auth.uid()
  );

-- ════════════════════════════════════════
-- POLICIES: shared_collection_venues
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "select_scvs" ON shared_collection_venues;
CREATE POLICY "select_scvs" ON shared_collection_venues FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM shared_collections WHERE shared_collections.id = collection_id AND (shared_collections.owner_id = auth.uid()
      OR EXISTS (SELECT 1 FROM shared_collection_members WHERE shared_collection_members.collection_id = shared_collections.id AND shared_collection_members.user_id = auth.uid())))
  );

DROP POLICY IF EXISTS "insert_scvs" ON shared_collection_venues;
CREATE POLICY "insert_scvs" ON shared_collection_venues FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM shared_collections WHERE shared_collections.id = collection_id AND (shared_collections.owner_id = auth.uid()
      OR EXISTS (SELECT 1 FROM shared_collection_members WHERE shared_collection_members.collection_id = shared_collections.id AND shared_collection_members.user_id = auth.uid())))
  );

DROP POLICY IF EXISTS "delete_scvs" ON shared_collection_venues;
CREATE POLICY "delete_scvs" ON shared_collection_venues FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM shared_collections WHERE shared_collections.id = collection_id AND (shared_collections.owner_id = auth.uid()
      OR EXISTS (SELECT 1 FROM shared_collection_members WHERE shared_collection_members.collection_id = shared_collections.id AND shared_collection_members.user_id = auth.uid())))
  );

-- ════════════════════════════════════════
-- POLICIES: notifications
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications" ON notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notifications" ON notifications;
CREATE POLICY "insert_own_notifications" ON notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications" ON notifications FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notifications" ON notifications;
CREATE POLICY "delete_own_notifications" ON notifications FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ════════════════════════════════════════
-- POLICIES: push_subscriptions
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "select_own_push" ON push_subscriptions;
CREATE POLICY "select_own_push" ON push_subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_push" ON push_subscriptions;
CREATE POLICY "insert_own_push" ON push_subscriptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_push" ON push_subscriptions;
CREATE POLICY "delete_own_push" ON push_subscriptions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ════════════════════════════════════════
-- POLICIES: plan_invites
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "select_plan_invites" ON plan_invites;
CREATE POLICY "select_plan_invites" ON plan_invites FOR SELECT
  TO authenticated USING (
    invited_by = auth.uid()
    OR invited_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM friend_group_members WHERE friend_group_members.group_id = plan_invites.group_id AND friend_group_members.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plans WHERE plans.id = plan_invites.plan_id AND plans.user_id = auth.uid()::text)
  );

DROP POLICY IF EXISTS "insert_plan_invites" ON plan_invites;
CREATE POLICY "insert_plan_invites" ON plan_invites FOR INSERT
  TO authenticated WITH CHECK (invited_by = auth.uid());

DROP POLICY IF EXISTS "delete_plan_invites" ON plan_invites;
CREATE POLICY "delete_plan_invites" ON plan_invites FOR DELETE
  TO authenticated USING (invited_by = auth.uid());

-- ════════════════════════════════════════
-- TRIGGER: auto-update updated_at on friendships
-- ════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_friendship_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_friendship_updated ON friendships;
CREATE TRIGGER trg_friendship_updated
  BEFORE UPDATE ON friendships
  FOR EACH ROW EXECUTE FUNCTION update_friendship_timestamp();
