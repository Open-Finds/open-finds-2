-- Combined migrations for open-finds-2, in apply order.
-- Generated for one-shot paste into the Supabase SQL editor.
-- Wrapped in a transaction: any failure rolls the whole thing back.

BEGIN;

-- ======================================================================
-- 20260629123544_create_execution_layer_schema.sql
-- ======================================================================

/*
# The Execution Layer — schema

1. New Tables
- `plans`: a curated outing/plan. id, title, date, host_name, location, type, status, share_link, created_at.
- `stops`: ordered stops within a plan. id, plan_id (FK), name, address, time, vibe_link, sort_order.
- `rsvps`: guest responses to a plan. id, plan_id (FK), name, status (pending/in/declined), decline_reason, created_at.

2. Relationships
- stops.plan_id -> plans.id (CASCADE on delete)
- rsvps.plan_id -> plans.id (CASCADE on delete)

3. Security
- This is a no-auth app: plans are shared via public RSVP links, so all three tables are publicly readable/writable.
- RLS enabled on every table. Policies use `TO anon, authenticated` with `USING (true)` / `WITH CHECK (true)` because the data is intentionally public/shared (single-tenant, no sign-in).
*/

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  date date NOT NULL,
  host_name text NOT NULL,
  location text NOT NULL,
  type text NOT NULL DEFAULT 'food',
  status text NOT NULL DEFAULT 'active',
  share_link text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL,
  time text NOT NULL,
  vibe_link text,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  decline_reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_plans" ON plans;
CREATE POLICY "anon_select_plans" ON plans FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_plans" ON plans;
CREATE POLICY "anon_insert_plans" ON plans FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_plans" ON plans;
CREATE POLICY "anon_update_plans" ON plans FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_plans" ON plans;
CREATE POLICY "anon_delete_plans" ON plans FOR DELETE
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_stops" ON stops;
CREATE POLICY "anon_select_stops" ON stops FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_stops" ON stops;
CREATE POLICY "anon_insert_stops" ON stops FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_stops" ON stops;
CREATE POLICY "anon_update_stops" ON stops FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_stops" ON stops;
CREATE POLICY "anon_delete_stops" ON stops FOR DELETE
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_rsvps" ON rsvps;
CREATE POLICY "anon_select_rsvps" ON rsvps FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_rsvps" ON rsvps;
CREATE POLICY "anon_insert_rsvps" ON rsvps FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_rsvps" ON rsvps;
CREATE POLICY "anon_update_rsvps" ON rsvps FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_rsvps" ON rsvps;
CREATE POLICY "anon_delete_rsvps" ON rsvps FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS stops_plan_id_idx ON stops(plan_id);
CREATE INDEX IF NOT EXISTS stops_sort_order_idx ON stops(sort_order);
CREATE INDEX IF NOT EXISTS rsvps_plan_id_idx ON rsvps(plan_id);

-- ======================================================================
-- 20260630131351_create_saved_venues_table.sql
-- ======================================================================

/*
# Create saved_venues table

1. New Tables
- `saved_venues`: stores venues a user has saved for quick reuse when building plans.
  - id (uuid, primary key)
  - name (text, not null) — venue name
  - address (text, not null) — venue address
  - type (text, not null) — one of food/activity/dessert
  - link (text, nullable) — Instagram/TikTok vibe link
  - created_at (timestamptz, defaults to now)

2. Security
- This is a no-auth app (no sign-in screen). All tables are publicly readable/writable.
- RLS enabled on `saved_venues`. Policies use `TO anon, authenticated` with `USING (true)` / `WITH CHECK (true)` because the data is intentionally public/shared (single-tenant, no sign-in).

3. Indexes
- `saved_venues_created_at_idx` on `created_at` (desc) for "most recently saved first" queries.
*/

CREATE TABLE IF NOT EXISTS saved_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text NOT NULL,
  type text NOT NULL,
  link text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE saved_venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_saved_venues" ON saved_venues;
CREATE POLICY "anon_select_saved_venues" ON saved_venues FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_saved_venues" ON saved_venues;
CREATE POLICY "anon_insert_saved_venues" ON saved_venues FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_saved_venues" ON saved_venues;
CREATE POLICY "anon_update_saved_venues" ON saved_venues FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_saved_venues" ON saved_venues;
CREATE POLICY "anon_delete_saved_venues" ON saved_venues FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS saved_venues_created_at_idx ON saved_venues(created_at DESC);

-- ======================================================================
-- 20260702125130_add_canceled_to_plans.sql
-- ======================================================================

/*
# Add canceled column to plans table

1. Modified Tables
- `plans`
  - Add `canceled` boolean column, NOT NULL, default false.
  - This lets a host "cancel" an event without deleting the row, so the share link
    still resolves and shows a cancellation banner to attendees.

2. Security
- No RLS policy changes. Existing anon+authenticated CRUD policies still apply.
*/

ALTER TABLE plans ADD COLUMN IF NOT EXISTS canceled boolean NOT NULL DEFAULT false;

-- ======================================================================
-- 20260702131131_add_user_id_to_all_tables.sql
-- ======================================================================

/*
# Add user_id to all tables for data isolation

Each user gets a unique UUID stored in localStorage. All tables get a user_id
text column. Creator-side queries filter by user_id. The share link (RSVP page)
remains public — it does NOT filter by user_id so guests can view and RSVP.

1. Modified Tables
- plans:        ADD user_id text NOT NULL DEFAULT ''
- stops:        ADD user_id text NOT NULL DEFAULT ''
- rsvps:        ADD user_id text NOT NULL DEFAULT ''
- saved_venues: ADD user_id text NOT NULL DEFAULT ''

2. Indexes
- Add indexes on user_id for each table for query performance.

3. Security
- No RLS policy changes. Existing anon+authenticated CRUD policies still apply.
  The user_id filtering is enforced in the application layer.
*/

