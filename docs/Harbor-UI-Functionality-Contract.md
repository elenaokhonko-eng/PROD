# Harbor UI functionality contract

The Harbor presentation may wrap these boundaries, but must not introduce a second checkout, state-machine, conversion, entitlement, or data-access path. The executable source of truth is `lib/harbor/functionality-contract.ts`.

| Flow | UI route and owner | API / query authority | Analytics and redirect |
| --- | --- | --- | --- |
| Narrative capture | `/`, `/router`, `app/page.tsx`, `lib/router-session.ts` | Router-session POST/PATCH, transcription, classification and assessment routes; case conversion remains server-owned | `story_submitted`, `router_conversion_complete`, `router_conversion_imported`; `/router/classify` → `/router/results` → signup/onboarding → case dashboard |
| Evidence upload | Case dashboard, `useUploadEvidence` | Evidence upload followed by case evidence processing; `case_documents` realtime; extract/Tier-0 auto-fire hooks | Existing `evidence_uploaded`; no presentation redirect |
| Questions | `/router/questions` and dashboard gap loop | Router questions/session responses; authenticated `PUT /api/cases/:caseId/responses`; validation runs and gap-items view | Router questions continue to `/router/results`; missing session returns to `/router` |
| Case dashboard | `/app/case/:caseId/dashboard`, server page plus `useStateMachine` | Server checks `cases.user_id`; server snapshot reads profile/latest extract; hooks own eligibility, validation, documents and narratives | Global `page_view`; state changes do not create a competing route |
| Checkout | Dashboard CTA plus `useCreateCheckoutSession` | Strict `{ caseId, productKey }` request; `PRODUCT_CATALOGUE`; Stripe webhook owns fulfilment; `case_entitlements` is authoritative | Browser goes to returned Stripe URL; Stripe returns to dashboard with success/cancel query state |
| Report lifecycle | Dashboard Layer 2 | Entitlements, decision/report realtime hooks and job-status route; worker owns generation | UI displays running/drafting/ready/failed without inferring access from a redirect |
| Tier 2 | Dashboard Layer 3 | Server-gated case-pack JSON/export and contact request routes | Tier 2 and consultation checkout use canonical product keys; no promised outcome or SLA |
| Settings | `/app/settings`, server profile read plus settings client | Privacy export/deletion and referral routes; current profile/notification/accessibility controls are not persisted | `privacy_delete_completed`; downloads remain browser-owned |

## Protected product catalogue

- Self-serve report: `self_serve_report`, SGD 18.
- FIDReC Tier 2 pack: checkout key `fidrec_tier2_pack`, entitlement `escalation_pack`, SGD 188.
- Human consultation: checkout key `human_consult_30m`, product code `human_consult_99`, SGD 99.

Prices, access and fulfilment come from `lib/payments/product-catalogue.ts` and server state. Redirect query parameters are never proof of payment.

## Presentation rules

- New components receive authoritative data and callbacks; they do not query Supabase directly.
- Clerk authentication and Supabase ownership checks remain on existing server routes/pages.
- The dashboard keeps one deterministic `useStateMachine` resolver.
- The old `/app/case/:caseId/checkout` surface must delegate to the canonical dashboard checkout rather than send its legacy `{ productType, tier }` payload.
- Static visual fixtures must be isolated from production authorization and redirects.
