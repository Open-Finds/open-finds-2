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
