/*
# Fix: creating a collection was refused (42501) after the sharing migration

## What broke
20260921100000 replaced the owner-only SELECT policy on collections with
`USING (can_access_collection(id))`. PostgREST inserts with RETURNING, and
Postgres applies the SELECT policy to the returned row. can_access_collection
is STABLE, so inside the same statement it evaluates against the snapshot taken
*before* the INSERT — the new row is not in it — and the owner is told their
own collection "violates row-level security policy".

The browser test that creates a collection through the UI caught it. The SQL
suite did not, because its fixtures were inserted as the superuser, which
bypasses RLS; a test that inserts as a real user is added alongside this.

## Fix
Check ownership directly on the row (visible to RETURNING without any snapshot
question) and only fall back to the membership function for shared access.
This is also cheaper for the common case.
*/

DROP POLICY IF EXISTS "select_accessible_collections" ON collections;
CREATE POLICY "select_accessible_collections" ON collections FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR can_access_collection(id));

-- Same shape for collection_venues: the owner path stays a plain row check.
DROP POLICY IF EXISTS "select_accessible_collection_venues" ON collection_venues;
CREATE POLICY "select_accessible_collection_venues" ON collection_venues FOR SELECT
  TO authenticated
  USING (
    added_by = auth.uid()
    OR can_access_collection(collection_id)
  );
