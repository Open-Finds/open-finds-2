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
