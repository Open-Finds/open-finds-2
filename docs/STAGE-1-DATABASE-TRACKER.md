# Stage 1: database tracker

Branch: `feature/staging-reconciliation`. Staging project: `crpkzysdtnoomzimibhe`. Production (`wfrlkifdlgmlbffumglt`) was not touched or read.
Audit date: 2026-11-18. Status values: NOT STARTED, IN PROGRESS, BLOCKED, FAILED, APPROVED.

Rules for this stage: staging first; no production change, staging migration, deployment, push or paid call without the founder's approval; never weaken RLS; every bug fix gets a regression test.

## Audit summary (2026-11-18)

| Area | Class | Evidence |
|---|---|---|
| RLS on every public table (35 on staging) | COMPLETE | Live query: all 35 tables have RLS enabled. 9 have no policy on purpose (service-role or RPC access only). |
| 50 migrations applied on staging | COMPLETE | `list_migrations` on staging. |
| App checks on this branch | COMPLETE | typecheck pass, lint 0 errors, 40 app test files and 13 edge test files pass (run 2026-11-18). |
| `sales_summary_for(uuid)` and `partner_billing()` callable by signed-out users | BROKEN | Staging function ACL lists `anon=X`. Neither function checks the caller. The migrations only `REVOKE ... FROM PUBLIC`, which Supabase's default grants undo. |
| No unique rule on `saved_venues`; manual saves never de-duplicated | BROKEN | Only non-unique indexes. Staging has 1 duplicate group in 33 rows. |
| `save_shared_venue` loses a second venue from the same link | BROKEN (known) | Function body returns the first row for the same link. |
| Security advisors: unsafe view `venue_rating_summary`, 3 functions with no fixed search path, about 50 functions callable by anon | UNVERIFIED | Advisor output. Only 8 function bodies read so far. |
| Database test suite (`npm run test:db`) | UNVERIFIED | Needs Docker (not on this PC). Main CI has not run on this branch. Handover claims a scratch Postgres 18.6 run passed 248 checks; no evidence seen. |
| Live Save Venues on staging | UNVERIFIED | No real sign-in, link or Google test run since the latest deploys. |
| Staging `staging_provider_*` tables and the renamed reminders migration | OUT OF SYNC | Not in `supabase/migrations`. |
| `preserve_claimed_plan_ownership` | OUT OF SYNC | Only on `origin/codex/phase-1-staging-db`; not on staging. |
| Deployed staging functions vs Git | COMPLETE (see S1-02) | |
| Universal venue table (shared records, branches) | INCOMPLETE (product decision) | Design proposal only, `docs/UNIVERSAL-VENUES-DESIGN.md`. |

Outside Stage 1 (not database): Google Places matching and the confirm sheet, AI model and rate-limit tuning, Quick Share for unverified venues, and `venue-photo` (see S1-02 note).

## Tasks

