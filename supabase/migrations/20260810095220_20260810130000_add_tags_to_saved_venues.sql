/*
# Add tags to saved_venues

## Summary
Adds a `tags` column (text array) to the `saved_venues` table so users can
label their saved venues with free-form keywords like "pho", "vietnamese",
"pizza", "hikes", etc. These tags power the search and filter chips on the
Venues page.

## Changes

1. Modified Tables
   - `saved_venues`: adds one nullable column:
     - `tags` (text[]) — array of user-defined keyword tags for the venue.
       Defaults to an empty array. Existing rows get `[]` automatically
       via the column default, so no data migration is needed.

2. Security
   - No changes to RLS policies. The existing auth-scoped policies
     (select_own_venues, insert_own_venues, update_own_venues,
     delete_own_venues) already scope all access to the authenticated
     owner. Tags are written and read by the same owner who controls
     the venue row.

## Notes
- This is purely additive. No existing data is modified or lost.
- All existing venues across all users simply gain an empty tags array
  until the owner adds tags.
- Each user only ever sees and filters their own venues' tags.
*/

ALTER TABLE saved_venues
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';