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
