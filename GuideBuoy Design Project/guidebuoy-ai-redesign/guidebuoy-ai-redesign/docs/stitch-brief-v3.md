# GuideBuoy AI — design brief v3 (Google Stitch master)

One document carrying everything a designer needs: the business, the brand,
the product tiers, the three-mode emotional-state design system, the dynamic
application, and the public pages with the job and content of each.

**What changed in v3 (supersedes v2):**

1. **Palette** — the v2 teal/seafoam/gold scheme is replaced by the
   research-backed **"Harbor" palette** from `design.md` (trauma-informed,
   neurodivergent-first: Harbor Teal, Sage, Dusty Blue, Lavender Ash on
   warm Cream; Muted Terracotta / Ochre semantics; verified WCAG ratios).
2. **Three emotional-state design modes** — the website now ships as
   **three complete, user-swappable design variants** (Steady / Quiet /
   Grounding) matched to how the user feels right now. The mode selector
   is **present on every screen at all times**. Google Stitch must produce
   every screen in all three variants.
3. Everything else from v2 stands: tier naming (User Pack / Bank Pack /
   FIDReC Pack), page structure, global rules, and the in-force sections
   of the original master brief.

**Relationship to the original `guidebuoy-google-stitch-design-brief.md`:**

- Its **Section 6** (brand/visual direction) and **Section 7** (global UX
  rules) are fully replaced by this brief + `design-tokens-v3.md`.
- Its **Section 8 public-shell navigation** is replaced by the seven-page
  public navigation below; the authenticated case shell remains in force
  (now with the mode selector added to it).
- Its **Sections 4–5 and 9–17** (architecture, canonical workflow, screen
  families A–I, dynamic rules, component library, accessibility, tone
  examples, responsive behaviour, required assets, prototype flows,
  delivery checklist) remain in force — **with the v3 amendment that every
  screen, component, and prototype must be delivered in all three modes**.

Companion files:

- `design-tokens-v3.md` — full Harbor token set, the three modes,
  functional colour coding, code exports.
- `pages/*.md` — final copy for the seven public pages (unchanged by v3).
- Brand assets: `GuideBuoy AI Image.jpg` (Lumi buoy render), brand
  animation video. Lamp glow may be graded toward Soft Teal/Sage for
  palette harmony.

---

## The business

GuideBuoy AI (GuideBuoy AI SG Pte Ltd, UEN 202545875C, Singapore) is a
public-good complaint helper for people dealing with scams, fraud, and
financial disputes in Singapore. A user tells their story once — by typing
or by voice — and Lumi, the lighthouse AI assistant, organises it into a
single unified report they can reuse with their bank, the Police,
ScamShield, FIDReC (Financial Industry Disputes Resolution Centre), and
other partners, without needing a lawyer.

The audience is a distressed person on a phone — often within hours or days
of discovering a scam — and, later, a returning user tracking a bank
response or a FIDReC waiting period over weeks. **The majority are
neurodivergent (ADHD, AuDHD, autistic)** — lower sensory thresholds, more
intense colour perception, executive function temporarily compromised by
distress. Many are older, visually impaired, or using English as an
additional language. The website's first job is to calm them down enough
that they can tell their story — and to keep matching their emotional
state the whole way through.

The business model is a three-tier ladder:

| Tier | Customer-facing name | Price | What it is |
|---|---|---|---|
| Tier 0 | **User Pack** | Free | Tell your story, upload evidence, answer Lumi's focused questions, receive a free organised draft: story summary, evidence checklist, and a preliminary pathway signal. |
| Tier 1 | **Bank Pack** | Paid (one-off; price as a design token — do not bake into imagery) | The full self-serve complaint report: chronology, disputed transactions, responsibility points, requested resolution, evidence map — structured to send to the financial institution. |
| Tier 2 | **FIDReC Pack** | SGD 800 one-off case-pack preparation; optional SGD 99 thirty-minute Scam & Fraud Specialist consultation | Human-assisted preparation of the FIDReC submission after the bank's final response or the four-week waiting period. |

