# The Unsaved — release-readiness audit

Date: 1 November 2026 (Australia/Sydney)
Decision: **FIX CRITICAL ISSUES FIRST. Do not merge or deploy this working tree yet.**

## Scope and branch correction

- Working directory: C:/Users/Home/Documents/Codex/2026-10-27/the-unsaved-codebase-handover-audit-you/work/ui-rebuild
- The requested codex/rebuild branch is still at e3cd8fa8085c38bf63bf99448b02055e83489466, identical to cached origin/main. Comparing those refs yields zero commits and zero changed files.
- The actual rebuild was on codex/urban-graffiti-ui. Renamed that active branch to **codex/ui-n-ux-updates**. Git branch names cannot contain spaces. The historical codex/rebuild pointer remains intact.
- HEAD remains 3a131efa7be2d3767d5493e352cce5dbe0f18afc, one commit ahead / zero behind cached main: “chore: recover verified V5.1 development state before V6 UX refinements”. That commit changes 104 files (+3370/-427 lines).
- At audit start, the current tracked working tree against main changes 105 files (+3529/-455), plus 17 untracked files: **122 files total**. There are 16 modified tracked files beyond HEAD. No tracked file deletions were found. This audit report adds one further untracked documentation file.
- Crucial: latest V6.1, graffiti assets, disclosure component and workflow navigation are not all in HEAD. Pushing HEAD alone would not publish the reviewed interface. Brand asset imports depend on currently untracked files.
- Current origin points to C:/Users/Home/open-finds-2, not directly to GitHub. That repository's configured GitHub URL is https://github.com/Open-Finds/open-finds-2.git.
- Both GitHub repository lookup and main...codex/rebuild comparison returned 404 through the connected account. **Current GitHub main and remote mergeability cannot be certified.** All Git comparisons in this report use cached main from 20 October 2026.
- git merge-tree --write-tree origin/main HEAD succeeded without conflicts; cached main is an ancestor of HEAD. This checks committed history only, not an eventual commit of the dirty tree against newly fetched main.
- Other sessions' feature/ai-save-quick-share and original codex/rebuild checkouts were not modified or incorporated. Security/database/API and Venues files overlap likely future integration areas; independently review those later.

## PASS / FAIL release checklist

FAIL means a defect or an unmet verification gate; it does not always mean the feature is broken.

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| TypeScript | PASS | npm run typecheck via npm run check |
| ESLint | PASS | 0 errors; 3 existing Fast Refresh warnings |
| Frontend tests | PASS | 176 tests, 29 files |
| Security/handler tests | PASS | 82 tests, 7 files; provider/auth/error responses mocked |
| Production compilation | PASS | npm run check builds local-preview mode; separately compiled production-mode fixture build on port 5177 |
| Hosted session and saved data read | PASS | Existing session, 212 saved venues and dashboard rendered on canonical hosted preview 5175; no audit test writes there |
| Save Venue / edit / personal rating / visited | PASS locally | Production-build fixture library grew from 7 to 8; saved note and 4/5 rating reappeared; visited toggle persisted and dashboard moved 2/7 to 1/7 |
| Create Plan | PASS locally | Saved venue Plan action preloaded a stop; selected partner added; final action created an actual disposable plan and stops |
| Host event editing | PASS locally | Same event ID retained after title change and keyboard reorder; stop order persisted after reload |
| Sharing / guest RSVP | PASS locally | Copy Link displayed Copied; valid event-scoped link opened signed out at localhost; guest RSVP persisted and host reload showed 1/1 |
| Navigation / responsive UI | PASS for tested paths | Home, Venues, planner, Friends, Settings, summary; production viewports 320x740, 390x844 and 1440x1000; checked pages had no document-level horizontal overflow |
| Dark mode | PASS for tested page | Dark preference applied on 320px Settings; light mode exercised throughout other journeys |
| AI discovery constraints | FAIL | Expanded AI sheet bypasses travel filtering, reproduced below |
| Existing partner review access / telemetry | FAIL | New Our Picks drops review entry/ratings and old impression/save telemetry calls |
| Backend release compatibility | FAIL / unverified | Six-stop and end-time proposals unapplied by this task; revised routing/new discovery deployment and provider credentials/capabilities not certified |
| Live Google OAuth / real extraction / real routing | FAIL / unverified | Implementation retained, but no end-to-end staging/live-provider success test this audit |
| Database migration + RLS suite | FAIL / not run | Docker and bash unavailable in this shell; npm run check does not run test:db; HTTP fixture is not a substitute for PostgreSQL/RLS |
| Clean installation and remote CI | FAIL / not run | Existing node_modules used; fresh npm ci and hosted CI not verified; prior report documents an ignored local esbuild runtime workaround |
| Current-main comparison / publishable branch | FAIL | GitHub 404; dirty/untracked release contents; remote not renamed/pushed |
| Credential/artifact exclusion | PASS within scan scope | .env.local, dist and node_modules ignored; only .env.example tracked; no private-key/provider-secret/AWS-key-pattern hits in changed text files. This is a scoped scan, not a full secret-history certification |

