/*
# Venue photos

Jacky (2026-10-15): more character — venue photos on the venue cards.

The venue-photo function looks a saved venue up on Google Places once and
stores the photo's address here; photo_checked_at records that it looked,
so a venue Google has no photo for isn't searched again. The photo itself
stays on Google's servers.
*/
ALTER TABLE saved_venues ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE saved_venues ADD COLUMN IF NOT EXISTS photo_checked_at timestamptz;
