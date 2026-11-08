# Repeatable web development

The stabilization base is `codex/rebuild`; the UI feature branch is `codex/ui-ux-rebuild-october-2026`. Use Node **24.22.0** (`.nvmrc`) and npm. The existing locked Supabase client requires Node >=22 and jsdom requires a recent Node 22/24 release, so CI now reads `.nvmrc` instead of Node 20. The UI stack is unchanged.

## Install and verify

```powershell
node --version
npm ci
npm run check
```

`check` runs typecheck, ESLint, the existing frontend suite, the new Edge Function/security suite and a disconnected production build. `npm ci` must succeed without rewriting package-lock.json. Install development dependencies for builds; application monitoring currently imports a devDependency.

The lockfile repair adds the already-declared Dyad tagger and its missing dependency; it does not upgrade the application stack. Three existing Fast Refresh warnings are separate from lint errors.

## Safe disconnected preview

```powershell
npm run dev:local
# http://127.0.0.1:5173/
```

For the built bundle:

```powershell
npm run build:local
npm run preview:local
# http://127.0.0.1:4173/
```

These scripts force the backend to local loopback with a fake anon key, disable OAuth buttons and external billing/monitoring settings, bind loopback only and fail if the intended port is occupied. They override inherited Vite backend variables, including existing .env files. They do not create accounts, run migrations, link Supabase or start a database. Sign-in/sign-up/reset surfaces render, but real authentication and data workflows need a test backend. A build made with build:local must not be deployed as a production artifact.

## Connected non-production development

1. Obtain a disposable backend and public anon key. Do not use the canonical production project for write tests.
2. Copy `.env.example` to ignored `.env.local` and replace its URL/key with the non-production values. Only public settings belong in VITE_*; service-role, OpenRouter, Maps and Stripe secret keys remain server-side.
3. Run `npm run dev`. Unlike dev:local, this deliberately honors `.env.local`.
4. Enable only test-mode integrations and use test accounts/fixtures. Reconcile cron/OAuth/gateway configuration using `SUPABASE-REFERENCE-AUDIT.md` before bringing up a full staging backend.

The ordinary build/preview commands are `npm run build` and `npm run preview`; build reads environment at build time, preview cannot switch an already-built backend URL.

## Tests

```powershell
npm run typecheck
npm run lint
npm run test:run
npm run test:security
```

The security suite executes real handlers with query-aware database fixtures and mocked auth/quota/push/upstream services. Default fetch throws if a test forgets to mock network access. It exercises friend/plan/group/guest notification authorization, forged text/URLs/recipients, batch rejection, concurrent replay suppression, quota omission/credit/failure paths, IP/DNS/redirect guards and historical notification click destinations.

For a Deno-installed workstation, typecheck the changed handlers without running them:

```powershell
deno check --no-lock supabase/functions/send-push-notification/index.ts supabase/functions/ai-proxy/index.ts supabase/functions/address-suggest/index.ts supabase/functions/extract-venue-meta/index.ts
```

This downloads declared public packages; it does not run Deno.serve or contact Supabase. Edge imports currently use version ranges, so their resolved versions should eventually be locked separately.

`npm run test:db` uses Docker and applies migrations to a throwaway database. It is not part of check and was not run during this change. Never substitute the production URL for that fixture. `supabase/deploy.sh`, `migrate-via-api.mjs`, backup scripts, db push and config push are not development-preview commands.

## Restricted execution environments

In this Codex sandbox, native esbuild cannot read an ancestor directory. A clean install succeeds, but Vite/Vitest startup can fail before loading the app. Verification used an identical source/locked-dependency copy outside the checkout, redirecting only that copy's installed esbuild to esbuild-wasm 0.21.5. No workaround is committed and the checkout's installed esbuild is untouched. On an unrestricted workstation/CI, run the normal commands above. Native esbuild outside this sandbox remains to be validated by CI after an approved push.

## Release boundary

No push, merge, deploy, remote setting update or production migration is authorized by running the local checks. Review production prerequisites and obtain approval before releasing the prepared security changes or six-stop migration. See UI-REBUILD-PLAN.md for the subsequent UI feature scope.
