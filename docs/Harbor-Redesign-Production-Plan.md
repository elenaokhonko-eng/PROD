# Harbor Redesign and Production Completion Plan

**Status:** Approved for implementation
**Prepared:** 27 Aug 2026
**Target branch:** `main`

**Approved:** 27 Aug 2026. All recommendations in Section 7 were approved, with one naming amendment: the customer-facing Tier 1 product is **FI Pack** (Financial Institution Pack), not Bank Pack. Backend key `self_serve_report` remains unchanged.

## 1. Purpose and authority

This is the production integration plan for the Harbor v3 redesign and the remaining state-machine refactor work. It reconciles the committed Harbor design package, the dynamic screen specification, the current code on `main`, and the existing state-machine/integration documentation.

Implementation precedence is:

1. product decisions approved in this document;
2. current backend contracts and implemented commerce catalogue;
3. `State-Machine-Workflow.md` and `Front-to-Back-End-Integration-Summary.md` for runtime behaviour;
4. Harbor v3 tokens and rules for presentation and interaction;
5. static HTML previews as visual references, not production code.

The cafe sample under `GuideBuoy Design Project/content (1)` is unrelated source material and must not be ported into GuideBuoy production.

## 2. Current-state assessment

### Already present

- Next.js App Router with Clerk, Supabase, Stripe, TanStack Query, Realtime, and a Render worker.
- State-machine UI and hooks for free preparation, checkout, paid report generation, and the post-report Tier 2 surface.
- Commerce keys for `self_serve_report`, `fidrec_tier2_pack`, and `human_consult_30m`.
- Tier 2 helper routes, executive-summary/chronology generation, and PDF/Markdown export code.
- Site-wide WhatsApp and a separate Lumi chat affordance.

### Not yet integrated from Harbor v3

- Harbor CSS tokens and production Tailwind v4 mappings.
- Steady, Quiet, and Grounding modes.
- Anonymous persistence, pre-paint hydration, signed-in profile sync, and a `profiles.sensory_mode` migration.
- Harbor public header/footer and seven-page navigation.
- `/how-it-works` and `/pricing`, plus `/product` redirect behaviour.
- Harbor public-page layouts and copy.
- Harbor treatment across router, auth, workspace, checkout handoff, reports, errors, empty states, and loading states.
- Removal of Analytics from consumer navigation and consolidation of competing floating controls.
- Full accessibility, responsive, visual-regression, and end-to-end release verification.

### Refactor status requiring verification

The July refactor status is stale relative to code. Slice 6 worker infrastructure and substantial Slice 8 functionality are present, although the old table calls them pending/planning. Their completion must be proven through release gates. Slice 7 cleanup is not proven complete. Development must start with a requirement-by-requirement audit rather than rebuilding landed work.

## 3. Conflicts and proposed resolutions

| Area | Conflict | Recommended production rule | Approval needed |
|---|---|---|---|
| Pricing | Harbor says FIDReC Pack SGD 800; current contracts/code use SGD 18, SGD 188, and SGD 99. | Treat 18/188/99 as canonical and update public copy. | Yes |
| Public names | Harbor uses User/Bank/FIDReC Pack; current code/docs also use Basic Case Pack. | **Approved:** User Pack / FI Pack / FIDReC Pack publicly; keep backend keys unchanged. | Resolved |
| Tailwind | Migration assumes Tailwind v3 config; production uses Tailwind 4 `@theme` and no config. | Port tokens into CSS variables and Tailwind v4 `@theme`; do not introduce legacy config. | No |
| Error colour | Stitch `DESIGN.md` contains Material red while Harbor v3 bans bright red. | Harbor v3 wins: Muted Terracotta on Terracotta Mist, icon + label + fix-it copy. | No |
| Stripe mode | Brief requires mode coverage on Stripe, but hosted Checkout is outside the app theme. | Theme app handoff/return states; make hosted Stripe an explicit third-party exception. | Yes |
| Dark mode | Night Harbor is specified but its initial release is open. | Defer public dark mode until the three sensory modes are stable. | Yes |
| Persistence | Signed-in mode sync is required but the database column is absent. | Add an idempotent migration and RLS-compatible preference sync. | Yes |
| Grounding actions | Brief alternates between Continue and Save and exit; public pages have no work to save. | Continue everywhere; Save and exit only in authenticated flows with verified autosave. | Yes |
| Floating controls | Production renders global Lumi and WhatsApp; Harbor requires one WhatsApp float and no competing Lumi float. | Keep one WhatsApp float; move Lumi inline/header. | Yes |
| Navigation | Production exposes Analytics and `/product`; Harbor specifies seven public pages. | Remove Analytics from consumer nav, add Pricing/How it Works, redirect `/product`. | Yes |
| DOCX | Design requires DOCX while production support remains unverified. | Do not advertise DOCX until an end-to-end fixture passes. | Yes |
| Consultation | Checkout exists but recording, transcription, scheduling, refunds, SLA, and narrative insertion remain unresolved. | Gate production sale until fulfilment and legal terms are approved. | Yes |
| Release method | Direct production versus preview-first is unspecified. | Feature branch and production-like preview, then controlled merge/deploy. | Yes |

