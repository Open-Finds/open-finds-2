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