ALTER TABLE plans        ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT '';
ALTER TABLE stops        ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT '';
ALTER TABLE rsvps        ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT '';
ALTER TABLE saved_venues ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_plans_user_id        ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_stops_user_id        ON stops(user_id);
CREATE INDEX IF NOT EXISTS idx_rsvps_user_id        ON rsvps(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_venues_user_id ON saved_venues(user_id);

-- ======================================================================
-- 20260714122023_20260714120000_auth_scoped_saved_venues.sql
-- ======================================================================

/*
# Auth-scoped saved_venues

## Summary
Converts saved_venues from a publicly-writable table to a per-user table backed
by Supabase Auth. Previously all rows were visible to everyone; now each row
belongs to the authenticated user who created it.

## Changes

1. Modified Tables
   - `saved_venues`: sets user_id column default to `auth.uid()::text` so that
     INSERT statements that omit user_id are automatically stamped with the
     caller's auth UID. No existing rows are deleted or modified.

2. Security
   - Drops the four permissive anon+authenticated USING(true) policies.
   - Replaces them with four auth-scoped policies (SELECT / INSERT / UPDATE / DELETE)
     that check `auth.uid()::text = user_id`.
   - Only authenticated users can read or write their own saved venues.
   - Anon users (guests on the RSVP page, etc.) have no access to this table,
     which is correct — the RSVP flow never touches saved_venues.

## Notes
- Plans, stops, and rsvps are NOT changed; they remain public/anon-accessible
  because the share-link RSVP flow does not require a login.
- Existing rows with user_id = '' will not match any authenticated user and will
  effectively become inaccessible (they are orphaned, not deleted).
*/

-- Update column default so inserts without explicit user_id are auto-stamped
ALTER TABLE saved_venues ALTER COLUMN user_id SET DEFAULT auth.uid()::text;

-- Drop old open policies
DROP POLICY IF EXISTS "anon_select_saved_venues" ON saved_venues;
DROP POLICY IF EXISTS "anon_insert_saved_venues" ON saved_venues;
DROP POLICY IF EXISTS "anon_update_saved_venues" ON saved_venues;
DROP POLICY IF EXISTS "anon_delete_saved_venues" ON saved_venues;

-- New auth-scoped policies
DROP POLICY IF EXISTS "select_own_venues" ON saved_venues;
CREATE POLICY "select_own_venues" ON saved_venues FOR SELECT
  TO authenticated USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "insert_own_venues" ON saved_venues;
CREATE POLICY "insert_own_venues" ON saved_venues FOR INSERT
  TO authenticated WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "update_own_venues" ON saved_venues;
CREATE POLICY "update_own_venues" ON saved_venues FOR UPDATE
  TO authenticated USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "delete_own_venues" ON saved_venues;
CREATE POLICY "delete_own_venues" ON saved_venues FOR DELETE
  TO authenticated USING (auth.uid()::text = user_id);

-- ======================================================================
-- 20260714125250_20260714130000_create_profiles_table.sql
-- ======================================================================

/*
# Create profiles table

## Summary
Adds a `profiles` table that stores each authenticated user's display name.
The profile is a 1-to-1 extension of Supabase's built-in auth.users table.

## New Tables

### profiles
- `id` (uuid, primary key) — matches auth.users.id; auto-filled from auth.uid() on insert.
- `display_name` (text, not null, default '') — user's chosen display name shown in share messages.
- `created_at` (timestamptz) — when the profile was created.

## Security
- RLS enabled. Only the owning authenticated user can read, insert, or update their own profile.
- No delete policy: the CASCADE on the FK removes rows automatically when the auth user is deleted.

## Notes
1. The `id` column defaults to `auth.uid()` so `INSERT (display_name) VALUES (...)` works without
   the client passing an explicit id — the database fills it in from the session.
2. UPDATE uses both USING and WITH CHECK so the user cannot change their own id to someone else's.
3. The INSERT policy WITH CHECK (auth.uid() = id) prevents users from creating profiles for others.
*/

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ======================================================================
-- 20260728121052_make_plan_location_optional.sql
-- ======================================================================

-- Make plans.location nullable so a plan can be created from vibes alone
-- without requiring a typed location (saved-venue picks still auto-fill it).
ALTER TABLE plans ALTER COLUMN location DROP NOT NULL;

-- ======================================================================
-- 20260803124003_20260803120000_create_social_schema.sql
-- ======================================================================

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

-- ======================================================================
-- 20260806092222_20260806120000_add_coords_to_saved_venues.sql.sql
-- ======================================================================

/*
# Add coordinates to saved_venues

## Summary
Adds `lat` and `lon` columns to the `saved_venues` table so that geocoded
coordinates are stored once when a venue is saved, rather than re-geocoded
every time a user builds a plan. This eliminates repeated OpenStreetMap
Nominatim requests that were triggering HTTP 429 rate-limit errors.

## Changes

1. Modified Tables
   - `saved_venues`: adds two nullable columns:
     - `lat` (double precision) — latitude of the venue, set after geocoding
     - `lon` (double precision) — longitude of the venue, set after geocoding
   - Both columns are nullable so existing rows are unaffected. They are
     populated lazily: when the travel-times edge function geocodes an
     address for the first time, the frontend writes the coordinates back.

2. Security
   - No changes to RLS policies. The existing `update_own_venues` policy
     already allows authenticated users to update their own saved venues,
     which covers writing the `lat`/`lon` values.

## Notes
- No data is lost or modified — only new nullable columns are added.
- The frontend will update coordinates opportunistically after the
  travel-times edge function returns them.
*/

ALTER TABLE saved_venues
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lon double precision;

-- ======================================================================
-- 20260810091647_20260810120000_lock_down_public_tables_rls.sql.sql
-- ======================================================================

/*
# Lock Down Plans, Stops, and RSVPs with Ownership-Scoped RLS

## Context
The plans, stops, and rsvps tables currently have policies that use `USING (true)`
for all four CRUD verbs, meaning anyone with the public anon key can read, create,
edit, or delete ANY plan, stop, or RSVP in the database. This migration replaces
those wide-open policies with ownership-scoped ones.

## Ownership Model
This app uses a client-generated `user_id` (a random UUID stored in the browser's
localStorage) to track plan ownership — not `auth.uid()`. The client sends this ID
as an `x-user-id` request header on every Supabase API call. RLS policies compare
this header value (via `current_setting('request.header.x-user-id', true)`) against
the `user_id` column on the row.

This is not as strong as JWT-based auth, but it prevents the mass-destruction
attack where anyone can wipe or edit all plans. An attacker would now need to know
a specific user's ID to target their plans.

## Changes Per Table

### plans
- SELECT: public (anyone can view via share links) — unchanged
- INSERT: public (anyone can create a plan) — unchanged
- UPDATE: only the plan owner (user_id matches request header) can edit
- DELETE: only the plan owner (user_id matches request header) can delete

### stops
- SELECT: public (anyone can view via share links) — unchanged
- INSERT: only if the parent plan is owned by the requester
- UPDATE: only if the parent plan is owned by the requester
- DELETE: only if the parent plan is owned by the requester

### rsvps
- SELECT: public (anyone can view the RSVP list on a share page) — unchanged
- INSERT: public (guests can RSVP without an account) — unchanged
- UPDATE: only the plan owner can update RSVPs
- DELETE: only the plan owner can delete RSVPs

## Security Notes
1. The `x-user-id` header is set client-side and is spoofable by a determined
   attacker, but it raises the bar significantly: random callers can no longer
   mass-delete or mass-edit plans without knowing each owner's ID.
2. Public SELECT and INSERT on plans/rsvps are intentional — the app's share-link
   and guest-RSVP features depend on them.
3. All policies target `anon, authenticated` since the app uses the anon key.
*/

-- ======================================================================
-- 20260810091658_20260810120100_lock_down_public_tables_rls.sql.sql
-- ======================================================================

/*
# Lock Down Plans, Stops, and RSVPs with Ownership-Scoped RLS

## What Changed
Replaces the wide-open `true` policies on plans, stops, and rsvps with
ownership-scoped policies. The app sends a client-generated user_id via
the `x-user-id` request header; RLS compares it against the user_id column.

## Policy Summary
- plans:   public SELECT/INSERT, owner-only UPDATE/DELETE
- stops:   public SELECT, owner-only INSERT/UPDATE/DELETE (via parent plan)
- rsvps:   public SELECT/INSERT, owner-only UPDATE/DELETE (via parent plan)
*/

-- ── plans ──

DROP POLICY IF EXISTS "anon_select_plans" ON plans;
DROP POLICY IF EXISTS "anon_insert_plans" ON plans;
DROP POLICY IF EXISTS "anon_update_plans" ON plans;
DROP POLICY IF EXISTS "anon_delete_plans" ON plans;

CREATE POLICY "public_select_plans" ON plans FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "public_insert_plans" ON plans FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE POLICY "owner_update_plans" ON plans FOR UPDATE
  TO anon, authenticated
  USING (user_id = current_setting('request.header.x-user-id', true))
  WITH CHECK (user_id = current_setting('request.header.x-user-id', true));

CREATE POLICY "owner_delete_plans" ON plans FOR DELETE
  TO anon, authenticated
  USING (user_id = current_setting('request.header.x-user-id', true));

-- ── stops ──

DROP POLICY IF EXISTS "anon_select_stops" ON stops;
DROP POLICY IF EXISTS "anon_insert_stops" ON stops;
DROP POLICY IF EXISTS "anon_update_stops" ON stops;
DROP POLICY IF EXISTS "anon_delete_stops" ON stops;

CREATE POLICY "public_select_stops" ON stops FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "owner_insert_stops" ON stops FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = stops.plan_id
        AND plans.user_id = current_setting('request.header.x-user-id', true)
    )
  );

