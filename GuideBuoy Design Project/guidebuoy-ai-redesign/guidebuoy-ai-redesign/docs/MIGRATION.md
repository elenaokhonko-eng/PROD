# MIGRATION — porting the v3 redesign into the GuideBuoy AI Next.js app

Target stack (production): Next.js (App Router), Tailwind CSS, Clerk auth,
Supabase, Stripe. Current public site: guidebuoyai.sg.

This package is framework-agnostic static HTML + CSS + vanilla JS so agents
can port it incrementally, component by component, without a big-bang rewrite.

---

## 1. Design tokens → global styles

| This package | Production target |
|---|---|
| `design-system/tokens.css` | Import at the top of `app/globals.css` (after `@tailwind` directives) — keep the `:root`, `[data-theme="dark"]`, `[data-sensory="quiet"]`, grounding keyframes, and reduced-motion blocks verbatim |
| `design-system/base.css` | Merge into `app/globals.css` (focus rings, input styles, `.gb-mode-switch`, `#gb-grounding`, `.gb-num`, `.shadow-ambient`) |
| `design-system/tailwind.config.js` | Port the `theme.extend` object into `tailwind.config.ts` **unchanged** — colors intentionally reference `var(--gb-*)` so modes/theme work without class changes |

Do not replace the CSS-var indirection with literal hexes — the three
emotional-state modes depend on it.

## 2. Mode switcher → client component

`design-system/mode-switcher.js` is dependency-free; wrap it as a client
component:

```tsx
// app/components/ModeSwitcher.tsx
"use client";
import { useEffect } from "react";
export default function ModeSwitcher() {
  useEffect(() => { /* init logic from mode-switcher.js */ }, []);
  return ( /* the .gb-mode-switch markup from components/header.html */ );
}
```

- Persistence: keep `localStorage` for anonymous users. On sign-in (Clerk
  webhook or first session), mirror `gb-sensory-mode` into the user's
  Supabase profile (`profiles.sensory_mode`) and hydrate from it on login.
- `<html data-sensory>` must be set before paint to avoid a flash: add a
  tiny inline script in `app/layout.tsx` `<head>` that reads localStorage
  and sets the attribute (same pattern as dark-mode anti-flash scripts).
- Grounding overlay: mount once in the root layout; it must cover every
  route including checkout and error boundaries.

## 3. Header / footer → layout

- `components/header.html` → `app/components/PublicHeader.tsx`
  (nav, mode switcher, Sign In). Replace `%%ACTIVE:*%%` build-time classes
  with `usePathname()` active-state logic. Keep the mobile drawer.
- `components/footer.html` → `app/components/Footer.tsx` (content is
  static company facts — keep verbatim).
- The single WhatsApp float (in the page template) → root layout, exactly
  once. Remove any existing duplicate floats (the current site also has a
  Lumi float — Lumi becomes a header/inline assistant affordance, not a
  second floating button).

## 4. Pages → app router routes

| Static page | Route |
|---|---|
| `pages/home.html` | `app/page.tsx` (replace current landing) |
| `pages/how-it-works.html` | `app/how-it-works/page.tsx` (replaces/absorbs current `/product`) |
| `pages/pricing.html` | `app/pricing/page.tsx` (new) |
| `pages/marketplace.html` | `app/marketplace/page.tsx` |
| `pages/resources.html` | `app/resources/page.tsx` |
| `pages/about.html` | `app/about/page.tsx` |
| `pages/faq-contact.html` | `app/faq/page.tsx` |

Each `pages/*.html` file is assembled from `pages-src/<name>.html` content
between the shared header/footer — port the **content block** into JSX
(`class` → `className`, `for` → `htmlFor`, self-close `<img/>`, convert
`<details>` accordions as-is; they work natively).

Public nav becomes: Home · How it Works · Pricing · Marketplace ·
Resources · About · FAQ. **Remove `Analytics` from public navigation**
(internal route). Keep a redirect `/product → /how-it-works`.

## 5. Imagery

- `assets/lumi-buoy.jpg` → `public/assets/lumi-buoy.jpg`; use `next/image`.
- Anything decorative gets `className="gb-illo"` so Quiet mode hides it.
- Replace the old Google-hosted aida-public image URLs (they expire).

## 6. Authenticated app ( Families B–I )

This package ships the public shell. The authenticated workspace
(case bootstrap, evidence upload, gap questions, drafts, checkout, report
hub, FIDReC surfaces) must follow `docs/guidebuoy-google-stitch-design-brief.md`
Sections 9–17 with these v3 amendments:

- same tokens.css palette and the same three modes (selector lives in the
  authenticated case shell header too — see stitch-brief-v3 § modes);
- plan badge names: **Free / Bank Pack / FIDReC Pack**;
- all processing/progress UI uses step labels, never fake percentages;
- errors use Muted Terracotta + fix-it copy, never red alarms.

## 7. Suggested agent task breakdown (Git-friendly)

1. `chore/design-tokens`: add tokens.css + base.css + tailwind.config changes.
2. `feat/mode-switcher`: ModeSwitcher component + layout wiring + persistence.
3. `feat/public-header-footer`: header/footer components, nav update,
   remove Analytics, single WhatsApp float.
4. `feat/page-<name>` × 7: one PR per page from `pages-src/`.
5. `feat/app-shell-modes`: extend selector to authenticated layout.
6. `chore/cleanup`: remove legacy palette classes (`#1a3a6b` navy etc.),
   old floats, expired image URLs.

Each PR is independently reviewable and revertable.