The helper stays free at the entry point. Paid help activates only when the
user chooses it. There is no outcome guarantee at any tier, and nothing on
the site is legal advice.

---

## Brand

| Element | Value |
|---|---|
| Name | GuideBuoy AI |
| Assistant | Lumi — the lighthouse buoy who lights the way forward |
| Tagline | Tell it once. We'll help you carry it from here. |
| Core promise | Explain it once. Organise it clearly. Know what to do next. |
| Primary colour | **Harbor Teal `#2E6E6A`** — primary actions, links, brand anchor |
| Deep anchor | **Deep Harbor `#245854`** — hovers, headings on light tints |
| Secondary | **Sage `#3E6B4F`** — progress, growth, success-adjacent UI |
| Info accent | **Dusty Blue `#3D5A80`** — legal/formal, informational, credible |
| Warmth accent | **Lavender Ash `#7A6F92`** — empathy moments only |
| Background | **Cream `#FAF7F2`** — warm off-white, never pure white |
| Surfaces | Warm White `#FDFCFA`; tints: Mist Blue `#E3EBF0`, Sage Mist `#DCE8DC`, Lavender Mist `#E6E1F0`, Sand `#F0EAE0` |
| Text colour | **Deep Slate `#2E3A3F`** body (10.96:1 on Cream = AAA) / Slate Muted `#5C6B70` secondary |
| Lines | Fog `#D8DDD8` |
| Success | Sage Deep `#3E6B4F` on Sage Mist — completed/verified |
| Warning | Ochre `#A8782E` on Ochre Mist `#F3EBDA` — waiting/deadlines; urgency in words, never flashing |
| Error | **Muted Terracotta `#B4552F`** on Terracotta Mist `#F3E0D5` — never bright red, always with fix-it copy |
| Dark mode | Night Harbor: Night Water `#1E2A2B`, Night Cream text `#F5F1EA`, Soft Teal `#7FB5B2` actions |
| Headings | Inter, 600–650 weight, Deep Slate / Deep Harbor |
| Body | Inter, 400, 1.6 line-height; tabular numerals for money, dates, case IDs |
| Shape | Soft 12–16 px cards, one quiet shadow, no pill containers |
| Mascot | Lumi buoy render; presence scales with mode (see below) |
| Voice | Warm, plainspoken, factual, reassuring, never patronising. Never implies the user caused the loss. |

**Colour intent:** colour is a safety feature, not decoration. Soft blues
and greens measurably lower heart rate and cortisol; creams and pastels
are the UK-government-recommended families for autistic users; alarming
reds and yellows are replaced by muted terracotta and ochre so even error
states stay regulating. Muted > saturated, always — if a colour "pops,"
it's wrong. Never pure black on pure white. Status colours are for icons
and headings on their mists; message body text is always Deep Slate
(terracotta/ochre on their mists only reach large-text contrast). Full
rationale, contrast table, and don'ts: `design-tokens-v3.md` and
`design.md`.

---

## The three emotional-state design modes (v3 headline requirement)

The user picks the design that matches how they feel **right now**, and can
change it at any moment. **The selector is present on every screen at all
times** — every public page, the router, sign-in, the case workspace,
checkout, the report hub, every error and empty state. It is part of the
product's identity, not a settings page.

### The three modes

| Mode | User-facing label | Emotional state | Design behaviour |
|---|---|---|---|
| **1. Steady** (default) | "I'm okay" | Coping, functional | Full Harbor palette: all tints, empathy lavender, sage progress, full Lumi presence, gentle motion |
| **2. Quiet** | "Everything feels too much" | Overstimulated | Near-monochrome calm: tints flatten to Cream/Sand, accents collapse to Harbor Teal only, animations off, illustrations removed, Lumi reduced to a static line mark. **Errors and deadline colours stay semantic** — clarity is safety |
| **3. Grounding** | "I need a moment" | Acute distress | Screen empties to one Cream canvas: a Soft Teal breathing circle (4-7-8 rhythm), one line of text, one button ("Continue when ready" / "Save and exit"). No-guilt close, never "Quit". All work saved underneath and restored on return |

