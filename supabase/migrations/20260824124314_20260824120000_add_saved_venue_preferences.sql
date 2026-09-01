/*
# Add saved venue personal details

1. New columns
- `saved_venues.visited` records whether the user has been to the venue.
- `saved_venues.personal_note` stores a private note for the venue.
- `saved_venues.rating` stores an optional personal rating from 1 to 5.

2. Modified table
- `saved_venues` receives additive, nullable-safe fields only; existing venue data is preserved.

3. Security
- Existing owner-scoped RLS policies remain in place. The new fields are protected by the same policies as the parent venue row.

4. Notes
- Ratings are constrained to whole numbers from 1 through 5 when present.
- No existing rows are deleted or rewritten.
*/

ALTER TABLE saved_venues
  ADD COLUMN IF NOT EXISTS visited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS personal_note text,
  ADD COLUMN IF NOT EXISTS rating smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saved_venues_rating_range'
      AND conrelid = 'public.saved_venues'::regclass
  ) THEN
    ALTER TABLE saved_venues
      ADD CONSTRAINT saved_venues_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_saved_venues_visited ON saved_venues(user_id, visited);
