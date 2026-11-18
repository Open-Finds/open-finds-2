# Release rehearsal

Rehearses the production release (`docs/PRODUCTION-RELEASE-PLAN.md`) on a throwaway Postgres that matches production's schema, and checks that every rollback in `supabase/rollback/` puts the database back exactly. It touches no real project and no real data.

It does this:
1. Builds the migrations up to `20261015120000` (this equals production's real schema; see the plan) and adds a few made-up rows (duplicate saved venues, owned and unowned plans).
2. Takes a snapshot: structure (`scripts/schema-fingerprint.sql`), function and table access, settings, and a hash of the data.
3. Applies the pending migrations, then rolls them back in reverse, and compares the snapshots. It also tests: only the quick security fix and its undo; undoing only the last three migrations; and that the rollbacks which would destroy data refuse to run when that data exists.

Run it (needs Node 20+; the first run downloads a Postgres build):
```bash
cd scripts/release-rehearsal
npm install
node rehearse-release.mjs
```
Expected last line: `ALL PASSED`. The dependencies are kept here on purpose and are not part of the app's `package.json`.
