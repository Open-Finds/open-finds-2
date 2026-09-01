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
