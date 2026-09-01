/*
# Add accommodation fields to plans and collection column to saved_venues

1. Modified Tables
   - `plans`: adds two nullable text columns:
     - `accommodation_name` — name of the hotel/BnB where the user is staying for that day
     - `accommodation_address` — address of the accommodation, used as the route origin in Google Maps
   - `saved_venues`: adds one nullable text column:
     - `collection` — user-defined grouping label (e.g. "Bali", "Sydney", "Activities") so venues can be filtered and picked by collection during trip planning
2. Security
   - No changes to RLS policies. Existing update policies on both tables already cover the new columns.
3. Notes
   - All three columns are nullable so existing rows are unaffected.
   - The frontend reads/writes these columns through the existing Supabase client; no new policies needed.
*/

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS accommodation_name text,
  ADD COLUMN IF NOT EXISTS accommodation_address text;

ALTER TABLE saved_venues
  ADD COLUMN IF NOT EXISTS collection text;