### S1-01 Reconcile local changes into the staging branch. APPROVED
- Evidence: backup at `C:\Users\Home\open-finds-2-backup-2026-11-18\` (patch, archive, CLAUDE.md copy). Only the 68-line `CLAUDE.md` header was missing from the branch; committed as `60dea5a` (local, not pushed). Other local files are older copies of work already on the branch.
- Rollback: `git revert 60dea5a`.

### S1-02 Compare deployed staging functions with Git. APPROVED (read-only)
- Evidence (2026-11-18, staging): `extract-venue-meta` v24 matches Git byte for byte (all 6 files). `resolve-place` v26 matches Git except 5 import lines (`./_shared` vs `../_shared`, a bundling difference only). `ai-proxy` v28 and `venue-photo` v2: the shared files and `stagingProviders.ts` match; the main file was checked by markers only (the tool returned it inline), so not byte-verified.
- `geocode` v20 and `discover-venues` v19 were not compared (not part of AI Save).
- Finding for the founder (not a database issue): `venue-photo` is deployed and the app calls it (`src/lib/apiKeys.ts`). It uses plain `fetch` to Google Places, so it bypasses the staging provider controls and the AI Save allowance. Its only limit is 200 calls per user per hour. This conflicts with the decision "staging APK ships without a Google photo".

### S1-03 Record staging-only objects in Git. APPROVED (no change to staging or production)
- Decision: the ledger is a staging testing control, so it is NOT added to `supabase/migrations` (that chain goes to production). It is recorded as an idempotent script in `supabase/staging-only/staging_provider_ledger.sql`, with a README that also records the reminders hazard (the repo reminders migration schedules a job that calls the production URL; staging ran a no-schedule variant under the same version).
- Evidence 2026-11-18: live staging functions match the saved definitions by MD5 (781050db..., 052b1264...); live tables carry constraints and foreign keys the old reference file omitted, now captured. The script was validated on a throwaway real PostgreSQL 18.6 after the full migration chain: applies twice cleanly; function checksums equal staging's; anon and authenticated have no access, service_role can run the control function only; and 19 behaviour checks pass (admit, campaign busy, counted call, refused call kind, finish, duplicate refusal). Staging itself was only read.
- Not done: the reminders migration name difference is documented, not changed (history on production must not be rewritten).

### S1-04 Close anonymous access to sales and billing functions. APPROVED on staging (production not applied)
- Applied to staging 2026-11-18 with founder approval (version 20261118114331, name `close_sales_billing_helpers`). Staging check afterwards: `anon` and `authenticated` can no longer execute either function; `service_role` and the owner still can. The guarded callers (`admin_team`, `my_sales_summary`, `admin_partner_overview`) are still SECURITY DEFINER and callable by signed-in users, so they keep working. Rollback is in the migration comments.
- Not done: production (needs separate approval and a read-only check first).
- Done 2026-11-18: migration `20261118120000_close_sales_billing_helpers.sql`; new test `supabase/tests/17_sales_billing_access.sql` (9 checks); test setup `00_platform_stub.sql` now copies Supabase's default function grants, which is why the old tests never saw this hole.
- Evidence (real PostgreSQL 18.6, scratch install outside the repo, run by me 2026-11-18): before the fix the new test failed 7 of 9 (the 2 working-path checks passed); after the fix 9 of 9 pass; whole suite 257 assertions pass, 0 fail, plus the AI Save concurrency checks (all passed). Existing sales tests (12, 13, 14) still pass.
- Still to do: founder approval to apply to staging, then confirm the signed-out call is refused on staging. Production is a separate approval; production is expected to have the same gap but has not been checked.
- Problem: see audit table.
- Proposed change: new migration that revokes EXECUTE on `sales_summary_for(uuid)` and `partner_billing()` from `anon` and `authenticated`, grants only what the app needs, and keeps `admin_team()` and the sales screens working (they call these from inside guarded functions).
- Acceptance: signed-out call is refused; signed-in non-manager call is refused; manager screens still work; new SQL test added.
- Verification: SQL test on real Postgres; then staging check after approval.
- Risk: medium. Needs founder approval to apply to staging. Production is a separate approval.

### S1-05 Review the other callable functions and fix advisor warnings. NOT STARTED
- Scope: read every function callable by anon or authenticated, fix real gaps, fix the unsafe view and the 3 search paths.
- Risk: medium. Depends on: S1-04.

### S1-06 Duplicate protection for saved venues. APPROVED on staging (production not applied)
- Applied to staging 2026-11-18 with founder approval (migration `saved_venue_duplicate_rule`). Staging checks afterwards: still 33 rows; exactly 1 flagged (the later row of the existing pair; the earlier row, with its notes and visited mark, is unflagged); the unique index and trigger exist; `anon` cannot call `save_shared_venue`, `authenticated` can; a repeat insert and an insert that tries to set the flag were both refused inside a rolled-back test (nothing kept, row count unchanged).
- Not done: production (needs a read-only duplicate count and its own approval). The record below describes the local build.
- Founder decision 2026-11-18: keep the existing duplicate rows (no deletion).
- Built: migration `20261118130000_saved_venue_duplicate_rule.sql` (one saved venue per person per name and address, capitals and edge spaces ignored; later rows of any existing duplicate group are flagged `legacy_duplicate` and exempt, so nothing is deleted and it cannot fail on unexpected production data; a trigger stops people setting or clearing the flag; `save_shared_venue` now matches on name and address instead of the link, so a second venue from one link is saved). App side: `insertSavedVenue` returns the existing venue on a repeat save, `updateSavedVenue` explains a clash in plain words.
- Tests: `supabase/tests/18_saved_venue_duplicates.sql` (13 checks) and `src/lib/savedVenues.test.ts` (5 tests).
- Evidence (real PostgreSQL 18.6, scratch install, run 2026-11-18): all 270 SQL assertions pass, 0 fail, and the new test fails without the migration. App tests for the new file pass (5 of 5). Full `npm run check` (2026-11-18): typecheck pass, lint 0 errors (3 warnings), 41 app test files and 13 edge test files pass, build succeeds.
- Known limits: (1) if a person renames a saved venue and then re-shares the original link, the server treats it as a new venue (the app normally catches this earlier by link). (2) The app's "already saved from this link" shortcut still only fires when exactly one venue has that link, so a second venue from a two-venue link can't be reached by re-sharing; that is app behaviour, not database. (3) Production duplicates have not been counted.
- Remaining: founder approval to apply to staging, then check the staging pair is flagged (earliest unflagged, later flagged) and that a repeat insert is refused.
- Risk: medium. Rollback is in the migration header.

### S1-07 Decide on `preserve_claimed_plan_ownership`. NOT STARTED
- Founder decision: apply to staging or drop. Risk: low.

### S1-08 Run the full database tests on real Postgres 17 and CI. NOT STARTED
- Blocked on tooling (no Docker). Option: run the main CI workflow on this branch (needs a push, which needs approval).

### S1-09 Live Save Venues test on staging. NOT STARTED
- Needs the founder's test account, a small paid-call budget, at most 3 retries per request.

### S1-10 Final regression run and documentation. NOT STARTED
- Update this tracker and `DOCUMENTATION.md`. Depends on all of the above.