## Exact functional findings

### R1 — High: expanded AI sheet bypasses discovery constraints

Files: src/pages/UnifiedPlanner.tsx:127, :244 and :280.

Main results call filtered(...), but the expanded sheet renders cards(aiVenues) directly. choose() only checks duplicate/six-stop selection, not eligibility. Reproduction on the production build with the isolated routing fixture:

1. Apply Sydney, set maximum journey to **1 minute** and choose AI Finds.
2. Find Places returns verified fixture candidates with **6 min** and **12 min** driving estimates. Main results exclude them.
3. Open Expand discovery chat: both candidates appear with Add to itinerary.
4. Selecting the six-minute candidate succeeds; itinerary becomes 1/6.

This also bypasses the main text/category filter path and can expose stale results while routing is unavailable/recalculating. Use one eligibility-derived result collection in both views, retaining already selected stops, and add a regression covering the sheet, mode/origin changes and unavailable routing. No application fix was made in this audit.

### R2 — Medium functional regression: partner reviews and attribution entry points

Files: src/lib/planner.ts:41, src/components/DiscoveryCard.tsx, src/pages/UnifiedPlanner.tsx:87; compare src/components/SponsoredVenues.tsx:47, :110, :130 and original src/pages/Home.tsx:1477.

The original partner picker exposed average/count, a reviews button and VenueReviewsDialog. partnerCandidate() omits review metadata, and the new Our Picks card exposes only selection. Browser QA confirmed no review action on the partner card. Existing post-event review handling remains in src/pages/Dashboard.tsx:232; review data/functions were not deleted. Personal saved-venue ratings still work and are separate from public partner reviews.

The old picker also recorded impressions, and the old confirmation flow recorded partner saved appearances. The new planner calls neither recordSponsoredEvents path. Partner analytics therefore lose these UI-generated signals. Restore the existing review entry points and correctly deduplicated attribution calls, or obtain explicit product approval for removing them. No live partner review submission/credit award was tested.

### R3 — High release gate: coordinated backend capabilities

Files: src/pages/UnifiedPlanner.tsx:189-191; supabase/migrations/20261027190000_six_stop_planner.sql; supabase/migrations/20261028120000_optional_event_end.sql; supabase/functions/travel-times and discover-venues.

The UI allows six stops for every account and optional end times but deliberately refuses unsupported confirmations. Missing capability settings can still block free accounts above two stops or open-testing/Premium above five, and any optional end time. Those are safe error states, not proof of the promised workflow on the intended backend. Existing endpoint versions can expose driving only; Places discovery requires the new function and approved provider access. Verify schema flags match actual enforcement, function versions, JWT/CORS, Maps API access, quotas and billing in staging. Approve a rollout plan or explicitly narrow the release scope before production.

No database migration, function deployment, production setting change or credential change was performed.

### R4 — Release verification and source completeness

Before a PR: regain read access to current GitHub main, compare the exact final commit, run merge-conflict checks again, include all reviewed source/assets, exclude generated/env files, run clean-install CI and the disposable PostgreSQL migration/RLS job, then staging OAuth/extraction/provider and guest/owner checks. The 404 is an access/not-found result, not evidence that GitHub main has no new commits. No PR was opened because the readiness condition is not met.

## Additional risks and visual refinements

