/*
# Lock Down Plans, Stops, and RSVPs with Ownership-Scoped RLS

## Context
The plans, stops, and rsvps tables currently have policies that use `USING (true)`
for all four CRUD verbs, meaning anyone with the public anon key can read, create,
edit, or delete ANY plan, stop, or RSVP in the database. This migration replaces
those wide-open policies with ownership-scoped ones.

## Ownership Model
This app uses a client-generated `user_id` (a random UUID stored in the browser's
localStorage) to track plan ownership — not `auth.uid()`. The client sends this ID
as an `x-user-id` request header on every Supabase API call. RLS policies compare
this header value (via `current_setting('request.header.x-user-id', true)`) against
the `user_id` column on the row.

This is not as strong as JWT-based auth, but it prevents the mass-destruction
attack where anyone can wipe or edit all plans. An attacker would now need to know
a specific user's ID to target their plans.

## Changes Per Table

### plans
- SELECT: public (anyone can view via share links) — unchanged
- INSERT: public (anyone can create a plan) — unchanged
- UPDATE: only the plan owner (user_id matches request header) can edit
- DELETE: only the plan owner (user_id matches request header) can delete

### stops
- SELECT: public (anyone can view via share links) — unchanged
- INSERT: only if the parent plan is owned by the requester
- UPDATE: only if the parent plan is owned by the requester
- DELETE: only if the parent plan is owned by the requester

### rsvps
- SELECT: public (anyone can view the RSVP list on a share page) — unchanged
- INSERT: public (guests can RSVP without an account) — unchanged
- UPDATE: only the plan owner can update RSVPs
- DELETE: only the plan owner can delete RSVPs

## Security Notes
1. The `x-user-id` header is set client-side and is spoofable by a determined
   attacker, but it raises the bar significantly: random callers can no longer
   mass-delete or mass-edit plans without knowing each owner's ID.
2. Public SELECT and INSERT on plans/rsvps are intentional — the app's share-link
   and guest-RSVP features depend on them.
3. All policies target `anon, authenticated` since the app uses the anon key.
*/