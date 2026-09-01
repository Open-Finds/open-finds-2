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
