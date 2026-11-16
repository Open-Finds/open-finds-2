# Staging reference: deployed `resolve-place` (v20)

**Reference only. Do not deploy this file. Do not copy it into `supabase/functions/`.**

This folder preserves code that was running on the staging Supabase project
(`crpkzysdtnoomzimibhe`) but exists in no Git branch, tag or commit.

| Item | Value |
| --- | --- |
| Function | `resolve-place` (id `792180cf-0511-4a6a-8740-ee3d4df21474`) |
| Deployed version | 20 (last updated 2026-11-12 UTC per the function metadata) |
| Bundle hash reported by the platform (`ezbr_sha256`) | `aad9d735b516e3103cb1836acd0e8a6dbe835cdee2a8eca53cca05190f373c86` |
| Captured | 2026-11-16, read-only, from the staging project |
| File | `resolve-place.deployed-v20.js` (a bundled build output, not the original TypeScript) |

## Why it is kept
The repository's `supabase/functions/resolve-place/index.ts` at `a7893c2` has no
`verify` path, but the app at `a7893c2` calls it with `verify: true` and requires
`verified: true` back. Staging only works because of the code in this folder.
Keeping it here records what staging actually does until a proper source version
is written and approved.

## What it adds on top of the repository source
- A verification path (`verifyPlace`) that returns `verified: true` only when exactly
  one Google Places candidate matches the venue.
- A staging-only control layer (`withStagingProviderControls`) that limits access to
  listed synthetic test users, requires `STAGING_RESOLVE_PLACE_ENABLED`, and records
  every provider call in the `staging_provider_control` ledger with daily limits.

## Do not use in production
It hard-fails unless `SUPABASE_URL` is the staging project and refuses ordinary
users. Production must never receive this file as-is.

## Integrity caveat
The platform gives a hash of the whole deployed bundle, not of this single file, so
this copy cannot be proven byte-identical by hash. It was transcribed from the
function source returned by the platform. Re-fetch and diff before relying on it.
The two recovered migrations, by contrast, are checksum-verified against staging.
