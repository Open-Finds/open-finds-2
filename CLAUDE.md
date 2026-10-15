# The Unsaved — AI implementation guide

Use this guide when Claude or another coding agent builds with The Unsaved design system.

## In this repository (read first)

The guide below is the design library's own export (Lovable, draft v0.2). This app does not attach the library as a folder; the same system is implemented in the app's own files, on its existing stack (React 18, Tailwind CSS 3, Vite). Where the guide says `@/design-system/the-unsaved`, use these instead:

| What | Where it lives here |
| --- | --- |
| Tokens (light and dark), font face | `src/index.css` (`:root` and `.dark`) |
| Token utilities, type roles, radii, the two gradients | `tailwind.config.js` |
| Font file (Bricolage Grotesque) | `src/assets/fonts/bricolage-grotesque.woff2` |
| `Button`, `Input`, `Textarea`, `Select`, `Switch`, `Badge`, `Card`, `Dialog`, `Sheet`, `Skeleton`, `Tabs` | `src/components/ui/` |
| `SegmentedControl` | `src/components/ui/segmented-control.tsx` |
| `ThemeProvider`, `ThemeSwitch` (light / dark / system) | `src/components/ThemeProvider.tsx` |
| Buttons for a plain `<button>` | `.btn-primary`, `.btn-secondary`, `.btn-outline`, `.btn-ghost`, `.btn-ai`, `.btn-destructive`, with `.btn-sm` / `.btn-lg` (`src/index.css`) |
| Class merging that understands the type roles | `cn()` in `src/lib/utils.ts` |

Rules that follow from that:

- Colour utilities are the semantic ones only: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `border-input`, `bg-primary-soft`, `text-primary-text`, `bg-ai-soft`, `text-destructive-text`, `bg-success-soft`, and so on. The old `gold`, `ink`, `surface`, `danger` and `pending` names are gone; do not bring them back, and do not write `bg-black`, `text-white` or hex values.
- Radii: `rounded-sm` 10px (a tab inside a control), `rounded-md` 12px (buttons, fields), `rounded-lg` 16px (cards), `rounded-full` (chips, badges).
- Shadows: `shadow-1`, `shadow-2`, `shadow-3` only. No glow.
- Third-party surfaces that cannot take classes (Stripe's payment fields) read the tokens at runtime: see `stripeAppearance()` in `src/lib/stripe.ts`.
- Do not upgrade React or Tailwind as part of a visual change.

### Jacky's overrides (2026-10-15)

These replace the matching rules in the library guide below:

- Light mode is neutral white and light grey (like Instagram and Facebook's light mode), not cream: the `:root` tokens in `src/index.css`.
- The main planning action (Start Planning) uses `.btn-brand`, and selected navigation tabs wear the same orange-yellow gradient (`ViewToggle`). Robert found the logo's ring too colourful there (2026-10-15).
- Save Venue uses info: `.btn-info`. Edit (pencil) icons use `text-info`, and so do text links.
- Settings' action buttons (Save Name, Save Username, …) use `.btn-ai-soft`: `ai-soft` in light mode, `ai` in dark.
- "Add your first venue" style highlights use an `ai-soft` pill.
- Dietary and preference tags, and venue tags, are `ai-soft` / `ai-soft-foreground`, always the same colour.
- Character: category icons (🍔 🍸 🍰 🎯, `TYPE_ICONS` in `src/lib/partners.ts`) on category badges, and venue photos from Google (`VenueThumb`, venue-photo function), with the category icon shown when there's no photo.
- Extract Venue and other AI actions stay `ai`.

## Purpose: give your agent a shared UI contract

This guide teaches your coding assistant which components, fonts, tokens, and accessibility rules to use. It reduces invented styles and inconsistent interfaces across tasks. It is instruction context, not executable code: downloading it does not install the library, add an editor extension, or connect a service. Your agent still needs the actual library source.

## Install the library before adding instructions

1. In Lovable, attach the published The Unsaved library to your project. Attach copies a versioned snapshot of the library source into your repository. To get future changes, publish a new library version and accept the update in the consumer project.
2. For a project outside Lovable, get the complete library source from the author. Copy the reusable components, helpers, `styles.css`, `index.ts`, and `assets` into `src/design-system/the-unsaved/`, preserving relative paths. Exclude showcase files and preview routes. There is no public npm install command promised by this guide.
3. This library targets React 19 and Tailwind CSS v4. Configure Tailwind through your build tool; ensure it scans the attached library folder. Keep the shipped CSS with its relative font URL. If your project uses an `@/` alias, it must resolve to `src/`.
4. Install the runtime dependencies listed below if your project does not already have compatible versions. A Lovable attach normally merges the library dependencies for you.

```sh
bun add react@19.2.7 react-dom@19.2.7 tailwindcss@4.3.3 next-themes@0.4.6 class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.6.0 lucide-react@0.575.0 sonner@2.0.8 @radix-ui/react-dialog@1.2.0 @radix-ui/react-popover@1.2.0 @radix-ui/react-select@2.3.8 @radix-ui/react-slot@1.3.3 @radix-ui/react-tabs@1.1.22
```

Use your own package manager's equivalent if needed. Review existing versions before installing; do not overwrite a working application's dependency choices blindly. Tailwind's Vite plugin is a build integration, not an editor plugin.

## Add instructions to your development tool

Choose one format for your tool; all exports contain the same core guide.

| Tool | Download | Where it goes | How to use it |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` | Repository root | Claude Code reads project instructions. Merge with an existing file rather than replacing it. |
| Claude chat | `the-unsaved-ai-guide.md` | Upload to the conversation or Project knowledge | Ask Claude to follow the uploaded guide; this does not give it your source automatically. |
| Cursor | `the-unsaved.mdc` | `.cursor/rules/the-unsaved.mdc` | The export includes `alwaysApply: true`; it applies as a project rule. |
| GitHub Copilot | `copilot-instructions.md` | `.github/copilot-instructions.md` | Enable repository custom instructions if your client requires it; merge existing guidance. |
| Codex / agents supporting AGENTS.md | `AGENTS.md` | Repository root | Instructions apply to the repository scope. More local instructions may override them. |
| Other coding assistants | `the-unsaved-ai-guide.md` | Project context or custom-instructions attachment | Explicitly reference the guide at the start of UI tasks. |

Create missing folders, keep these files in version control, and start a fresh agent conversation after adding them. Instruction discovery depends on your tool and version: if it does not load the file automatically, attach or reference it directly. These exports are project rules, not tool configuration or credentials.

## First task to give your agent

```text
Read the project design-system instructions and inspect the attached library.
Use its exported components and semantic tokens, not a replacement UI kit.
Build a labeled venue-name field and one Save venue primary action.
Preserve existing routes, authentication, and business logic.
Check light and dark themes, keyboard focus, and mobile overflow.
```

Ask the agent to identify the real import path before editing. The examples use `@/design-system/the-unsaved`; replace that with the actual attached folder name. Run your project's normal checks, then visually inspect the result. Keep the instruction exports synchronized with the library version.

## What this system is

The Unsaved helps people turn saved social videos into real plans. The interface should feel calm, useful, and human. Most surfaces are neutral. Amber shows the main action or selected state. Violet is only for AI-powered features.

## Setup

Import the library from its attached barrel. The barrel loads the canonical Tailwind theme stylesheet. Wrap the app once with `ThemeProvider` so light, dark, and system appearance work and persist.

```tsx
import { ThemeProvider, Toaster } from "@/design-system/the-unsaved";

export function App() {
  return (
    <ThemeProvider>
      <YourRoutes />
      <Toaster />
    </ThemeProvider>
  );
}
```

## Color rules

- Use semantic utilities: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, and `border-border`.
- Use one filled `primary` button per view or state.
- Use `primary-text` and `primary-soft` for links, active navigation, and selected controls.
- Use `ai`, `ai-soft`, and `ai-soft-foreground` only for AI actions and AI results.
- Use success, warning, destructive, and info colors only for their meaning. Pair status color with an icon and text.
- Never add raw hex, RGB, HSL, Tailwind palette colors, glow, or unapproved decorative gradients.
- Approved exceptions: `bg-brand-ring` matches the location icon's violet–orange–cyan orbit; `bg-primary-gradient` matches its orange–yellow body. Primary Button applies the warm gradient automatically. Use the ring only for an intentional brand treatment, never as a page wash or AI status. Do not manually restyle buttons with it.

## Typography

Use Bricolage Grotesque and the named roles: `text-display`, `text-title`, `text-heading`, `text-subheading`, `text-body`, `text-small`, `text-label`, and `text-caption`. Use `tabular-nums` for dates, times, counts, and RSVP totals. Caption is the only uppercase style. Nothing is smaller than 12px.

## Component choices

- `Button`: actions. Use `asChild` for links.
- `Input`, `Textarea`, `Select`: labeled form fields.
- `Switch`: a setting that takes effect immediately.
- `SegmentedControl`: one choice between closely related modes.
- `Chip`: filters, categories, and removable tags.
- `Badge`: noninteractive status or metadata.
- `Card`: a repeated item or discrete tool. Do not nest cards.
- `Dialog`: focused desktop tasks.
- `Sheet`: mobile-first secondary tasks and details.
- `EmptyState`: empty collections and result sets, with at most one action.
- `Skeleton`: loading placeholders.
- `Logo`: standard brand presentation. Use `mark` for the icon and `lockup` for icon plus live text.
- `BrandLogo`: the original full supplied artwork only.

## Button hierarchy

```tsx
<Button>Save venue</Button>
<Button variant="secondary">Start planning</Button>
<Button variant="outline">Open reel</Button>
<Button variant="ai"><Sparkles />Try something new</Button>
```

Only the most important current action is `primary`. Icon-only buttons use `ghost` or `outline`, have an `aria-label`, and keep a 44px target. Reserve the sparkles icon and `ai` variant for genuine AI actions.

## Forms and feedback

Every field has a visible label connected with `htmlFor` and `id`. Helper text uses `text-small text-muted-foreground`. Errors use `aria-invalid`, `aria-describedby`, an alert icon, and destructive text. Do not use placeholder text as the label.

```tsx
<label className="text-label" htmlFor="venue-name">Venue name</label>
<Input id="venue-name" placeholder="Enter a venue name" />
```

## Accessibility

- Use semantic elements and keep every action keyboard reachable.
- Keep visible focus rings and at least 44px touch targets for primary controls.
- Give icon-only controls an accessible label.
- Do not communicate state with color alone.
- Let Dialog and Sheet manage focus, Escape, and focus return.
- Respect reduced motion. Do not add looping animation.

## Responsive composition

Use 16px page padding on mobile, 24px on tablet, and 32px on desktop. Use 16px between cards and 32px between sections. For rows with text and fixed controls, use a two-column grid with `minmax(0,1fr)`, `min-w-0` on text, and `shrink-0` on controls.

## Do not

- Do not create a second token palette or hardcode visual values.
- Do not use amber or violet as decorative borders or background washes.
- Do not add glow, blur decoration, radial backgrounds, or looping motion. Only use the approved brand-ring and primary-button gradient tokens, not new gradients.
- Do not invent a new logo treatment or crop the full logo artwork for the icon.
- Do not put cards inside cards or wrap full page sections in cards.
- Do not change product logic, routes, data, or authentication during a visual pass.

## Before delivery

- Check light, dark, and system themes.
- Check phone, tablet, and desktop widths.
- Check keyboard focus, labels, errors, disabled states, and loading states.
- Confirm there is at most one filled primary button in each view or state.
- Confirm violet appears only on AI features.
- Confirm no raw color, glow, clipping, or horizontal overflow remains.
