/*
# Add auth_uid column to rsvps table

## Purpose
Links an RSVP to the authenticated account that submitted it, so signed-in
users can RSVP without typing a name (their display name is used) and the
host can see exactly which account responded. Guest RSVPs (no sign-in)
continue to work — the column is nullable and defaults to NULL.

## Changes
- rsvps: ADD COLUMN auth_uid uuid (nullable, no default) — references auth.users(id) ON DELETE SET NULL.

## Security
- No RLS policy changes. The existing public INSERT policy (WITH CHECK (true))
  already allows both anon and authenticated users to insert RSVPs. The new
  column is optional and does not affect existing rows or queries.
- No data loss: existing rows get NULL for auth_uid, which is correct (they
  were created by guests or before this change).
*/

ALTER TABLE rsvps
  ADD COLUMN IF NOT EXISTS auth_uid uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rsvps_auth_uid ON rsvps(auth_uid);