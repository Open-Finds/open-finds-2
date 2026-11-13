# Staging database Phase 1

Status as of 2026-11-14: local fixes tested, staging verification blocked. The staging application targets Supabase project `crpkzysdtnoomzimibhe`. The documented production project is `wfrlkifdlgmlbffumglt`. The dashboard access request timed out and the Supabase Management API runner had no token. The current staging migration ledger, policy definitions, data counts and functional behavior remain unverified.

## Repository architecture

| Area | Repository baseline | Phase 1 changes |
| --- | --- | --- |
| Accounts and plans | Profiles reference Auth. Plans and trips can be claimed from a legacy device ID and then use an Auth owner. Stops reference their plan and retain name, address and sort order. An optional partner venue FK uses `ON DELETE SET NULL`. | Claimed plan and trip owners are immutable on update. Legacy claims and ordinary edits still work. |
| Saves and collections | Saves are owner-scoped snapshots with private notes, visited status and ratings. A collection can reference another member's saved row. The shared collection RPC returned the entire row. | The RPC returns an explicit set of shared fields for other members and keeps the saver’s own fields available to them. |
| Venue identity and reviews | Partner venues and Auth-linked partner reviews already have their own relationships. Personal saved rows are separate from partner venues. Stops can store a custom address. | Canonical sharing across personal saves and branch identity remain unverified. No existing IDs were changed by either migration. |
| Collaboration | Hosts own plans. Invitees and public share recipients use separate invite and RSVP paths. The inspected planner does not define a co-host role. | No new role or collaboration workflow. Stop RSVP parent consistency and decline-reason authorization require further work. |

## Migration and verification

- `20261114120000_preserve_claimed_plan_ownership.sql` adds two triggers and one trigger function. It performs no data update.
- `20261114120100_keep_shared_collection_notes_private.sql` replaces `get_collection_venues(uuid)` and keeps execution scoped to signed-in callers. The existing frontend response shape for private fields is retained with neutral values for other members.
- A throwaway PGlite database applied all 50 migration files in this checkout. The shared collection and claimed ownership regressions passed, together with the plan, stop, sharing, host RSVP and save RPC suites. Profile lookup, admin roles, sales team and reviews suites failed with the same first errors against the earlier checkout in the same harness. The Docker/Postgres runner and hosted tests remain outstanding.
- A rollback of the ownership migration consists of dropping the two named triggers followed by `public.preserve_claimed_plan_ownership()`. A rollback of the RPC migration restores the prior function definition and its restricted grants from `20260921100000_shared_collections.sql`. Restoring that body would re-expose private fields. Use a corrected forward definition if the RPC has a compatibility issue.

Before applying any migration, compare the live ledger and schema with the feature branch. Earlier staging artifacts report an invite ownership migration and a legacy recommendation schema that differ from the clean branch. Check both independently. Verify that the migration IDs are unused, the target triggers are absent, and the live RPC signature, body and grants match the expected baseline. Apply only the reviewed files. Run synthetic, transaction-scoped checks and verify row counts and migration history afterwards.

The required staging coverage includes shared canonical identity and separate branches, isolated saves, venue and custom-address stops, host and collaborator permissions, RSVP behavior, and preservation of existing data. Phase 2 extraction readiness has not been established.