- Event create/update writes remain nontransactional. Confirmation preserves pendingPlanId to avoid duplicates, but a retry skips createPlan and does not reconcile later-edited title/date/location with the already-created plan (src/lib/plannerApi.ts:19-31). This is a code-inspection finding; the changed-details-after-failure path was not fault-injected in this audit. Cover it before certifying recovery behavior. Existing retry tests check duplicate/partial-stop protection, not metadata edits between retries.
- End-to-end third-party social app delivery, native share sheet, invitation sends, review credit awards, fresh Google OAuth, real geolocation permissions and physical Android were not tested. Link formation and clipboard behavior were tested without sending messages.
- The six-stop reducer, origin/mode preservation, all 60 slider integers, unavailable-mode handling, geolocation callbacks, routing debounce/cache, ownership rejection, draft disclosure, reorder keyboard handling, scroll tracking, and explicit confirmation are exercised in automated tests. This does not validate Supabase RLS or real provider responses.
- Styling is not a blocker by itself: jagged accents and supplied wordmark/icon are integrated; desktop summary is visually sparse; label/copy refinement remains. At 320px the Settings appearance segmented control clips part of System. Rating star buttons lack individual accessible names (existing component issue). These require polish/accessibility follow-up, separate from R1/R2.
- Settings explicitly says Terms & privacy documents are not available yet. Resolve this product/documentation gap before treating the app as fully launch-ready; no legal-compliance certification is made here.
- The 393x852 development phone iframe is DEV-only. The production build tested on 5177 correctly rendered a full desktop sidebar rather than a permanent phone frame.
- Confirm deployment uses npm run build with the intended hosted VITE_SUPABASE_* values. npm run build:local / check intentionally substitute a disconnected local backend; do not publish their local-preview artifact. Process environment takes precedence over Vite env files. The hosted 5175 preview remained canonical, not the QA backend.
- Node .nvmrc and engines require 24.22.x. No dependency upgrade or clean installation was performed. Native Capacitor project is absent in this checkout; physical Android compatibility remains unverified.
- Local diff --check additionally reports pre-existing CRLF/trailing-whitespace warnings in index.html/src/main.tsx; not a functional blocker.

## Implemented inventory already in the working tree

- Shared Home / Events / Plan / Venues / Friends navigation; dashboard actual-data counts, saved cards and upcoming event entry; one primary planning CTA.
- Calendar/list events, host summary/editing, RSVP summary, supported sharing actions; existing legacy invitation and trip routes retained, trips still feature-disabled as before.
- Saved venue details/Plan/Share/Edit/Visited; saved ratings/notes, social-link extraction internals, collections/group collection infrastructure retained.
- One persisted draft, four discovery modes, six-category 3x2 mobile controls, six-stop guard, explicit random proposal Merge/Replace, duplicate guard, ordered editable stop times.
- Provider-capability travel modes, 1-60-minute slider, debounced/cached routing, per-leg estimates, consented distance fallback and verified-record external discovery service preparation.
- Progressive search disclosure, intent-gated venue-card mounting, viewport-fixed vertical-scroll progress with reduced-motion support; top stop-count overlay removed.
- Supplied brand artwork, charcoal graffiti accents, centralized light/dark tokens; local phone preview.
- Security regression suite and prepared backend hardening from the recovery commit. These changes are broader than a cosmetic-only PR.

## Changed-file manifest

Counts above describe the pre-report state. Main groups: src/pages (HomeDashboard, UnifiedPlanner, Events, Venues, Dashboard, Settings, auth pages); src/components (navigation, venue details/cards, planner counters/itinerary/sharing/disclosure/workflow); src/lib (planner/API, taxonomy, routing/discovery/travel, Supabase/auth boundaries); theme/brand assets; test/config/tooling; two proposed migrations; Edge Functions/security tests. No files were deleted.

Full 122-file audit-start manifest:

~~~text
.env.example
.github/workflows/ci.yml
.gitignore
.nvmrc
CLAUDE.md
docs/SUPABASE-REFERENCE-AUDIT.md
docs/UI-REBUILD-PLAN.md
docs/URBAN-ADVENTURE-PLAN.md
docs/V5-IMPLEMENTATION.md
docs/V5-TAXONOMY-AUDIT.md
docs/V5.1-DELIVERY.md
docs/V5.1-PLAN.md
docs/WEB-DEVELOPMENT.md
docs/category-inventory-READ-ONLY.sql
index.html
package-lock.json
package.json
public/brand/README.md
public/licenses/KNEWAVE-OFL.txt
public/sw.js
scripts/local-web.mjs
src/App.tsx
src/assets/fonts/README.md
src/assets/fonts/knewave-regular.ttf
src/components/Billing.tsx
src/components/BrandLogo.tsx
src/components/CategoryCounters.tsx
src/components/CategoryPicker.tsx
src/components/DiscoveryCard.tsx
src/components/EventCalendar.tsx
src/components/EventShareSheet.tsx
src/components/FlowArrow.tsx
src/components/ItineraryItem.tsx
src/components/MainNavigation.tsx
src/components/SavedVenueCard.tsx
src/components/ShareOnSocial.tsx
src/components/StopCard.tsx
src/components/VenueDetails.test.tsx
src/components/VenueDetails.tsx
src/components/ViewToggle.tsx
src/lib/apiKeys.travel.test.ts
src/lib/apiKeys.ts
src/lib/brand.ts
src/lib/calendar.test.ts
src/lib/calendar.ts
src/lib/discovery.test.ts
src/lib/discovery.ts
src/lib/eventTiming.test.ts
src/lib/eventTiming.ts
src/lib/flow.test.ts
src/lib/flow.ts
src/lib/openai.ts
src/lib/planner.test.ts
src/lib/planner.ts
src/lib/plannerAI.test.ts
src/lib/plannerApi.test.ts
src/lib/plannerApi.ts
src/lib/router.ts
src/lib/supabase.ts
src/lib/taxonomy.test.ts
src/lib/taxonomy.ts
src/lib/tour.ts
src/lib/travel.test.ts
src/lib/travel.ts
src/lib/useTravel.test.tsx
src/lib/useTravel.ts
src/main.tsx
src/pages/ChooseUsername.test.tsx
src/pages/ChooseUsername.tsx
src/pages/Confirmed.test.tsx
src/pages/Confirmed.tsx
src/pages/Dashboard.tsx
src/pages/Events.tsx
src/pages/Friends.tsx
src/pages/Home.tsx
src/pages/HomeDashboard.tsx
src/pages/Login.tsx
src/pages/Settings.tsx
src/pages/Subscription.tsx
src/pages/UnifiedPlanner.test.tsx
src/pages/UnifiedPlanner.tsx
src/pages/Venues.tsx
src/theme.css
supabase/config.toml
supabase/functions/_shared/ratelimit.test.ts
supabase/functions/_shared/ratelimit.ts
supabase/functions/_shared/urlguard.test.ts
supabase/functions/_shared/urlguard.ts
supabase/functions/_shared/webpush.ts
supabase/functions/_tests/database.ts
supabase/functions/_tests/runtime.ts
supabase/functions/_tests/service-worker.test.ts
supabase/functions/_tests/setup.ts
supabase/functions/address-suggest/index.ts
supabase/functions/ai-proxy/index.test.ts
supabase/functions/ai-proxy/index.ts
supabase/functions/discover-venues/index.test.ts
supabase/functions/discover-venues/index.ts
supabase/functions/send-push-notification/index.test.ts
supabase/functions/send-push-notification/index.ts
supabase/functions/travel-times/index.test.ts
supabase/functions/travel-times/index.ts
supabase/migrations/20261027190000_six_stop_planner.sql
supabase/migrations/20261028120000_optional_event_end.sql
vitest.edge.config.ts
docs/GRAFFITI-UI-REVIEW.md
docs/SUPPLIED-BRAND-INTEGRATION.md
docs/V6.1-UX-REPORT.md
public/brand/supplied/app-icon-dark.svg
public/brand/supplied/app-icon-light.svg
public/brand/supplied/app-icon-mono.svg
public/brand/supplied/app-icon-small-dark.svg
public/brand/supplied/horizontal-logo.png
public/brand/supplied/icon-color-transparent.svg
public/brand/supplied/icon-mono-transparent.svg
public/brand/supplied/icon-mono-white.svg
public/brand/supplied/icon-small-transparent.svg
src/components/PlannerDisclosure.tsx
src/components/WorkflowNavigator.test.tsx
src/components/WorkflowNavigator.tsx
src/pages/HomeDashboard.test.tsx
src/preview.css
~~~

## Evidence and audit-only changes

- work/release-readiness-check.log: complete existing npm run check output.
- work/release-production-preview.log: separate production-mode fixture build.
- work/release-audit-manifest.json, release-changes-tracked.tsv and release-untracked-files.txt: exact comparison manifests.
- outputs/release-ai-filter-bypass.png: reproduced AI sheet issue.
- outputs/release-summary-desktop.png: persisted reordered event, 1/1 guest RSVP, desktop production layout.
- outputs/release-guest-320.png, release-planner-320.png and release-settings-dark-320.png: narrow viewports.

This audit renamed the active local branch, wrote this report and generated isolated QA artifacts outside the app. It did not change application implementation, create a release commit, push, merge, deploy, apply migrations, or modify other branches. Test writes were restricted to the disposable HTTP backend on 54330; hosted 5175 configuration and data were preserved.

## Recommended next task

Fix R1 with a sheet-path regression; restore/approve R2 review and attribution behavior; cover the pending-ID metadata retry case. Then approve and validate backend compatibility in staging, obtain current-main/CI access and assemble the exact release commit on codex/ui-n-ux-updates. Open a PR into main only after these gates pass. Visual refinements can proceed independently after the functional blockers are addressed.
