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

### S1-03 Record staging-only objects as migrations. NOT STARTED
- Scope: migration files for the `staging_provider_*` tables and function, and the reminders migration name; no change to staging.
- Acceptance: a fresh database built from migrations matches staging for these objects.
- Risk: low. Depends on: none.

### S1-04 Close anonymous access to sales and billing functions. IN PROGRESS (fixed and tested locally; not applied to staging)
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

### S1-06 Duplicate protection for saved venues. NOT STARTED
- Scope: unique rule per user for the same venue; clean the 1 existing duplicate first; fix the lost second venue from one link.
- Risk: medium. Needs approval to apply to staging. Depends on: S1-04.

### S1-07 Decide on `preserve_claimed_plan_ownership`. NOT STARTED
- Founder decision: apply to staging or drop. Risk: low.

### S1-08 Run the full database tests on real Postgres 17 and CI. NOT STARTED
- Blocked on tooling (no Docker). Option: run the main CI workflow on this branch (needs a push, which needs approval).

### S1-09 Live Save Venues test on staging. NOT STARTED
- Needs the founder's test account, a small paid-call budget, at most 3 retries per request.

### S1-10 Final regression run and documentation. NOT STARTED
- Update this tracker and `DOCUMENTATION.md`. Depends on all of the above.
