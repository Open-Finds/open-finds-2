/*
# Add canceled column to plans table

1. Modified Tables
- `plans`
  - Add `canceled` boolean column, NOT NULL, default false.
  - This lets a host "cancel" an event without deleting the row, so the share link
    still resolves and shows a cancellation banner to attendees.

2. Security
- No RLS policy changes. Existing anon+authenticated CRUD policies still apply.
*/

ALTER TABLE plans ADD COLUMN IF NOT EXISTS canceled boolean NOT NULL DEFAULT false;
