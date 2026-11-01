# UI/UX Update 1.0 — blocker fixes

Continues feature/ui-ux-update-v1.0 and PR #1. No visual redesign, new services or production migrations.

## Changes

- Main AI discovery and the expanded sheet render the same current eligibility-filtered pool. Selection checks that pool again. Category/search preferences, supported modes, route readiness and travel limits apply consistently. AI records are scoped to the requested origin; responses from older location revisions and unmounted searches are discarded. Existing itinerary selections are retained.
- Our Picks uses existing partner rating metadata and the existing public VenueReviewsDialog. Public review operations remain separate from private saved-venue notes/ratings. Displayed eligible partners receive one impression per planner/account session. Successful event confirmation records unique partner save attribution, never selection or failed confirmation. Existing record_venue_events RPC retains its server-side daily deduplication; attribution remains best effort.
- Pending-event retry validates existing stops, reads the existing plan and reconciles current title/date/location/type/end details before retrying missing stop writes. Removing an optional end clears a previously stored end pair. Missing or ambiguous pending events fail without creating another event. Ownership-filtered updatePlan and existing RLS remain in effect; writes are still sequential rather than a new transactional backend.
- Both repository shell scripts use LF. The new .gitattributes rule enforces LF for *.sh. Script logic and all migration SQL are unchanged.

## Validation

- 39 focused planner/API regression tests passed.
- Full local suite: TypeScript passed, lint passed (three existing Fast Refresh warnings), 187 frontend tests and 82 security/handler tests passed.
- npm run check and a separate npm run build passed.
- Isolated production-build mobile QA: partner reviews entry/dialog and exclusion of six-/twelve-minute AI candidates at a one-minute limit verified. No production data was used for test writes.
- Shell scripts contain no CR bytes; git diff --ignore-space-at-eol confirms no shell logic change. Hosted migration/RLS CI results are recorded in PR #1 after publication.

## Regression coverage added

- One-minute bypass in both AI surfaces; shared category filtering; pending, unavailable and unsupported routing; preservation of existing stops.
- Stale in-flight and completed AI results after location changes, plus resolving a starting location directly from Find Places.
- Public review/rating entry and submit path; separation from saving a private venue; impression deduplication across rerenders/modes; no impression for excluded partners; save attribution only after successful confirmation.
- Partial network failure followed by edited name/date/location/overnight end; optional-end removal; metadata-update failure; missing/ambiguous pending events; duplicate-event protection.

## Still requires approval / staging validation

- Verify intended hosted six-stop and optional-end-time capabilities, revised travel-times/discover-venues functions, provider API access/quotas, JWT/CORS and real OAuth/extraction/routing. No backend rollout or migration was performed here.
- Vercel currently reports that the Hobby plan cannot deploy this private organization repository. Resolve hosting/plan requirements through an approved account decision; this code change does not change billing, repository visibility or deployment configuration.
- Production changes require explicit user approval. No merge or deployment is part of this fix.
