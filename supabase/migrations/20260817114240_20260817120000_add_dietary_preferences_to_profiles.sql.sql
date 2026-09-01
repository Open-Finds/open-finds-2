/*
# Add dietary preferences to profiles

## Summary
Adds a `dietary_preferences` column to the existing `profiles` table so the
"Something New" AI discovery feature can learn and respect each user's
dietary needs (vegetarian, vegan, gluten-free, halal, kosher, dairy-free,
nut allergy, pescatarian, etc.). The AI uses these to filter venue
recommendations so it only suggests places that can accommodate the user.

## Changes
### profiles (modified)
- `dietary_preferences` (text[], nullable, default NULL) — an array of
  dietary tags the user has selected (e.g. ['vegetarian', 'gluten-free']).
  NULL means the user hasn't set any preferences yet.

## Security
- No new tables. Existing RLS policies on `profiles` already allow each
  authenticated user to SELECT, INSERT, and UPDATE their own row, which
  covers reading and setting this new column.

## Notes
1. The column is nullable so existing profiles are unaffected — they
   simply have no dietary preferences until the user sets them.
2. Uses a DO $$ ... IF NOT EXISTS ... END $$ block so re-running is safe.
3. The array type (text[]) allows multiple selections since a user may
   have more than one dietary need (e.g. vegetarian AND gluten-free).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'dietary_preferences'
  ) THEN
    ALTER TABLE profiles ADD COLUMN dietary_preferences text[] DEFAULT NULL;
  END IF;
END $$;