## 4. Proposed design contract

- Harbor v3 is the visual source of truth: Cream, Warm White, Harbor Teal, Sage, Dusty Blue, Lavender Ash, Muted Terracotta, and Ochre.
- Semantic shadcn variables map to Harbor tokens; legacy hard-coded palette values are removed from product components.
- Steady is default. Quiet reduces decorative colour, imagery, and non-essential motion without changing layout/content. Grounding pauses the experience behind a single-purpose overlay without destroying state.
- The mode control is available on public, router, auth, authenticated, error, and recovery surfaces.
- Status always uses colour + icon + text; errors include a next action.
- One dominant primary action per state; motion respects reduced-motion preferences.
- Inter remains the typeface; money, dates, case IDs, and progress use tabular figures and agreed formats.
- Public navigation is Home, How it Works, Pricing, Marketplace, Resources, About, FAQ.
- Public UI uses User Pack / FI Pack / FIDReC Pack; internal layer/tier and product keys remain implementation terms.

## 5. Development sequence

### Phase 0 — decisions, audit, and baseline

1. Resolve every approval item in Section 3.
2. Audit Slices 0–8 against code, migrations, tests, and deployed dependencies; update evidence-based status.
3. Run baseline typecheck, build, state-machine rules, focused regression tests, and available E2E tests.
4. Record production dependencies without committing secrets.

### Phase 1 — Harbor foundation

1. Add Harbor variables and Tailwind v4 semantic mappings.
2. Add typography, spacing, elevation, number, illustration, focus, error, and mode utilities.
3. Build a typed sensory-mode provider and accessible switcher.
4. Add pre-paint hydration and reduced-motion handling.
5. Add a Grounding overlay with focus management and state restoration.
6. Add profile persistence only after approval.

### Phase 2 — shells and navigation

1. Build responsive Harbor public header/footer.
2. Add the switcher to public and authenticated shells.
3. Keep one WhatsApp float and relocate Lumi.
4. remove Analytics from consumer nav and protect the route.
5. Add `/how-it-works`, `/pricing`, and permanent `/product` redirect.

### Phase 3 — public pages

Port Home, How it Works, Pricing, Marketplace, Resources, About, and FAQ to accessible React components. Preserve narrative capture and auth handoff; do not replace live behaviour with static mock behaviour.

### Phase 4 — dynamic product surfaces

Apply Harbor and all three modes to Families B–I: router, auth/bootstrap, evidence/gap loop, free draft, upgrade/checkout, report generation, report hub, Tier 2, and global system states. Do not change backend transitions unless the audit proves a defect.

### Phase 5 — refactor closure

Complete only audit-proven gaps in Slices 0–8. Highest-risk items are worker/webhook deployment verification, Pattern B/debug cleanup, entitlement routing, Tier 2 exports, consultation fulfilment, DOCX support, and stale documentation.

### Phase 6 — release

1. Test at 320, 390, 768, and 1440 px in Steady/Quiet; test Grounding entry/return for every screen family.
2. Run keyboard, screen-reader landmark, focus, contrast, reduced-motion, and colour-independence checks.
3. Run all static, regression, state-machine, payment, export, and E2E gates.
4. Verify Clerk/Supabase auth, Stripe webhook, Render worker, migrations/RLS, email, WhatsApp, analytics privacy, and rollback in a production-like environment.
5. Deploy via preview/canary, smoke primary and failure paths, then promote with monitoring and a rollback point.

## 6. Required release evidence

- Clean install and production build pass on declared Node/pnpm versions.
- TypeScript, state-machine, focused regression, and E2E gates pass.
- All six specified prototype flows have equivalent working app paths.
- All three modes preserve state and meet their interaction contract.
- No consumer page exposes Analytics or internal tier terminology.
- Product, amount, entitlement, fulfilment, and return route are correct for all commerce keys.
- Tier 2 PDF and Markdown outputs are verified with a controlled case.
- Auth expiry, denied/not-found/offline, document failure, payment delay/cancel, worker failure, and retry paths are tested.
- No secrets, placeholder telephone numbers, expiring image URLs, debug routes, or test-only IDs are exposed.
- Migrations have forward and recovery instructions; production smoke, monitoring, and rollback owners are named.

## 7. Product-owner decisions requested

Please approve or amend:

1. **Approved:** SGD 18 FI Pack, SGD 188 FIDReC Pack, SGD 99 consultation.
2. **Approved with amendment:** User Pack / FI Pack / FIDReC Pack; backend keys unchanged.
3. Hosted Stripe Checkout is an explicit sensory-theme exception.
4. Night Harbor dark mode is deferred from the initial release.
5. Store sensory mode in Supabase; account preference wins after sign-in.
6. Grounding uses Continue everywhere; Save and exit only with authenticated autosave.
7. Keep one WhatsApp float and move Lumi inline/header.
8. Remove Analytics from consumer nav and protect it internally.
9. Do not advertise DOCX or fully fulfilled consultation until their gates pass.
10. **Approved:** Use a feature branch and preview deployment before production promotion.

Items 3–9 are approved as recommended. Development may proceed.