CREATE POLICY "owner_update_stops" ON stops FOR UPDATE
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = stops.plan_id
        AND plans.user_id = current_setting('request.header.x-user-id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = stops.plan_id
        AND plans.user_id = current_setting('request.header.x-user-id', true)
    )
  );

CREATE POLICY "owner_delete_stops" ON stops FOR DELETE
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = stops.plan_id
        AND plans.user_id = current_setting('request.header.x-user-id', true)
    )
  );

-- ── rsvps ──

DROP POLICY IF EXISTS "anon_select_rsvps" ON rsvps;
DROP POLICY IF EXISTS "anon_insert_rsvps" ON rsvps;
DROP POLICY IF EXISTS "anon_update_rsvps" ON rsvps;
DROP POLICY IF EXISTS "anon_delete_rsvps" ON rsvps;

CREATE POLICY "public_select_rsvps" ON rsvps FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "public_insert_rsvps" ON rsvps FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE POLICY "owner_update_rsvps" ON rsvps FOR UPDATE
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = rsvps.plan_id
        AND plans.user_id = current_setting('request.header.x-user-id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = rsvps.plan_id
        AND plans.user_id = current_setting('request.header.x-user-id', true)
    )
  );

CREATE POLICY "owner_delete_rsvps" ON rsvps FOR DELETE
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = rsvps.plan_id
        AND plans.user_id = current_setting('request.header.x-user-id', true)
    )
  );

