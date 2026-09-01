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