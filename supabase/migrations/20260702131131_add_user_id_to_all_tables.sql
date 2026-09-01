/*
# Add user_id to all tables for data isolation

Each user gets a unique UUID stored in localStorage. All tables get a user_id
text column. Creator-side queries filter by user_id. The share link (RSVP page)
remains public — it does NOT filter by user_id so guests can view and RSVP.

1. Modified Tables
- plans:        ADD user_id text NOT NULL DEFAULT ''
- stops:        ADD user_id text NOT NULL DEFAULT ''
- rsvps:        ADD user_id text NOT NULL DEFAULT ''
- saved_venues: ADD user_id text NOT NULL DEFAULT ''

2. Indexes
- Add indexes on user_id for each table for query performance.

3. Security
- No RLS policy changes. Existing anon+authenticated CRUD policies still apply.
  The user_id filtering is enforced in the application layer.
*/

ALTER TABLE plans        ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT '';
ALTER TABLE stops        ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT '';
ALTER TABLE rsvps        ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT '';
ALTER TABLE saved_venues ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_plans_user_id        ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_stops_user_id        ON stops(user_id);
CREATE INDEX IF NOT EXISTS idx_rsvps_user_id        ON rsvps(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_venues_user_id ON saved_venues(user_id);
