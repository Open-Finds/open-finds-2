# AI Rules

## Tech Stack

- **React 18** with **TypeScript** — all source code is `.tsx`/`.ts`
- **Vite** — dev server and production build
- **React Router** — routing lives in `src/App.tsx`
- **shadcn/ui** — reusable UI components in `src/components/ui/` (built on Radix UI primitives)
- **Tailwind CSS** — all styling via Tailwind utility classes
- **lucide-react** — icon library
- **Supabase** (`@supabase/supabase-js`) — database, auth, and edge functions
- **Stripe** (`@stripe/stripe-js`, `@stripe/react-stripe-js`) — payments and billing
- **Vitest** + **Testing Library** — unit and component tests

## Library Usage Rules

| Purpose | Library / Location | Notes |
|---------|-------------------|-------|
| UI components | `src/components/ui/` (shadcn/ui) | Do not edit shadcn/ui files directly; create new components that compose them |
| Layout & pages | `src/pages/` | Each route gets a page component; keep pages thin |
| Shared components | `src/components/` | Non-UI, feature-specific components go here |
| Routing | `src/App.tsx` | All route definitions stay here; do not scatter routes elsewhere |
| Styling | Tailwind CSS classes | Use Tailwind utilities exclusively; avoid inline styles and CSS files |
| Icons | `lucide-react` | Import icons from `lucide-react` only |
| Animations | `framer-motion` | Use for entrance/exit and layout animations |
| Styling utilities | `clsx`, `tailwind-merge`, `class-variance-authority` | Use for conditional class composition and variant APIs |
| Notifications | `sonner` | Use for toast notifications |
| Theme | `next-themes` + `src/components/ThemeProvider.tsx` | Dark/light mode handling |
| Database / Auth | Supabase client (`src/lib/supabase.ts`) | Single source for Supabase instance; use edge functions for server logic |
| Payments | Stripe JS + React Stripe JS | Client-side payment elements and checkout |
| HTTP / API | Supabase client or edge functions | No raw `fetch` to external APIs unless wrapped in `src/lib/` |
| Tests | Vitest + Testing Library | Tests live next to source files (`*.test.tsx` / `*.test.ts`) |

## General Rules

- Keep source code under `src/`; pages in `src/pages/`, components in `src/components/`
- The main entry page is `src/pages/Index.tsx` (or `Home.tsx` as the default route)
- Always update `src/App.tsx` when adding new routes
- Prefer shadcn/ui components over building custom UI from scratch
- Use TypeScript strictly; avoid `any` where possible
- Do not add new dependencies without checking if an existing library already covers the need