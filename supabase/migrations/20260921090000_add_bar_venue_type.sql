/*
# Add "bar" as a fourth venue type

Requested on the 2026-09-19 client call: food / activity / dessert / bar.

Only venue_partners carries a CHECK constraint on `type`; stops and
saved_venues store it as free text and are governed by the client's VenueType
union and normalizeType(). Both of those now include 'bar', so this is the only
schema change the new type needs.
*/

ALTER TABLE venue_partners
  DROP CONSTRAINT IF EXISTS venue_partners_type_check;

ALTER TABLE venue_partners
  ADD CONSTRAINT venue_partners_type_check
  CHECK (type IN ('food', 'activity', 'dessert', 'bar'));