-- ======================================================================
-- 20260810095220_20260810130000_add_tags_to_saved_venues.sql
-- ======================================================================

/*
# Add tags to saved_venues

## Summary
Adds a `tags` column (text array) to the `saved_venues` table so users can
label their saved venues with free-form keywords like "pho", "vietnamese",
"pizza", "hikes", etc. These tags power the search and filter chips on the
Venues page.

## Changes

1. Modified Tables
   - `saved_venues`: adds one nullable column:
     - `tags` (text[]) — array of user-defined keyword tags for the venue.
       Defaults to an empty array. Existing rows get `[]` automatically
       via the column default, so no data migration is needed.

2. Security
   - No changes to RLS policies. The existing auth-scoped policies
     (select_own_venues, insert_own_venues, update_own_venues,
     delete_own_venues) already scope all access to the authenticated
     owner. Tags are written and read by the same owner who controls
     the venue row.

## Notes
- This is purely additive. No existing data is modified or lost.
- All existing venues across all users simply gain an empty tags array
  until the owner adds tags.
- Each user only ever sees and filters their own venues' tags.
*/

ALTER TABLE saved_venues
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- ======================================================================
-- 20260810103221_create_app_secrets_table.sql
-- ======================================================================

/*
# Create app_secrets table for server-side API keys

1. New Tables
- `app_secrets`
  - `key` (text, primary key) — the secret name, e.g. 'GOOGLE_MAPS_API_KEY'
  - `value` (text, not null) — the secret value
  - `created_at` (timestamptz, default now())
2. Security
- Enable RLS on `app_secrets`.
- NO policies are added — deny by default for anon and authenticated roles.
- The service role bypasses RLS, so edge functions (which have the service role key)
  can read secrets. The browser (anon key) and authenticated users cannot.
3. Data
- No secrets are seeded by this migration. Insert them out of band after
  applying; see the note below the table definition.
*/

CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

-- Secrets are seeded OUT OF BAND, never committed here.
-- After applying migrations, set the key once via the SQL editor or psql:
--
--   INSERT INTO app_secrets (key, value) VALUES ('GOOGLE_MAPS_API_KEY', '<key>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- The previous hardcoded value was exposed in git history and must be
-- treated as compromised: rotate it in Google Cloud Console and restrict
-- the replacement by API and HTTP referrer.

-- ======================================================================
-- 20260810113215_20260810140000_fix_stops_rsvp_insert_rls.sql
-- ======================================================================

/*
# Fix Stops & RSVPs INSERT RLS Policies

## Context
The lockdown migration (20260810120100) tightened INSERT policies on `stops`
and `rsvps` to require ownership verification via the `x-user-id` request header:
  WITH CHECK (EXISTS (SELECT 1 FROM plans WHERE plans.id = stops.plan_id
    AND plans.user_id = current_setting('request.header.x-user-id', true)))

This mechanism does not work reliably in the Supabase PostgREST environment —
`current_setting('request.header.x-user-id', true)` returns NULL for INSERT
requests, causing every stops INSERT to be silently rejected. As a result,
plans are created successfully (plans INSERT is `WITH CHECK (true)`) but the
subsequent stops INSERT fails, leaving orphaned plans with zero stops.

Evidence: 64 plans created before the lockdown have stops; 27 plans created
after have zero stops — a 100% failure rate since the migration was applied.

## Fix
- `stops` INSERT: change to `WITH CHECK (true)` — public insert, matching the
  existing `public_insert_plans` policy. This is a no-auth app where plan
  creation is intentionally public; stops are always created as part of plan
  creation by the same client in the same request flow.
- `rsvps` INSERT: already `WITH CHECK (true)` (public) — no change needed, but
  we drop and recreate to be safe and explicit.

Ownership is still enforced for UPDATE and DELETE on both tables, so only the
plan owner (matching `x-user-id` header) can edit or remove their data.

## Security Notes
1. Public INSERT on stops/rsvps is intentional and matches the existing public
   INSERT on plans. The app has no sign-in screen; all writes use the anon key.
2. UPDATE and DELETE remain owner-scoped via the `x-user-id` header check.
3. SELECT remains public (needed for share-link viewing).
*/

-- ── stops ──
DROP POLICY IF EXISTS "owner_insert_stops" ON stops;
CREATE POLICY "public_insert_stops" ON stops FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- ── rsvps (already public, recreate to be explicit) ──
DROP POLICY IF EXISTS "public_insert_rsvps" ON rsvps;
CREATE POLICY "public_insert_rsvps" ON rsvps FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- ======================================================================
-- 20260810122347_20260810150000_add_auth_uid_to_rsvps.sql
-- ======================================================================

/*
# Add auth_uid column to rsvps table

## Purpose
Links an RSVP to the authenticated account that submitted it, so signed-in
users can RSVP without typing a name (their display name is used) and the
host can see exactly which account responded. Guest RSVPs (no sign-in)
continue to work — the column is nullable and defaults to NULL.

## Changes
- rsvps: ADD COLUMN auth_uid uuid (nullable, no default) — references auth.users(id) ON DELETE SET NULL.

## Security
- No RLS policy changes. The existing public INSERT policy (WITH CHECK (true))
  already allows both anon and authenticated users to insert RSVPs. The new
  column is optional and does not affect existing rows or queries.
- No data loss: existing rows get NULL for auth_uid, which is correct (they
  were created by guests or before this change).
*/

ALTER TABLE rsvps
  ADD COLUMN IF NOT EXISTS auth_uid uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rsvps_auth_uid ON rsvps(auth_uid);

-- ======================================================================
-- 20260810124534_20260810160000_create_travel_mode_schema.sql.sql
-- ======================================================================

/*
# Travel Mode: Trips Table, Plan Linking, and Per-Stop RSVPs

## Overview
Adds multi-day trip itineraries to the app. A trip groups multiple day-plans
under one umbrella. Each day is a regular plan row linked via trip_id.
Per-stop RSVPs let guests say "I'm in" or "Skip this" for individual stops
within a trip day, so they can join dinner but skip the morning activity.

## New Tables
1. trips — groups multiple day-plans into one multi-day itinerary
   - id (uuid PK)
   - name (text, not null) — trip name e.g. "Sydney Weekend"
   - destination (text, not null) — city e.g. "Sydney"
   - start_date (date, not null) — first day of the trip
   - num_days (int, not null, default 1) — number of days
   - host_name (text, not null) — who created the trip
   - status (text, default 'active') — active/canceled
   - user_id (text, not null) — owner's anonymous user ID (matches plans.user_id)
   - share_link (text, nullable) — share link for the trip
   - is_paid (boolean, default false) — paid feature flag placeholder
   - created_at (timestamptz)

2. stop_rsvps — per-stop RSVPs for trip day-plans
   - id (uuid PK)
   - stop_id (uuid, FK to stops.id ON DELETE CASCADE)
   - plan_id (uuid, FK to plans.id ON DELETE CASCADE)
   - trip_id (uuid, FK to trips.id ON DELETE CASCADE, nullable)
   - name (text, not null) — guest name
   - status (text, not null) — 'in' or 'out'
   - auth_uid (uuid, nullable) — linked auth user if signed in
   - user_id (text, nullable) — anonymous user ID
   - created_at (timestamptz)

## Modified Tables
- plans: adds trip_id (uuid, nullable, FK to trips.id ON DELETE SET NULL)
  and day_number (int, nullable) for ordering days within a trip.
  Both nullable so existing single-night plans are unaffected.

## Security
- RLS enabled on trips and stop_rsvps.
- trips: public SELECT/INSERT (no-auth app, matching plans pattern),
  owner-only UPDATE/DELETE via x-user-id header.
- stop_rsvps: public SELECT/INSERT (guests submit RSVPs without login),
  owner-only UPDATE/DELETE via plan ownership check.
- Uses same x-user-id header pattern as existing plans/stops/rsvps policies.
*/

-- ════════════════════════════════════════
-- CREATE TRIPS TABLE
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  destination text NOT NULL,
  start_date date NOT NULL,
  num_days int NOT NULL DEFAULT 1,
  host_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  user_id text NOT NULL,
  share_link text,
  is_paid boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_start_date ON trips(start_date);

-- ════════════════════════════════════════
-- ADD COLUMNS TO PLANS
-- ════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'trip_id') THEN
    ALTER TABLE plans ADD COLUMN trip_id uuid REFERENCES trips(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'day_number') THEN
    ALTER TABLE plans ADD COLUMN day_number int;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_plans_trip_id ON plans(trip_id) WHERE trip_id IS NOT NULL;

