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