# Harbor UI — approved implementation specification

**Status:** authoritative Harbor presentation package, subject to the binding product contract. The visual reference is [`guidebuoy-ai-redesign`](../../GuideBuoy%20Design%20Project/guidebuoy-ai-redesign/guidebuoy-ai-redesign/), but its copy is **not approved for publication**.

## Package index

| Document | Use |
|---|---|
| [Source and assets](./source-and-assets.md) | Approved assets and reference-only material |
| [Copy and claims](./copy-and-claims.md) | Publishable copy, commercial model, claim ledger |
| [Screen specifications](./screen-specifications.md) | Annotated screen families, responsive layouts, all states |
| [Component and sensory system](./component-and-sensory-system.md) | Tailwind v4 tokens, components, accessibility and sensory modes |
| [Route and CTA matrix](./route-and-cta-matrix.md) | Routes, screen-state mapping, CTAs, prerequisites and future work |
| [Release evidence inventory](./release-evidence-inventory.md) | Contract-freeze claim controls, first-release gates, and evidence to attach to the release SHA |

## Non-negotiable implementation rules

1. Treat client-side pending narrative as local until authentication succeeds; do not create anonymous case records.
2. Render the backend/API state; do not infer eligibility, payment success, document completion, or FIDReC qualification in the browser.
3. Preserve visible user input after an error, reconnect, checkout cancellation, or auth renewal.
4. Public and authenticated layouts must work at **390, 768, and 1440 CSS px** without horizontal page scrolling or clipped controls.
5. All public claims must be in the [claim ledger](./copy-and-claims.md#claim-ledger) and have a release record in the [evidence inventory](./release-evidence-inventory.md#claim-control-inventory); unlisted claims are **not publishable**.
6. Minimum truthful Terms, Privacy, and system-recovery content is a first-release gate. FF-003 covers later expansion; it does not permit placeholder-only legal content.

## Authority and change control

1. Explicit, recorded human decisions take precedence.
2. [`Harbor-Redesign-Production-Plan.md`](../Harbor-Redesign-Production-Plan.md) governs the planned product experience.
3. [`State-Machine-Workflow.md`](../State-Machine-Workflow.md) and [`Front-to-Back-End-Integration-Summary.md`](../Front-to-Back-End-Integration-Summary.md) govern canonical workflow/API behaviour.
4. The contract-freeze record resolves implementation and claim conflicts.
5. Existing code, samples, and legacy copy are evidence only, never independent approval.

The frontend consumes canonical hooks, API envelopes, durable facts, and server catalogue/entitlement results. It must not create a parallel workflow, Supabase-query layer, checkout flow, subscription-status rule, or browser-side entitlement decision. A responsible owner must provide written evidence before a `qualified copy` or `not publishable` ledger item becomes `verified`.
