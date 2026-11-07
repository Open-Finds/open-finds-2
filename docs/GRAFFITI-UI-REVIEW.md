# Urban graffiti UI review — 29 October 2026

## Scope and approval

User approved both a graffiti wordmark and a faint graphic watermark, recommended charcoal banners/subtle jagged cards, and temporary preparation from the supplied mockup sheet pending separate PNG/SVG exports. This approval supersedes the earlier restriction on mockup-derived artwork for this local preview. No further interaction or workflow changes were requested.

Branch: `codex/urban-graffiti-ui`; HEAD remains backup commit `3a131efa7be2d3767d5493e352cce5dbe0f18afc`. The previous uncommitted V6.1 UX work is retained. This visual pass adds changes on top without commits, pushes, merges, deployments or migrations.

## Implemented

- Temporary transparent colourful pin/orbit/star icon and cream graffiti wordmark from the approved reference. Headers/sidebar display both in a charcoal sticker. Icon-only existing logo uses receive the new icon through the same asset map.
- Faint icon watermark behind main pages plus low-opacity icon and wordmark artwork in the home banner.
- Charcoal banner, colourful rough paint rail, existing Knewave display font and restrained violet shadow. Existing functional typography remains readable.
- Asymmetric card corners and a narrow torn paint strip on discovery, saved/adventure, upcoming-event, statistics and itinerary cards. Section headings get small brush underlines. These are CSS pseudo-elements with `pointer-events:none`; whole cards and controls are never clipped into jagged shapes.
- Existing official tagline reused in the sidebar. Button labels, navigation, routes, forms, event/venue logic, planner state, category/travel behavior and APIs are unchanged in this pass.
- Uses existing colour tokens plus centralized charcoal/paper and decorative-rip tokens. Watermark image paths inherit from `brandArtworkStyle`, so replacing the central asset map updates all consumers.

## Assets and replacement

Project assets:

- `public/brand/mock-icon.png` — 1254×1254, 538,039 bytes.
- `public/brand/mock-wordmark.png` — 2172×724, 886,504 bytes.

Built-in imagegen was used; these are approximate source-derived temporary assets, not deterministic extractions of original vector artwork. The supplied JPG is a flattened mockup. A first wordmark output included an unwanted glow; it was rejected and cleaned in a second image edit. Only the chosen icon and cleaned wordmark were copied into the application. Both PNGs have transparent corner pixels and load successfully in the browser. Some extra distressing remains in the generated lettering. Combined source PNG weight is about 1.4 MB; final exports should be optimized before release.

When the clean exports arrive, update `brandAssets.mark`, `brandAssets.wordmark` and height in `src/lib/brand.ts`, then recheck padding/contrast and header fit. No business logic changes are needed. Existing original mark, favicon, PWA/Apple and Android installed icons remain intact; a final export pass should reconcile those intentionally rather than ship enlarged mock assets as production launcher icons.

### Built-in imagegen prompts

Icon edit, with the supplied sheet as reference:

> Extract faithfully ONLY the colorful map-pin/orbit/star icon from this supplied brand mockup sheet, using the large top-left version for detail. Preserve the orange/yellow pin loop and coral point, four-point star, purple pink cyan orbital brush and small splash marks. No text. No square icon tile, no mockup background, no checkerboard, no shadows. Center the complete uncropped icon with modest transparent padding on square true-transparent canvas. This is a temporary source-derived asset, not a logo redesign.

Initial wordmark edit, with the supplied sheet as reference (intermediate output not shipped):

> Extract faithfully ONLY the horizontal graffiti lettering THE UNSAVED and its orange-pink-purple-cyan underline from this supplied mockup. Use the central right horizontal banner as the typography reference, preserving exact spelling THE UNSAVED and white/cream brush lettering. Omit the icon and omit the tagline and dividing rule. No new typography, no additional marks, no mockup sheet, no background/checkerboard/shadow. Wide compact horizontal transparent canvas with complete uncropped lettering and modest padding. White lettering is intended for charcoal backgrounds. This is a temporary source-derived asset, not a logo redesign.

Final wordmark cleanup, editing that intermediate output:

> Clean up this existing THE UNSAVED wordmark for a web UI. Preserve exact lettering, layout, color underline, and spelling. REMOVE ALL glow, shadows, haze, feathering, blur and semi-transparent clouds around the logo. White/cream graffiti letters and sharply bounded colored brush underline ONLY. Everywhere outside the actual painted letters/underline must have alpha=0, true transparent. Do not paint a dark background or checkerboard. No radiating light. Keep complete lettering uncropped. Compact wide 3:1 composition, modest 3% padding. This is asset cleanup, no redesign.

## Validation

`npm run check` passed: TypeScript; ESLint 0 errors/3 pre-existing Fast Refresh warnings; 174 frontend tests across 29 files; 82 security/handler tests across 7 files; local build. No new tests were added for reversible visual styling; existing workflow regression coverage was reused.

Visual QA used the isolated local fixture backend/preview at `http://127.0.0.1:5175/`. The screenshots contain disposable QA records, not actual user data. Observed 320×844 and 390×844 mobile widths and 1280×900 desktop: no horizontal overflow; header logos loaded; light/dark banner text and buttons readable; category/travel controls and itinerary still available; main-navigation switching and preserved draft work. Computed card styles confirm no whole-card clip-path and decorative hit testing disabled. This pass did not exercise live OAuth/provider calls or a physical Android/iPhone, and makes no new production verification claim.

## Files changed in this visual pass

- `src/App.tsx` — artwork CSS variables only.
- `src/lib/brand.ts` — temporary asset map and inherited artwork variables.
- `src/components/BrandLogo.tsx` — icon/wordmark lockup.
- `src/components/MainNavigation.tsx` — official brand tagline.
- `src/theme.css` — decorative skin only, added after V6.1 styles.
- `public/brand/mock-icon.png`, `mock-wordmark.png`, `README.md`.
- This document.

Existing V6.1 changes remain separate in the local history of this task and are included in the current uncommitted tree. No backend, environment, dependency, migration or workflow file was changed by this visual pass.

## Screenshots

The task's `outputs` directory contains light home at 320/390px, dark home at 390px/desktop, dark discovery cards and dark itinerary. These are intended for visual review before final artwork replacement or release.