-- ════════════════════════════════════════
-- CREATE STOP_RSVPS TABLE
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stop_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id uuid NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'in' CHECK (status IN ('in', 'out')),
  auth_uid uuid,
  user_id text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stop_rsvps_stop_id ON stop_rsvps(stop_id);
CREATE INDEX IF NOT EXISTS idx_stop_rsvps_plan_id ON stop_rsvps(plan_id);
CREATE INDEX IF NOT EXISTS idx_stop_rsvps_trip_id ON stop_rsvps(trip_id) WHERE trip_id IS NOT NULL;

-- ════════════════════════════════════════
-- ENABLE RLS
-- ════════════════════════════════════════

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_rsvps ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════
-- POLICIES: trips
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "public_select_trips" ON trips;
CREATE POLICY "public_select_trips" ON trips FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_insert_trips" ON trips;
CREATE POLICY "public_insert_trips" ON trips FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "owner_update_trips" ON trips;
CREATE POLICY "owner_update_trips" ON trips FOR UPDATE
  TO anon, authenticated
  USING (user_id = current_setting('request.header.x-user-id', true))
  WITH CHECK (user_id = current_setting('request.header.x-user-id', true));

DROP POLICY IF EXISTS "owner_delete_trips" ON trips;
CREATE POLICY "owner_delete_trips" ON trips FOR DELETE
  TO anon, authenticated
  USING (user_id = current_setting('request.header.x-user-id', true));

-- ════════════════════════════════════════
-- POLICIES: stop_rsvps
-- ════════════════════════════════════════

DROP POLICY IF EXISTS "public_select_stop_rsvps" ON stop_rsvps;
CREATE POLICY "public_select_stop_rsvps" ON stop_rsvps FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_insert_stop_rsvps" ON stop_rsvps;
CREATE POLICY "public_insert_stop_rsvps" ON stop_rsvps FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "owner_update_stop_rsvps" ON stop_rsvps;
CREATE POLICY "owner_update_stop_rsvps" ON stop_rsvps FOR UPDATE
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = stop_rsvps.plan_id
        AND plans.user_id = current_setting('request.header.x-user-id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = stop_rsvps.plan_id
        AND plans.user_id = current_setting('request.header.x-user-id', true)
    )
  );

DROP POLICY IF EXISTS "owner_delete_stop_rsvps" ON stop_rsvps;
CREATE POLICY "owner_delete_stop_rsvps" ON stop_rsvps FOR DELETE
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM plans
      WHERE plans.id = stop_rsvps.plan_id
        AND plans.user_id = current_setting('request.header.x-user-id', true)
    )
  );

-- ======================================================================
-- 20260810130450_20260810170000_add_accommodation_and_collections.sql
-- ======================================================================