### Mode-switcher component (new shared component — Families A–I all need it)

- **Placement:** right side of the header on desktop; thumb-reachable
  header control on mobile. Present in both the public shell and the
  authenticated case shell. Never collides with the single WhatsApp entry
  point, the Lumi help affordance, or the sticky mobile primary action.
- **Presentation:** quiet "How are you feeling?" chip or segmented
  control with the three plain-language labels. No technical names
  ("low-sensory"), no colour-picker UI.
- **Behaviour:** one tap; instant global switch without reload or
  confirmation; persisted for anonymous users (device) and in the account
  profile after sign-in; announced to screen readers; respects
  `prefers-reduced-motion` / `prefers-contrast` as starting hints.
- **Integrity:** the switch is total — no screen, modal, banner, Stripe
  interstitial frame, or error state may break mode. Layout, navigation
  positions, and content stay identical across modes; only sensory
  intensity changes. Consistency is the calming mechanism.
- **Grounding mode:** pauses (never cancels) the current task; exactly
  one way back and one safe exit; always the same Soft Teal breathing
  cue, so colour becomes a conditioned calm signal over time.

### Stitch deliverable consequence

**Every screen in Families A–I, every component in the library, and all
six prototypes must be produced in three variants: Steady, Quiet, and
Grounding.** Treat the mode as a first-class design axis alongside
viewport (390 / 768 / 1440 px) and theme (light / Night Harbor). Where
Grounding makes no sense as a full-screen state (e.g., inside a report
table), show the Grounding *entry point* in that screen's header and the
Grounding canvas itself as its own screen.

---

## Global rules

1. **Calm before capture.** Every entry surface leads with reassurance
   ("You're in the right place. Take your time.") before any form field.
2. **The emotional-state selector is always present.** Every screen, every
   shell, every state. One tap to Steady / Quiet / Grounding.
3. Design mobile first; every core action works at 320 px, one-handed.
4. Each screen has exactly one visually dominant primary action (Harbor
   Teal fill, white text).
5. Always show: where the user is, what is happening, what is needed next,
   and whether their work is saved.
6. Progressive disclosure: plain-language first; legal/technical detail
   behind "Why?" / "How this was determined".
7. Never colour alone for status — always colour + icon + label + text.
8. Never expose internal terms (edge function, RPC, Supabase, job row,
   Tier 0/1/2 internals, state-machine nodes, "low-sensory mode") to end
   users. Customer-facing names: **User Pack**, **Bank Pack**, **FIDReC
   Pack**; **Steady / Quiet / "I need a moment"**.
9. Distinguish clearly between: extracted information, user-confirmed
   information, preliminary guidance, the final report, and human
   specialist advice.
10. Preserve user work through every error and every mode switch. Never
    silently erase stories, files, answers, or pending requests. Never
    silently redirect home.
11. One persistent WhatsApp entry point in the root layout; no competing
    floating buttons. Lumi's help affordance is visually secondary to the
    current task.
12. Money as `SGD 12,400.00`; dates as `29 Mar 2026`.
13. Skeletons for retrieval; step-based progress for AI work; determinate
    bars only when measured. Every long operation states whether the user
    can safely leave.
14. Destructive actions require confirmation; routine retries do not.
15. Prices are design tokens, never baked into imagery or illustrations.
16. Imagery: real, respectful Singapore context — ordinary adults, calm
    assistance, everyday environments. Never sensational scam imagery,
    never victims shown as helpless.
