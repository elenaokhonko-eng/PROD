# GuideBuoy AI — Website Redesign Package (v3, "Harbor")

Drop-in redesign assets for the GuideBuoy AI website. Implements the
**design-tokens v3** system: the calm Harbor palette, Inter typography, and
the **three emotional-state design modes (Steady / Quiet / Grounding)** with
the mode selector present on every screen at all times.

Built for: VS Code agents updating the production UI/UX source code
(Next.js + Tailwind + Supabase + Stripe) and pushing to GitHub.

---

## 1. What's inside

```
guidebuoy-ai-redesign/
├── README.md                     ← you are here
├── design-system/
│   ├── tokens.css                ← SINGLE SOURCE OF TRUTH: Harbor tokens,
│   │                               [data-sensory] modes, [data-theme] dark,
│   │                               grounding breathing animation
│   ├── base.css                  ← base element styles, focus, inputs,
│   │                               mode-switcher + grounding overlay styles
│   ├── tailwind.config.js        ← Tailwind theme mapping colors → CSS vars
│   └── mode-switcher.js          ← Steady/Quiet/Grounding logic, persistence,
│                                   grounding overlay, screen-reader announcements
├── components/
│   ├── header.html               ← shared public-shell header WITH mode switcher
│   └── footer.html               ← shared footer (company facts)
├── pages-src/                    ← page CONTENT blocks (no header/footer)
├── pages/                        ← assembled, self-contained preview pages
│   ├── home.html  how-it-works.html  pricing.html  marketplace.html
│   ├── resources.html  about.html  faq-contact.html  (index.html = redirect)
├── assets/
│   └── lumi-buoy.jpg             ← Lumi brand render (approved asset)
├── scripts/
│   └── build.py                  ← re-assembles pages/ from components+pages-src
└── docs/
    ├── stitch-brief-v3.md        ← master design brief (rules, tiers, modes)
    ├── design-tokens-v3.md       ← token spec + contrast notes + do/don'ts
    ├── DESIGN.md                 ← "Harbor Steady" theme spec (Stitch export)
    ├── guidebuoy-google-stitch-design-brief.md  ← dynamic app spec (families A–I)
    ├── MIGRATION.md              ← how to port this into the Next.js codebase
    └── copy/                     ← approved page copy (7 markdown files)
```

## 2. Preview

Open `pages/home.html` in a browser (or serve the folder:
`python3 -m http.server` from this directory, then visit
`http://localhost:8000/pages/`). Try the **Steady / Quiet / A moment**
control in the header — it persists across pages via `localStorage`.

To rebuild `pages/` after editing `components/` or `pages-src/`:

```bash
python3 scripts/build.py
```

## 3. The design contract (do not break)

1. **Colors come from `tokens.css` CSS variables only.** Never hardcode
   hex values in components/pages. Tailwind classes (`bg-primary`,
   `bg-tint-sage`, `text-text-slate`, …) already resolve through the vars.
2. **The mode switcher stays on every screen** — header partial is
   mandatory; never remove or demote it.
3. **Modes change sensory intensity only** — layout, content, and
   navigation positions are identical across Steady/Quiet/Grounding.
4. **Decorative imagery carries `class="gb-illo"`** so Quiet mode can
   hide it. Errors/deadline colours never flatten (clarity is safety).
5. **One dominant primary action per screen**: `bg-primary` +
   `text-on-primary`; everything else secondary/text links.
6. **Banned everywhere:** bright red, neon orange, bright yellow, pure
   `#000` on `#FFF`, color-only meaning, flashing/pulsing UI, urgency by
   colour, streaks/guilt mechanics.
7. **Formats:** money `SGD 12,400.00`, dates `29 Mar 2026`, numbers use
   `.gb-num` (tabular numerals).
8. **Tier names:** User Pack (free), Bank Pack (one-off), FIDReC Pack
   (SGD 800; optional SGD 99 consult). Never say "Tier 0/1/2" to users.
9. Soft Teal `#7FB5B2` is the Grounding breathing element **only** —
   never a button fill on light backgrounds (contrast fail).
10. Single WhatsApp entry point (bottom-right float, already in the page
    template). Never add competing floating buttons.

Full rules: `docs/stitch-brief-v3.md` § Global rules.

## 4. Porting to the production Next.js app

See `docs/MIGRATION.md` for the file-by-file mapping (tokens.css →
globals.css, tailwind.config.js → tailwind.config.ts, header/footer →
layout components, mode-switcher.js → client component + profile sync,
pages → app-router routes).
