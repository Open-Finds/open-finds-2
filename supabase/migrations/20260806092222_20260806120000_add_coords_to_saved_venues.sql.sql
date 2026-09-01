/*
# Add coordinates to saved_venues

## Summary
Adds `lat` and `lon` columns to the `saved_venues` table so that geocoded
coordinates are stored once when a venue is saved, rather than re-geocoded
every time a user builds a plan. This eliminates repeated OpenStreetMap
Nominatim requests that were triggering HTTP 429 rate-limit errors.

## Changes

1. Modified Tables
   - `saved_venues`: adds two nullable columns:
     - `lat` (double precision) — latitude of the venue, set after geocoding
     - `lon` (double precision) — longitude of the venue, set after geocoding
   - Both columns are nullable so existing rows are unaffected. They are
     populated lazily: when the travel-times edge function geocodes an
     address for the first time, the frontend writes the coordinates back.

2. Security
   - No changes to RLS policies. The existing `update_own_venues` policy
     already allows authenticated users to update their own saved venues,
     which covers writing the `lat`/`lon` values.

## Notes
- No data is lost or modified — only new nullable columns are added.
- The frontend will update coordinates opportunistically after the
  travel-times edge function returns them.
*/

ALTER TABLE saved_venues
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lon double precision;