17. Target WCAG 2.2 AA (floor, not ceiling): 4.5:1 minimum contrast but no
    pure black/white pairs; 44×44 px touch targets; visible focus;
    reduced-motion and reduced-contrast respected; 200% zoom reflow;
    plain language with FIDReC, FI, MAS, IMDA, SPF explained on first use.
    Design deliberately for sensory overload — WCAG cannot catch it.
18. No bright red, neon orange, or bright yellow anywhere — including
    errors, deadlines, and marketing. Urgency escalates with words and
    placement, never colour aggression. No streaks or guilt mechanics.

---

## The dynamic application (summary — full spec in the master Stitch brief)

Stitch must produce **one reusable design system**, not disconnected pages.
Screen families, states, dynamic rules, component library, and the six
prototype flows are specified in `guidebuoy-google-stitch-design-brief.md`
Sections 9–17 and remain authoritative — **each now delivered in Steady,
Quiet, and Grounding variants**:

- **Family A** — public acquisition: home with type/voice story capture,
  how-it-works, pricing, about, marketplace, resources, FAQ, sign-in/up
  preserving the pending story, privacy/terms/consent.
- **Family B** — complaint router: story intake, classification, dynamic
  questions, and results for bank-first, IMDA/telco, FIDReC-ready,
  FIDReC four-week wait, other options, and crypto/overseas cases — plus
  the four-week dispute tracker.
- **Family C** — onboarding and case bootstrap, including the recoverable
  transition-failure screen.
- **Family D** — **User Pack** workspace: case intake, first evidence
  upload, per-document live processing states, gap-question loop, free
  draft preparation, free draft ready (story summary, evidence checklist,
  preliminary pathway signal).
- **Family E** — upgrade gate and Stripe checkout: eligible card, blocked
  prerequisite, plan choice (**Bank Pack**), redirect, success, cancelled,
  delayed confirmation.
- **Family F** — report generation: last-chance update, reprocessing,
  analysing, drafting, slow/background, payment-safe failure, reconnection.
- **Family G** — report hub: full report viewer, update-available banner,
  case dashboard, collaborators.
- **Family H** — **FIDReC Pack** surface: help chooser (handoff request /
  SGD 99 specialist consult / SGD 800 case pack), FIDReC contact form with
  read-only case context, confirmation and failure states, checkout states.
- **Family I** — system states: session expiry, access denied, not found,
  internal error, offline, empty states, loading skeletons.

**New component for the library:** the emotional-state mode switcher (chip,
expanded three-option sheet, all three active states, desktop + mobile
placements) and the Grounding canvas (breathing circle, reduced-motion
fallback, save-and-exit path).

---

## The public pages

Seven public pages, same navigation on every page:
**Home · How it works · Pricing · About · Marketplace · Resources · FAQ**
plus persistent **Start free** (primary), **Sign in**, and the
**emotional-state selector** (always visible).
Final copy for each page is in `pages/`. Footer on every page:
GuideBuoy AI SG Pte Ltd · UEN 202545875C · 51 Goldhill Plaza #07-10/11,
Singapore 308900 · DID +65 9072 7915 · Main +65 6690 9262 · Terms ·
Privacy · Report a vulnerability · social links · WhatsApp.
(Analytics is an internal route — never in public navigation.)

### Page 1 — Home (`pages/home.md`)

**Job:** calm a distressed visitor within five seconds, and let them start
telling their story immediately — typed or spoken.
**Content:** reassuring headline and "you're in the right place" subline;
the Create-your-report card with Type / Record modes and privacy microcopy
("your story stays on this device until you sign in"); three calm reasons
to trust; the six-step journey in one glance; one primary CTA
"Start organising — free"; secondary link to How it works.

### Page 2 — How it works (`pages/how-it-works.md`)

**Job:** explain the journey from story to resolution path without jargon.
**Content:** the six steps (Tell Lumi → Sign up & add proof → Lumi's short
Q&A → your free draft in the Report Hub → choose your next step → human
help if you want it); what the free stage includes; where the Bank Pack
and FIDReC Pack fit; the Singapore pathways in plain words; the four-week
tracker.

