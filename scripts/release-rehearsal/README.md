# Release rehearsal

Rehearses the production release (`docs/PRODUCTION-RELEASE-PLAN.md`) on a throwaway Postgres that matches production's schema, and checks that every rollback in `supabase/rollback/` puts the database back exactly. It touches no real project and no real data.

It does this:
1. Builds the migrations up to `20261015120000` (this equals production's real schema; see the plan) and adds a few made-up rows (duplicate saved venues, owned and unowned plans).
2. Takes a snapshot: structure (`scripts/schema-fingerprint.sql`), function and table access, settings, and a hash of the data.
3. Applies the pending migrations, then rolls them back in reverse, and compares the snapshots. It also tests: only the quick security fix and its undo; undoing only the last three migrations; and that the rollbacks which would destroy data refuse to run when that data exists.

There are two scripts:
- `rehearse-release.mjs`: the first rehearsal, from the production-equivalent base (first 45 migrations) through all eleven pending migrations and back, plus the guarded rollbacks.
- `rehearse-step-d.mjs`: the final rehearsal of the remaining release (Step D), starting from production's CURRENT state (first 45 migrations plus the two security migrations already applied to production) with made-up rows that mimic production's quirks. It applies the nine remaining migrations, compares the result with a clean build of all 56, checks no row is lost or changed, checks the six-stop limit and private shared-collection notes, rolls all nine back and compares with the start exactly, releases again, and runs the project's whole database test suite on the result.

Run it (needs Node 20+; the first run downloads a Postgres build):
```bash
cd scripts/release-rehearsal
npm install
node rehearse-step-d.mjs
```
Expected last line: `ALL PASSED`. The dependencies are kept here on purpose and are not part of the app's `package.json`.
