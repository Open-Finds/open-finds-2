# Universal venues: database design (proposal, not implemented)

Status: proposal, 2026-11-18. Nothing here is migrated. Based on the staging schema (read-only), the migrations in `supabase/migrations/`, and the app code in `src/lib/supabase.ts`, `src/lib/aiSave.ts` and `src/components/AiSaveDialog.tsx`.

## What exists today (inspected)

- `saved_venues` (30 rows, 3 users on staging): one row per user per saved venue. It stores its own copy of `name`, `address`, `type`, `lat`, `lon`, `link`, `tags`, `personal_note`, `rating`, `visited`, `collection`, plus `photo_url` and `photo_checked_at`. There is no Google Place ID column and no shared venue record.
- Access: each user's own `saved_venues` rows only (select, insert, update, delete policies).
- `collections` and `collection_venues` (keyed on `saved_venues.id`). `shared_collection_venues` copies name and address rather than linking.
- Plans: `plans`, `stops`, `rsvps`, `trips`, `stop_rsvps`. A stop stores its own `name` and `address`, with an optional `venue_partner_id` (sponsored business only). A stop cannot link to a saved venue.
- Public reviews (`venue_reviews`) attach to `venue_partners` (businesses), not to saved venues.
- Photos: no Storage buckets exist, and no code uses Storage. The only photo data is a Google `photo_url`, stored per user row.
- Staging has no duplicate Google-link rows that would block a uniqueness rule. The one duplicate group on `(user_id, link)` and the one on `(user_id, name, address)` must be reviewed before any uniqueness constraint is added.

## Proposed model

**`venues` (new): one row per verified Google Place.**
- `id uuid pk default gen_random_uuid()`
- `google_place_id text unique` (nullable; unique when present). Google's place IDs differ per branch, so each branch is its own row.
- `name text not null`, `address text not null`, `type text not null` (same four values as today)
- `lat double precision`, `lon double precision`, `coords_refreshed_at timestamptz` (Google allows coordinates to be cached for at most 30 days)
- `verified_at timestamptz not null`, `created_at timestamptz default now()`
- Shared, licensed photo: `shared_photo_path text`, `shared_photo_credit text`, `shared_photo_license text`
- Check: `coords_refreshed_at` must not be older than 30 days for display. Enforce this in the read path, not the schema.

**`saved_venues` (existing): add nullable columns only.**
- `venue_id uuid references venues(id) on delete set null`
- `personal_photo_path text` (the user's own upload; never touches `venues`)
- Keep the existing snapshot columns (`name`, `address`, `lat`, `lon`, `link`). The app reads them today, and unverified saves have no `venue_id`.
- Unique `(user_id, venue_id) where venue_id is not null`, so a user cannot save the same verified branch twice.
- Keep `personal_note`, `rating`, `visited`, `collection`, `tags` and `link` on `saved_venues`. They are private to the user, which is why they stay there.

**`stops` (existing): add `venue_id uuid references venues(id) on delete set null`.** Keep `name` and `address` as the snapshot. Existing stops keep working with `venue_id` null.

**`shared_collection_venues` (existing): add `venue_id uuid references venues(id) on delete set null`.** Keep the copied name and address for old rows.

Unverified manual saves stay as `saved_venues` rows with `venue_id` null. They never create a `venues` row, so a guess never becomes a shared record.

## RLS and Storage

- `venues`: `select` for `anon` and `authenticated` (public catalogue; it contains no user data). No client insert, update or delete. Writes happen only from a server function (service role, justified in a code comment), after the Google verification succeeds.
- `saved_venues`: existing per-user policies are unchanged. The new columns need no new policies. `venue_id` must point to a verified venue, which the save function enforces.
- Storage, shared bucket `venue-photos`: public read, no client write. Admin or server writes only, with licence and credit recorded on the `venues` row.
- Storage, personal bucket `personal-venue-photos` (private): objects at `{auth.uid()}/{saved_venue_id}.jpg`. Policies on `storage.objects` allow select, insert, update and delete only where `bucket_id = 'personal-venue-photos'` and `(storage.foldername(name))[1] = auth.uid()::text`.
- Google photos: not stored (Google says photo names cannot be cached). Show them on demand through the existing `venue-photo` path, or keep the category icon. Photo storage per venue is not needed for the MVP.

## Backfill and duplicates

- Existing rows: no bulk backfill. Creating `venues` from legacy rows would need paid Google lookups and would hand unverified data a shared record. Legacy rows get a `venue_id` only when the user re-verifies them.
- Before adding `(user_id, venue_id)`: nothing to clean, since `venue_id` is new.
- Before any uniqueness on `(user_id, link)`: review the one staging duplicate group by hand. Do not auto-delete; the rows hold personal notes.
- Plans and trips: out of scope here (see the plan-ownership review). The `plans` ownership columns must be settled first, because stops inherit access through them.

## Migration and rollback risks

- Additive columns and tables are low risk. Rollback: drop the new columns and tables. No existing column is renamed or dropped.
- Risk: a `venues` row created from a wrong verification would be shown to everyone. Mitigation: only verified saves write `venues`, and `verified_at` is recorded.
- Risk: `google_place_id` stored indefinitely is allowed; coordinates are not. A refresh job or on-read check is needed before storing coordinates on `venues` at all.
- Risk: the unique index on `(user_id, venue_id)` fails if the app writes duplicates in the meantime. Create it after the save path is deployed and checked.
- Staging and production both need the same migration order: `venues`, then `saved_venues` columns, then the index, then Storage buckets and policies.

## Estimated complexity

- Schema and policies: small (about 2 new tables or columns groups, 1 index, 2 buckets, about 6 policies).
- Code: medium. The verified save path writes `venues`. `saved_venues` links to it. Branch selection, candidate pick and photo display read from it. The personal photo upload is a new UI, reusing the existing dialog and tokens.
- Overall: roughly one focused week, including tests. Estimate only; not measured.

## Recommendation

Do not start this before Phase 4 is tested on staging. Phase 4 verification already finds the exact Google place (name, address, coordinates), but it does not yet return the Google place ID to the app. Returning `place_id` from `resolve-place` is a small addition, and the save path can then write `venues` once Phase 4 is stable. Build in this order: (1) `venues` and the verified save path, (2) `saved_venues.venue_id`, (3) Storage buckets and personal photo upload, (4) collection and stop links.
