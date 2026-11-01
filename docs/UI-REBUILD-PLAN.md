# October UI rebuild plan

Reference: all 14 PDF screens reviewed; updated user prompt overrides the PDF's orange palette and single-mode planning. Preserve React 18, Vite, hash routing, Supabase Auth, existing services and UI primitives.

1. Purple light/dark tokens, responsive five-item navigation with central Plan; Settings moves to the header/sidebar.
2. Data-backed Home dashboard, read-only Events calendar/list, existing venue/collection/social/settings flows refreshed additively.
3. One account-scoped planner draft and reducer. Four discovery modes feed one six-stop itinerary. No database writes before final confirmation. Reuse existing plan/stop persistence, invitations and guest RSVP.
4. Refresh host summary/editing and share sheet; keep account and guest access separate.
5. Regression tests for draft preservation, duplicates, limits, random saved-only selection, final-confirm writes, editing and navigation; browser check both themes/mobile.

Findings: saved_venues.visited already persists; real venue_partners/admin/RPCs exist; existing AI output lacks reliable external place IDs. AI Finds will rank only provided saved/partner record IDs, never model-generated names/addresses. Nightlife uses an explicit tag while retaining the existing four-type database contract. No Capacitor project in this checkout.

Backend gap: current premium stop ceiling is five (free two). The user approved six stops for all accounts. A forward six-stop-cap migration and capability flag are prepared but unapplied. Until approval and backend rollout, confirmation checks that capability before exceeding the previous limit and preserves the draft. Optional separate meet-up/end-time fields and date-specific music-event entities are absent; starting location reuses plans.location and event start uses the first stop time.

Changes are made on codex/ui-ux-rebuild-october-2026 in an isolated clone because Windows denies Git-ref writes in the original checkout. Existing uncommitted stabilization work was copied, credentials excluded. No push/deploy/migration execution.
