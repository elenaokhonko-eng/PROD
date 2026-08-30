# Harbor release evidence inventory

**Purpose:** records the UI-owned evidence and release gates required by the contract freeze. It is an implementation inventory, not legal, commercial, security, or partner approval. A blank owner, approver, evidence link, effective date, or review date means the related public claim remains unavailable.

## Contract inputs

| Contract section | UI inventory disposition |
|---|---|
| §2.2 | Singpass is unavailable; deletion is reviewed, not destructive; help categories remain planned; automated outputs have no human review; Harbor covers auth, legal, system, Helper, Volunteer, and pro-bono surfaces. |
| §4.6 | Show the automated-output disclosure on material output and checkout surfaces. Keep human consultation separate and inactive until its operations gate passes. |
| §§8–8.1 | Use the exact required meanings below. Never turn gated compliance, security, partner, or lifecycle facts into a public claim. |
| §11.3 | Treat the 61 named states as visual acceptance variants around canonical handlers. Preserve Clerk and server authority; provide Harbor treatment and accessible recovery states. |
| §15 | FF-001, FF-002, FF-003, and FF-004 are backlog direction, not present availability. Minimum truthful legal/system content is still a first-release gate. |

## Claim-control inventory

| Claim ID | Exact UI wording / required meaning | Surfaces | Status | Owner / evidence / dates required before release |
|---|---|---|---|---|
| `HBR-CLM-001` | “Singpass sign-in is not currently available.” | Sign-in, sign-up, FAQ, public journey | qualified copy | FF-001 completion; provider approval, identity design, threat model, privacy review, recovery/RLS/accessibility evidence. No launch date or readiness implication. |
| `HBR-CLM-002` | “Request data deletion.” A single deliberate action starts a reviewed request, not deletion. On canonical API success: “Request received.” with reference, status, and lawful-retention explanation. | Settings, Privacy, account help | qualified copy | Privacy owner, legal owner, durable request/receipt/status API, retention policy, effective/review dates. Email-only delivery is not sufficient. |
| `HBR-CLM-003` | “Generated automatically by GuideBuoy AI. It has not been reviewed by a person.” | User Pack, FI Pack, FIDReC Pack, report, checkout | qualified copy | Legal wording approval before public release; verify every material output/checkout placement. |
| `HBR-CLM-004` | “Human consultation is not currently available.” It is separate from case-pack entitlement. | Product, Help, FAQ, report escalation | qualified copy | FF-004 operations gate: scope, capacity, booking, consent/access, price, payment, cancellation/refund/no-show/retention terms, reconciliation, support runbook. |
| `HBR-CLM-005` | “Planned—not currently available through GuideBuoy.” | Central Help, Marketplace, Helper, Volunteer, pro-bono, warm-handover cards | qualified copy | FF-002 named-source verification/review date; relationship, capacity, consent/data-sharing, referral fallback, monitoring, and approved copy before activation. |
| `HBR-CLM-006` | Do not state PDPA, MAS, encryption, certification, regulator endorsement, absolute confidentiality, or data-sale claims. | Privacy, Terms, About, FAQ, trust cards, footer, metadata | not publishable | Legal/compliance owner, current scoped controls/processor mapping, evidence version, effective/review dates, and exact approved wording. |
| `HBR-CLM-007` | No refund guarantee, money-back statement, full-refund assertion, payment-safety guarantee, or response-time promise. | Checkout, Terms, FAQ, contact, notices | not publishable | Legal/commercial approval and aligned Stripe/accounting/access process. |

## Surface evidence inventory

| Surface group | Required first-release condition | Evidence required | Status |
|---|---|---|---|
| Clerk sign-in/sign-up | Harbor shell, local-draft handoff, unavailable Singpass state, keyboard/mobile/error recovery; Clerk remains the identity authority. | 390/768/1440 visual review; keyboard/screen-reader pass; canonical auth/error-state test. | UI specification ready; implementation verification required. |
| Terms and Privacy | Harbor treatment, approved minimum truthful content, owner-verified support path, **fixed effective date** and revision; no placeholder-only release. | Legal owner/approver, claim IDs, approved text, effective/review dates, link/contact verification, content regression check. | **Release gate — FF-003 expansion does not waive it.** |
| Onboarding and system errors | Harbor-safe recovery; retain supported local work; no raw infrastructure detail or cross-user data. | Recovery-state tests and accessibility/mobile review. | UI specification ready; implementation verification required. |
| Helper, Volunteer, pro-bono, marketplace | Harbor treatment; inactive GuideBuoy actions use the planned wording; separately verified official public/crisis resources, if any, stay independently available. | Source owner, official URL, last-reviewed date, relationship/activation evidence where relevant. | **Release gate for any active destination.** |
| Families B–I and checkout | Canonical API-driven variants only; no client lifecycle, entitlement, checkout, or query authority. Material outputs disclose automation/no human review. | State coverage against all 53 B–I variants; checkout/API integration and payment-safe recovery evidence. | UI specification ready; implementation verification required. |
| Shared shell and public routes | Approved Lumi/wordmark use, active route state, signed-in actions, accessible mobile drawer, no horizontal scroll at 390 px. | 390/768/1440 visual and keyboard review. | UI specification ready; implementation verification required. |

## Acceptance evidence to attach to the release candidate

1. Visual captures or review records for 390, 768, and 1440 px for all public routes and the 61 A–I presentation states.
2. Keyboard, focus-visible, drawer/dialog, reduced-motion, and screen-reader checks for shared controls, Clerk shell, errors, and sensory modes.
3. Canonical API integration evidence for bootstrap, upload, validation, checkout return/delayed state, generation/realtime recovery, report access, and contact request handling.
4. Claim-ledger approval records for every published claim, including owner, approver, evidence/version, effective date, expiry/review date, and locale.
5. Legal/content approval and fixed effective dates for minimum Terms and Privacy content; FF-003 tracks only the later expansion.
6. Evidence that unavailable actions have no navigation, payment, handover, or referral side effect.
7. Backend evidence before enabling durable deletion receipt/status, regeneration subscriptions, consultation, active handovers, or Singpass.

## Current validation record

| Check | Result | Limitation |
|---|---|---|
| `git diff --check` | Passed | Checks this delivery’s whitespace/errors only. |
| `npm run typecheck` | Passed | Static TypeScript validation only. |
| `npm run build` | Passed | Built with non-production public Supabase placeholders only; deployed environments still require their configured public Supabase values and runtime AI routes return unavailable when Gemini is absent. |

## Explicitly blocked activation

Do not activate or advertise: Singpass; automatic or complete deletion; S$8/S$12 sale or regeneration; consultation checkout; refunds/dispute access mutation; referral rewards; GuideBuoy-mediated handovers; unverified official links; compliance/security claims; or human review.
