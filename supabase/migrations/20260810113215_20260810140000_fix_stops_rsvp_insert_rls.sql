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