### Page 3 — Pricing (`pages/pricing.md`)

**Job:** make the three packs comparable at a glance; remove fear of
hidden charges.
**Content:** **User Pack (Free)**, **Bank Pack (one-off)**, **FIDReC Pack
(SGD 800 + optional SGD 99 consult)**; who each is for; includes and
explicit "does not include"; one-off payment reassurance; no outcome
guarantees; refund policy; primary CTA "Start free".

### Page 4 — About (`pages/about.md`)

**Job:** make GuideBuoy feel like accountable people building a public
good.
**Content:** mission; company snapshot (Singapore Pte Ltd, MVP live,
PDPA-aligned, Stripe-secured); responsible-AI commitments; team profiles;
office and contact.

### Page 5 — Marketplace (`pages/marketplace.md`)

**Job:** show that human help exists — free first, paid only by choice.
**Content:** public-good support (pro-bono legal clinics via SAL, social
service partners, trauma-informed wellbeing); paid specialists (lawyer
review, dispute coach, cybersecurity report); one dominant primary CTA
("Start free — talk to Lumi"), all request links visually secondary.

### Page 6 — Resources (`pages/resources.md`)

**Job:** make authoritative Singapore help easy to scan in a stressful
moment.
**Content:** immediate-action guides; hotlines (ScamShield 1799 24/7,
Police 999); legal-framework cards (MAS E-Payments User Protection
Guidelines, PDPA, SPF e-services); FIDReC explained; consumer guides.

### Page 7 — FAQ & contact (`pages/faq.md`)

**Job:** answer high-anxiety questions honestly; give a human contact
route.
**Content:** searchable accordions (Getting started, Your report, Packs &
pricing, Privacy & trust); contact form with submitted/error states;
WhatsApp and phone routes.

*Page copy is mode-agnostic; the emotional-state selector is a shell
component, so `pages/*.md` needs no v3 changes.*

---

## Master prompt to paste into Google Stitch (v3)

