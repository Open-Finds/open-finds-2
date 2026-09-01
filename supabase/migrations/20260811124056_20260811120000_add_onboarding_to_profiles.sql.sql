/*
# Add onboarding_completed column to profiles

## Summary
Adds an `onboarding_completed` boolean column to the existing `profiles` table
so the app can show a first-open "how to use" walkthrough only once per user,
persisted across devices and logins.

## Changes
### profiles (modified)
- `onboarding_completed` (boolean, NOT NULL, default false) — set to true when
  the user finishes or skips the onboarding walkthrough.

## Security
- No new tables. Existing RLS policies on `profiles` already allow each
  authenticated user to SELECT, INSERT, and UPDATE their own row, which covers
  reading and setting this new column.

## Notes
1. The column defaults to false so all existing profiles are treated as
   "has not seen onboarding" — they will see the walkthrough on next open.
2. Idempotent: uses DO $$ ... IF NOT EXISTS ... END $$ so re-running is safe.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'onboarding_completed'
  ) THEN
    ALTER TABLE profiles ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;
  END IF;
END $$;