/*
# Add accommodation fields to plans and collection column to saved_venues

1. Modified Tables
   - `plans`: adds two nullable text columns:
     - `accommodation_name` — name of the hotel/BnB where the user is staying for that day
     - `accommodation_address` — address of the accommodation, used as the route origin in Google Maps
   - `saved_venues`: adds one nullable text column:
     - `collection` — user-defined grouping label (e.g. "Bali", "Sydney", "Activities") so venues can be filtered and picked by collection during trip planning
2. Security
   - No changes to RLS policies. Existing update policies on both tables already cover the new columns.
3. Notes
   - All three columns are nullable so existing rows are unaffected.
   - The frontend reads/writes these columns through the existing Supabase client; no new policies needed.
*/

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS accommodation_name text,
  ADD COLUMN IF NOT EXISTS accommodation_address text;

ALTER TABLE saved_venues
  ADD COLUMN IF NOT EXISTS collection text;

-- ======================================================================
-- 20260811114553_20260810180000_create_collections_tables.sql
-- ======================================================================

/*
# Create Collections and Collection Venues Tables

## Purpose
Promotes "collections" from a free-text tag on saved venues to first-class,
multi-membership folders. A collection is a named group of saved venues that
a user can create, rename, delete, and — most importantly — hand to Travel
Mode as the basis for a trip itinerary. A single venue can belong to multiple
collections, and a collection can hold many venues.

## New Tables

### `collections`
- `id` (uuid, primary key, auto-generated)
- `name` (text, not null) — the folder label, e.g. "Bali dinners"
- `user_id` (uuid, not null, defaults to `auth.uid()`, references `auth.users` with CASCADE delete) — the owner
- `created_at` (timestamptz, defaults to now())

### `collection_venues`
- `collection_id` (uuid, not null, references `collections.id` with CASCADE delete) — the folder
- `venue_id` (uuid, not null, references `saved_venues.id` with CASCADE delete) — the saved venue
- `created_at` (timestamptz, defaults to now())
- Primary key: composite `(collection_id, venue_id)` — prevents duplicates and enforces uniqueness

## Security (RLS)
Both tables have RLS enabled with owner-scoped policies:

- `collections`: a user can SELECT, INSERT, UPDATE, DELETE only their own rows
  (`auth.uid() = user_id`). The `user_id` column defaults to `auth.uid()` so
  inserts that omit it still satisfy the WITH CHECK predicate.
- `collection_venues`: a user can SELECT, INSERT, DELETE only membership rows
  whose parent collection they own. Ownership is verified via an EXISTS subquery
  against `collections` (`collections.id = collection_venues.collection_id AND
  collections.user_id = auth.uid()`).

All policies are scoped `TO authenticated` because the app has a sign-in screen
and saved venues are already auth-scoped.

## Notes
1. The existing free-text `collection` column on `saved_venues` is left
   untouched — the new folder system sits alongside it as the primary mechanism.
2. Deleting a collection cascades to its `collection_venues` rows but does NOT
   delete the saved venues themselves — venues are preserved and simply lose
   that folder membership.
3. Deleting a saved venue cascades to its `collection_venues` rows, keeping
   memberships consistent.
4. A composite primary key on `collection_venues` makes insert idempotency
   trivial — re-adding a venue to a collection is a no-op (violates PK, caught
   by client).
*/

CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_collections" ON collections;
CREATE POLICY "select_own_collections"
ON collections FOR SELECT
TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_collections" ON collections;
CREATE POLICY "insert_own_collections"
ON collections FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_collections" ON collections;
CREATE POLICY "update_own_collections"
ON collections FOR UPDATE
TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_collections" ON collections;
CREATE POLICY "delete_own_collections"
ON collections FOR DELETE
TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS collection_venues (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES saved_venues(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (collection_id, venue_id)
);

ALTER TABLE collection_venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_collection_venues" ON collection_venues;
CREATE POLICY "select_own_collection_venues"
ON collection_venues FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM collections
    WHERE collections.id = collection_venues.collection_id
    AND collections.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "insert_own_collection_venues" ON collection_venues;
CREATE POLICY "insert_own_collection_venues"
ON collection_venues FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM collections
    WHERE collections.id = collection_venues.collection_id
    AND collections.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "delete_own_collection_venues" ON collection_venues;
CREATE POLICY "delete_own_collection_venues"
ON collection_venues FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM collections
    WHERE collections.id = collection_venues.collection_id
    AND collections.user_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_collection_venues_venue_id ON collection_venues(venue_id);
CREATE INDEX IF NOT EXISTS idx_collection_venues_collection_id ON collection_venues(collection_id);

-- ======================================================================
-- 20260811124056_20260811120000_add_onboarding_to_profiles.sql.sql
-- ======================================================================

/*
# Add onboarding_completed column to profiles

## Summary
Adds an `onboarding_completed` boolean column to the existing `profiles` table
so the app can show a first-open "how to use" walkthrough only once per user,
persisted across devices and logins.

## Changes
### profiles (modified)
- `onboarding_completed` (boolean, NOT NULL, default false) — set to true when
  the user finishes or skips the onboarding walkthrough.

## Security
- No new tables. Existing RLS policies on `profiles` already allow each
  authenticated user to SELECT, INSERT, and UPDATE their own row, which covers
  reading and setting this new column.

## Notes
1. The column defaults to false so all existing profiles are treated as
   "has not seen onboarding" — they will see the walkthrough on next open.
2. Idempotent: uses DO $$ ... IF NOT EXISTS ... END $$ so re-running is safe.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'onboarding_completed'
  ) THEN
    ALTER TABLE profiles ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ======================================================================
-- 20260812225127_20260811130000_reset_onboarding_for_all_users.sql.sql
-- ======================================================================

/*
# Reset onboarding for all existing users

Sets onboarding_completed = false for every profile so that existing users
see the step-by-step walkthrough on their next visit. They can dismiss it
permanently by checking "Don't show again" on the last step.
*/

UPDATE profiles SET onboarding_completed = false;

-- ======================================================================
-- 20260817114240_20260817120000_add_dietary_preferences_to_profiles.sql.sql
-- ======================================================================

/*
# Add dietary preferences to profiles

## Summary
Adds a `dietary_preferences` column to the existing `profiles` table so the
"Something New" AI discovery feature can learn and respect each user's
dietary needs (vegetarian, vegan, gluten-free, halal, kosher, dairy-free,
nut allergy, pescatarian, etc.). The AI uses these to filter venue
recommendations so it only suggests places that can accommodate the user.

## Changes
### profiles (modified)
- `dietary_preferences` (text[], nullable, default NULL) — an array of
  dietary tags the user has selected (e.g. ['vegetarian', 'gluten-free']).
  NULL means the user hasn't set any preferences yet.

## Security
- No new tables. Existing RLS policies on `profiles` already allow each
  authenticated user to SELECT, INSERT, and UPDATE their own row, which
  covers reading and setting this new column.

## Notes
1. The column is nullable so existing profiles are unaffected — they
   simply have no dietary preferences until the user sets them.
2. Uses a DO $$ ... IF NOT EXISTS ... END $$ block so re-running is safe.
3. The array type (text[]) allows multiple selections since a user may
   have more than one dietary need (e.g. vegetarian AND gluten-free).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'dietary_preferences'
  ) THEN
    ALTER TABLE profiles ADD COLUMN dietary_preferences text[] DEFAULT NULL;
  END IF;
END $$;

-- ======================================================================
-- 20260824124314_20260824120000_add_saved_venue_preferences.sql
-- ======================================================================

/*
# Add saved venue personal details

1. New columns
- `saved_venues.visited` records whether the user has been to the venue.
- `saved_venues.personal_note` stores a private note for the venue.
- `saved_venues.rating` stores an optional personal rating from 1 to 5.

2. Modified table
- `saved_venues` receives additive, nullable-safe fields only; existing venue data is preserved.

3. Security
- Existing owner-scoped RLS policies remain in place. The new fields are protected by the same policies as the parent venue row.

4. Notes
- Ratings are constrained to whole numbers from 1 through 5 when present.
- No existing rows are deleted or rewritten.
*/

ALTER TABLE saved_venues
  ADD COLUMN IF NOT EXISTS visited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS personal_note text,
  ADD COLUMN IF NOT EXISTS rating smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saved_venues_rating_range'
      AND conrelid = 'public.saved_venues'::regclass
  ) THEN
    ALTER TABLE saved_venues
      ADD CONSTRAINT saved_venues_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_saved_venues_visited ON saved_venues(user_id, visited);

-- ======================================================================
-- 20260824132147_20260824130000_create_venue_partner_and_subscription_schema.sql.sql
-- ======================================================================

/*
# Venue Partner Portal, Subscriptions, and Public Ratings

## Overview
Adds the sponsored venue business portal, event tracking, milestones,
community ratings, and subscription tier support.

## New Tables
1. venue_partners — sponsored venue business accounts
2. venue_events — impression/save/visit tracking events
3. venue_milestones — milestone tracking (10/50/100/500+)
4. venue_ratings — public community ratings (average score only)

## Modified Tables
- profiles: adds subscription_tier and stripe_customer_id columns

## Security
- venue_partners: auth-scoped (business owner manages their own venue)
- venue_events: any authenticated user can INSERT (tracking), owner can SELECT
- venue_milestones: owner can SELECT, system manages via function
- venue_ratings: authenticated users INSERT/UPDATE own rating, all can SELECT
*/

-- ════════════════════════════════════════
-- ADD SUBSCRIPTION FIELDS TO PROFILES
-- ════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'subscription_tier') THEN
    ALTER TABLE profiles ADD COLUMN subscription_tier text NOT NULL DEFAULT 'free';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'stripe_customer_id') THEN
    ALTER TABLE profiles ADD COLUMN stripe_customer_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'subscription_status') THEN
    ALTER TABLE profiles ADD COLUMN subscription_status text NOT NULL DEFAULT 'active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'subscription_renews_at') THEN
    ALTER TABLE profiles ADD COLUMN subscription_renews_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_venue_partner') THEN
    ALTER TABLE profiles ADD COLUMN is_venue_partner boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ════════════════════════════════════════
-- CREATE VENUE_PARTNERS TABLE
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS venue_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  address text NOT NULL,
  type text NOT NULL DEFAULT 'food' CHECK (type IN ('food', 'activity', 'dessert')),
  instagram_link text,
  website text,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  monthly_budget_cents int,
  visit_rate_cents int NOT NULL DEFAULT 50,
  active boolean NOT NULL DEFAULT true,
  approved boolean NOT NULL DEFAULT false,
  stripe_customer_id text,
  lat double precision,
  lon double precision,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_partners_owner_id ON venue_partners(owner_id);
CREATE INDEX IF NOT EXISTS idx_venue_partners_active ON venue_partners(active) WHERE active = true;

ALTER TABLE venue_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_venue_partners" ON venue_partners;
CREATE POLICY "select_own_venue_partners" ON venue_partners FOR SELECT
  TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "insert_own_venue_partners" ON venue_partners;
CREATE POLICY "insert_own_venue_partners" ON venue_partners FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_venue_partners" ON venue_partners;
CREATE POLICY "update_own_venue_partners" ON venue_partners FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_own_venue_partners" ON venue_partners;
CREATE POLICY "delete_own_venue_partners" ON venue_partners FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

