# Supplied brand artwork

Current local UI uses the user-supplied files under `supplied/`, copied byte-for-byte on 29 October 2026.

- `icon-color-transparent.svg`: icon-only UI, authentication and welcome mark.
- `icon-small-transparent.svg`: smaller icon-only UI and browser favicon.
- `horizontal-logo.png`: supplied `05-horizontal-banner (1).png`, displayed intact in the header/sidebar; it already includes the icon and tagline.
- Remaining mono/light/dark SVGs: available for appropriate future surfaces, not switched automatically or forced into the interface.

`src/lib/brand.ts` controls the in-app assets. `index.html` points the favicon at the small SVG. No supplied artwork was recoloured, cropped or generated. The SVGs passed a bounded scan for scripts, handlers, foreign objects and external resources.

The PNG named `07-full-logo-transparent` is actually opaque and contains a visible checkerboard, so it is not used. Glass variants, reel thumbnails and social previews are not needed on everyday planning screens. A separate graffiti wordmark SVG without a tagline would improve very-small header clarity; the current horizontal PNG is retained intact until supplied.

Temporary generated mock assets were moved outside the application into the task's `work/superseded-brand-preview` folder, and are not shipped by the build. Previous reports describe historical previews. Faint background repeats were removed following the user's clarification that the intended watermark was the wordmark/logo. The charcoal/jagged UI remains.

Original legacy mark, Apple/PWA and native Android launcher icons remain unchanged; reconcile those through a dedicated export/installed-app check. No native build, deployment or migration was performed.
