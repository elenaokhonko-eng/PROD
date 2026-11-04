# On-demand stages: plan and estimate

Status: **planned for the first release after go-live. Not implemented.** Estimate from the 2026-11-05 investigation
of `release/harbor-pattern-c-2026-11` (after D6).

## Goal

Any stage can be bought directly, and buying the S$188 FIDReC Tier 2 pack directly also grants the S$18 bank pack
(report).

## How it works today

| Question | Today |
|---|---|
| S$188 without S$18? | No. `reserve_checkout_purchase_v1` raises `FI Guide purchase required` (`supabase/migrations/20260829000000_release_security_and_fulfilment_hardening.sql`), `grant_fidrec_pack_capability_v1` raises `qualifying FI capability required`, and the capabilities API sets `requiresReportEntitlement: true`. |
| Free draft before S$18? | Required by the UI and, since D6, by checkout (`lib/billing/report-purchase-readiness.ts`: free draft and non-blocking validation, else 409 with a reason code). The database reservation has no stage check. |
| Refund | `record_case_purchase_refund_v1` marks the purchase refunded but leaves the case entitlement. Launch handles refunds by hand (`docs/release-operations.md`, "Manual refund"). A refunded case can't buy the same product again. |
| Re-running stages | Free draft: once, automatically (the server would overwrite; the UI never offers it). Extraction: re-runs when documents change. S$18 report: once per purchase, regeneration `policy_blocked`. Tier 2: themes, findings, pack and export regenerate any number of times while entitled. |
| Tier 2 dependencies | The Tier 2 pipeline (`lib/server/fidrec`, `app/api/fidrec/tier2`) reads documents, extractions, extract runs, document chunks and regulatory documents. It does not read the S$18 report or its decision. |

## Changes

| # | Change | Hours |
|---|---|---|
| 1 | Additive migration: drop the FI-capability precondition from reservation; new `fulfil_escalation_pack_v1` sets both capabilities in one step and enqueues the report job if the case has none; S$18 checkout refused once S$188 is held; refund and dispute rules for the bundle (revoke both, or the pack only), replacing the manual refund procedure | 6 |
| 2 | Eligibility: separate "can buy" from "can run" per product in the database (`get_case_eligibility` or a new RPC), so `report-purchase-readiness.ts` becomes a thin wrapper and the pack gets the same treatment | 3 |
| 3 | Webhook, checkout and capabilities: fulfil a direct S$188 purchase; offer S$188 without the report; remove `requiresReportEntitlement` | 3 |
| 4 | UI entry points: both products at the buy step; a direct S$188 purchase goes through report drafting before "Tier 2 ready" (today `escalation_pack` jumps straight to `L3-Tier2Ready`); pricing and marketing links | 8–10 |
| 5 | Tier 2 prerequisites: require a usable extract run and processed documents before generating the pack; define what a purchase before intake does | 3 |
| 6 | Optional re-runnable stages: "refresh free draft" with a cost guard (3 h); paid report regeneration, which needs a pricing policy and a new job type (6 h) | 9 |
| 7 | Tests: pgTAP for the new RPCs, payment-branching and capabilities contracts, authenticated end-to-end for a direct S$188 purchase from a fresh account and the new states, seed updates, Stripe test-mode run | 8 |
| 8 | Runbook and release procedure: the migration joins the hashed release sequence | 2 |

**Total: about 33 hours core, 42 with re-runnable stages; 40–50 hours with 20% contingency.** Roughly 1–1.5 weeks
including reviews.

## Decisions needed before starting

1. Bundle refund rule: does refunding a direct S$188 purchase also revoke the report?
2. Whether paid report regeneration is in scope, and its price.
3. Whether a purchase may start before the free draft (affects change 5 and the D6 readiness check).