-- ════════════════════════════════════════
-- CREATE VENUE_EVENTS TABLE
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS venue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venue_partners(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('impression', 'saved', 'visited')),
  plan_id uuid,
  user_id text,
  auth_uid uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_events_venue_id ON venue_events(venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_events_type ON venue_events(event_type);
CREATE INDEX IF NOT EXISTS idx_venue_events_created_at ON venue_events(created_at);

ALTER TABLE venue_events ENABLE ROW LEVEL SECURITY;

-- Venue owners can see their own events
DROP POLICY IF EXISTS "select_own_venue_events" ON venue_events;
CREATE POLICY "select_own_venue_events" ON venue_events FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM venue_partners
      WHERE venue_partners.id = venue_events.venue_id
      AND venue_partners.owner_id = auth.uid()
    )
  );

-- Any authenticated user can create tracking events (impressions, saves, visits)
DROP POLICY IF EXISTS "insert_venue_events" ON venue_events;
CREATE POLICY "insert_venue_events" ON venue_events FOR INSERT
  TO authenticated WITH CHECK (true);

-- ════════════════════════════════════════
-- CREATE VENUE_MILESTONES TABLE
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS venue_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venue_partners(id) ON DELETE CASCADE,
  milestone_type text NOT NULL CHECK (milestone_type IN ('visits', 'impressions', 'saves')),
  threshold int NOT NULL,
  reached_at timestamptz DEFAULT now(),
  notified boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_milestones_venue_id ON venue_milestones(venue_id);

ALTER TABLE venue_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_venue_milestones" ON venue_milestones;
CREATE POLICY "select_own_venue_milestones" ON venue_milestones FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM venue_partners
      WHERE venue_partners.id = venue_milestones.venue_id
      AND venue_partners.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_venue_milestones" ON venue_milestones;
CREATE POLICY "insert_own_venue_milestones" ON venue_milestones FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM venue_partners
      WHERE venue_partners.id = venue_milestones.venue_id
      AND venue_partners.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_own_venue_milestones" ON venue_milestones;
CREATE POLICY "update_own_venue_milestones" ON venue_milestones FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM venue_partners
      WHERE venue_partners.id = venue_milestones.venue_id
      AND venue_partners.owner_id = auth.uid()
    )
  );

-- ════════════════════════════════════════
-- CREATE VENUE_RATINGS TABLE
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS venue_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venue_partners(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (venue_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_venue_ratings_venue_id ON venue_ratings(venue_id);

ALTER TABLE venue_ratings ENABLE ROW LEVEL SECURITY;

-- Anyone can read ratings (public aggregate)
DROP POLICY IF EXISTS "select_venue_ratings" ON venue_ratings;
CREATE POLICY "select_venue_ratings" ON venue_ratings FOR SELECT
  TO anon, authenticated USING (true);

-- Authenticated users can rate (one rating per venue per user)
DROP POLICY IF EXISTS "insert_own_venue_ratings" ON venue_ratings;
CREATE POLICY "insert_own_venue_ratings" ON venue_ratings FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_venue_ratings" ON venue_ratings;
CREATE POLICY "update_own_venue_ratings" ON venue_ratings FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_venue_ratings" ON venue_ratings;
CREATE POLICY "delete_own_venue_ratings" ON venue_ratings FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ════════════════════════════════════════
-- PUBLIC VENUE RATING AGGREGATE VIEW
-- ════════════════════════════════════════

CREATE OR REPLACE VIEW venue_rating_summary AS
SELECT
  venue_id,
  COUNT(*)::int AS rating_count,
  COALESCE(AVG(rating), 0)::numeric(3,2) AS average_rating
FROM venue_ratings
GROUP BY venue_id;

GRANT SELECT ON venue_rating_summary TO anon, authenticated;

-- ======================================================================
-- Record migration history so future `supabase db push` is consistent
-- ======================================================================

CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY, statements text[], name text
);

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260629123544', 'create_execution_layer_schema'),
  ('20260630131351', 'create_saved_venues_table'),
  ('20260702125130', 'add_canceled_to_plans'),
  ('20260702131131', 'add_user_id_to_all_tables'),
  ('20260714122023', '20260714120000_auth_scoped_saved_venues'),
  ('20260714125250', '20260714130000_create_profiles_table'),
  ('20260728121052', 'make_plan_location_optional'),
  ('20260803124003', '20260803120000_create_social_schema'),
  ('20260806092222', '20260806120000_add_coords_to_saved_venues'),
  ('20260810091647', '20260810120000_lock_down_public_tables_rls'),
  ('20260810091658', '20260810120100_lock_down_public_tables_rls'),
  ('20260810095220', '20260810130000_add_tags_to_saved_venues'),
  ('20260810103221', 'create_app_secrets_table'),
  ('20260810113215', '20260810140000_fix_stops_rsvp_insert_rls'),
  ('20260810122347', '20260810150000_add_auth_uid_to_rsvps'),
  ('20260810124534', '20260810160000_create_travel_mode_schema'),
  ('20260810130450', '20260810170000_add_accommodation_and_collections'),
  ('20260811114553', '20260810180000_create_collections_tables'),
  ('20260811124056', '20260811120000_add_onboarding_to_profiles'),
  ('20260812225127', '20260811130000_reset_onboarding_for_all_users'),
  ('20260817114240', '20260817120000_add_dietary_preferences_to_profiles'),
  ('20260824124314', '20260824120000_add_saved_venue_preferences'),
  ('20260824132147', '20260824130000_create_venue_partner_and_subscription_schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