> Design a complete responsive web application for **GuideBuoy AI**, a
> Singapore-focused public-good complaint helper for scam, fraud, and
> financial-dispute victims — a majority of them neurodivergent and
> arriving emotionally activated. The product lets a distressed person
> tell their story once by typing or voice, routes them to the right
> Singapore escalation path (bank, FIDReC, IMDA/telco, Police,
> ScamShield), organises their evidence, asks focused gap questions, and
> generates a free organised draft (the **User Pack**), then an optional
> paid full complaint report for their bank (the **Bank Pack**, one-off
> via Stripe), then optional human help for FIDReC (the **FIDReC Pack** —
> handoff request, SGD 99 specialist consultation, SGD 800 case-pack
> preparation).
>
> **Headline feature — three emotional-state design modes, swappable at
> any moment from every screen.** A persistent "How are you feeling?"
> selector lives in the header of every page and state, public and
> authenticated. Its three options:
> 1. **"I'm okay" — Steady** (default): the full calm Harbor palette.
> 2. **"Everything feels too much" — Quiet**: all colour tints flatten to
> cream/sand, accents collapse to teal only, animation off, illustrations
> removed; error and deadline colours stay semantic.
> 3. **"I need a moment" — Grounding**: the screen empties to a single
> cream canvas with one soft-teal breathing circle (4-7-8 rhythm), one
> line of text, one button ("Continue when ready" / "Save and exit").
> The switch is instant, global, remembered, reversible, never hidden in
> settings, and never changes layout — only sensory intensity. Deliver
> EVERY screen, component, and prototype in all three variants.
>
> Visual language ("Harbor" palette, trauma-informed and WCAG-verified):
> cream background `#FAF7F2` (never pure white), warm-white cards
> `#FDFCFA`, Harbor Teal `#2E6E6A` primary actions with Deep Harbor
> `#245854` hover/headings, Sage `#3E6B4F` progress, Dusty Blue `#3D5A80`
> legal/informational, Lavender Ash `#7A6F92` empathy moments, Deep Slate
> `#2E3A3F` body text (never pure black), Fog `#D8DDD8` borders. Status:
> Muted Terracotta `#B4552F` errors on `#F3E0D5`, Ochre `#A8782E`
> deadlines on `#F3EBDA`, Sage Deep success — always colour + icon + text.
> Inter or equivalent, tabular numerals (`SGD 12,400.00`, `29 Mar 2026`),
> 12–16 px soft cards, one quiet shadow, generous whitespace, gentle
> 200–350 ms motion, WCAG 2.2 AA, mobile-first at 320/390 px with 768 px
> and 1440 px variants, plus a Night Harbor dark theme (`#1E2A2B` bg,
> `#F5F1EA` text, `#7FB5B2` primary). Absolute bans: bright red, neon
> orange, bright yellow anywhere; pure black-on-white; colour-only
> meaning; flashing; urgency-by-colour; streaks/guilt mechanics.
>
> Create one reusable design system and all dynamic screen variants from
> the full specification (screen families A–I): public landing with
> type/voice story capture and on-device privacy notice; how-it-works,
> pricing (three packs), about, marketplace, resources, FAQ pages;
> sign-in/up preserving the pending story; complaint router intake,
> classification, one-question-at-a-time screens, bank-first result,
> IMDA/telco result, FIDReC-ready result, four-week-wait result,
> other-options result, crypto/overseas result, four-week tracker; case
> bootstrap success and recoverable failure (apology, story preserved,
> Try again / Return home / support); evidence upload with
> PDF/PNG/JPEG/DOCX validation and per-document
> pending/reading/verifying/organising/extracting/ready/failed states;
> gap-question workspace (two-column desktop, tabbed mobile); free User
> Pack draft; Bank Pack eligibility gate, plan choice, Stripe redirect,
> success/cancelled/delayed states; report analysing and drafting stages;
> payment-safe failure recovery; full report hub (summary, chronology,
> transactions, totals, responsibility points, requested resolution,
> evidence, missing facts, disclaimers; copy/print/download/share);
> update-available banner; case dashboard and collaborators; FIDReC Pack
> help chooser, contact form with read-only case context,
> confirmation/failure, both checkout flows; session expiry, access
> denied, not found, offline, empty, and skeleton states — every one in
> Steady, Quiet, and Grounding variants.
>
> One primary action per state. Never silently redirect after an error or
> delete user work — including on mode switch. Plain Singapore English;
> explain FIDReC, MAS, IMDA, SPF on first use; prices are tokens, never
> baked into imagery. Produce design tokens, component variants (now
> including the mode switcher and the Grounding canvas), annotated
> screens, the Lumi asset set (full, static-mark, and absent per mode),
> and six connected prototypes — happy path, FIDReC waiting path,
> onboarding-auth failure, document recovery, payment/report failure, and
> FIDReC specialist handoff — each demonstrating the mode switcher at
> least once.

---

## Open product decisions (design with tokens, not fixed values)

Carried over — lock before production sign-off:

- final **Bank Pack** price and bundle naming (keep as a token);
- whether DOCX is fully supported by the production evidence processor;
- one consistent customer-facing name for the paid report ("Bank Pack"
  recommended);
- whether the free draft auto-generates or waits for explicit CTA;
- notification behaviour when background generation continues after the
  user leaves;
- final PDF/export capabilities;
- specialist fulfilment, scheduling, refund, and service-level terms;
- legal-approved wording for FIDReC eligibility, AI limitations, and
  outcome disclaimers;
- dark mode (Night Harbor) retained as a public theme alongside the three
  modes — themes change light/dark, modes change sensory intensity;
- Analytics and other internal routes stay out of consumer navigation;
- final user-facing labels for the three modes ("I'm okay" / "Everything
  feels too much" / "I need a moment" are the working copy) — test with
  neurodivergent users before locking.
