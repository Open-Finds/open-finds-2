# Supplied brand integration — 29 October 2026

Replaced temporary generated assets with supplied artwork. All eight supplied SVG variants plus the horizontal PNG were copied intact under `public/brand/supplied/`. The active icon uses the full colour SVG; smaller icon-only placements and favicon use the small SVG. The header uses the supplied horizontal PNG as one complete lockup, avoiding a duplicate icon.

The supplied horizontal PNG includes a tagline and is not a standalone transparent wordmark. It is displayed intact on charcoal; a dedicated wordmark SVG would improve very-small-size clarity. No artwork was cropped, traced, recoloured or generated. The file named `07-full-logo-transparent` has an opaque checkerboard (corner alpha 255), so it was not used. The actual icon PNGs have alpha transparency; SVGs were selected for scalable UI rendering. Glass and social-media variants are reserved rather than added to routine screens.

Following the clarification that watermark meant wordmark/logo, large faint background duplicates were removed. The expressive charcoal banner, subtle jagged card paint strips and functional UI remain. App-wide artwork CSS variables were removed when they became unused. Original mock PNGs were moved out of public/ into the task's reversible `work/superseded-brand-preview` archive; original generated-image sources also remain untouched.

No layout restructuring, controls, routes, planner state, backend calls, credentials, dependencies or database changes were introduced. Existing uncommitted V6.1 and graffiti work is preserved on `codex/urban-graffiti-ui`. HEAD remains `3a131efa7be2d3767d5493e352cce5dbe0f18afc`. No commit/push/merge/deployment/migration.

Validation: `npm run check` passed TypeScript, ESLint (0 errors, 3 existing warnings), 174 frontend tests across 29 files, 82 handler/security tests across 7 files and local build. SVG active/external-content scan passed. Visual checks in the isolated disposable QA preview confirmed logos loaded and no horizontal overflow at 320px and 390px. No new production or physical-device behavior is claimed. PWA/Apple/native launcher assets remain a separate export/device validation step.

Current screenshots: `supplied-brand-320.png` and `supplied-brand-390.png` in the task's outputs folder; all records are disposable QA fixtures.
