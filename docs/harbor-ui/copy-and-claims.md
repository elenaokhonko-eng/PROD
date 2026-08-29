# Approved copy and claim ledger

## Copy rules

Use short, factual, non-blaming sentences. Do not name internal tiers, functions, jobs, eligibility rules, or third parties as endorsements. A price appears only when its matching purchasable product is returned by the production pricing/checkout configuration.

### Approved commercial copy

| Surface | Publishable copy |
|---|---|
| Free preparation | **Start organising for free.** Tell your story, add supporting material, and receive a draft when your case is ready. |
| Self-serve report | **Full report — S$18.** Review the price and what is included before continuing to checkout. |
| FIDReC case pack | **FIDReC case pack — S$188.** Available after a completed report, where offered. Review the scope before checkout. |
| S$8 / S$12 regeneration | Do not expose a purchasable offer yet. The frozen target is customer-level FI regeneration at S$8/month and FI/FIDReC regeneration at S$12/month; neither subscription may create a case-pack entitlement. Public exposure is blocked until the lifecycle policy, live Stripe configuration, eligibility enforcement, and tests are approved. |
| Checkout pending | **Confirming your payment.** Your case remains available while we check the latest payment status. Do not pay again unless checkout tells you to. |
| Cancellation | **Checkout was not completed.** Your case is unchanged. |
| Reporting disclaimer | **GuideBuoy helps organise information. It does not decide your case or provide legal advice.** |
| Singpass option | **Singpass sign-in is not currently available.** The disabled option does not authenticate the user. |
| Data deletion | **Request data deletion.** Explain that a request is reviewed and that lawful security, accounting, and legal-retention exceptions may apply. After the canonical API creates a durable request, show **Request received**, its server reference, and returned status; do not fabricate any of them. |
| Automated outputs | **Generated automatically by GuideBuoy AI. It has not been reviewed by a person.** Show this on every material output and checkout surface. |
| Human consultation | **Human consultation is not currently available.** It is a separate optional product and must remain inactive until its operational, cancellation, refund, and record-retention gate is approved. |
| Help directory | **Planned—not currently available through GuideBuoy.** Inactive cards may name the category only; they cannot launch a handover. |

**Prohibited in approved UI:** retired price points, recurring-billing assertions, price guarantees, refund promises, unapproved price comparisons, certification/endorsement language, and any readiness/timing claim for unavailable services.

### Frozen commerce presentation constraints

- User Pack / Stage 0 is free and case-scoped. FI Pack / Tier 1 is S$18 per case; FIDReC Pack / Tier 2 is S$188 per case.
- Regeneration subscriptions are customer-scoped: S$8/month may permit Tier 1 regeneration; S$12/month may permit Tier 1 and Tier 2 regeneration. An inactive subscription preserves previously purchased outputs but blocks new paid-pack regeneration.
- A subscription never creates a case-level paid-pack entitlement; Tier 1 access never unlocks Tier 2. Only a server-returned catalogue and entitlement may describe or enable either action.
- The potential S$8→S$12 upgrade requires a server-supplied Stripe proration preview and explicit customer confirmation. Never preselect consent, silently charge, or derive the upgrade in the browser.
- Exact lifecycle statuses, quota, credits, timing, and billing policy remain unresolved. Subscription checkout, regeneration exposure, and upgrade UI are therefore blocked.

## Claim ledger

Only **verified** rows can be published as declarative claims. **Qualified copy** may be used only exactly as written. **Not publishable** must not appear in UI, metadata, sales materials, or accessibility text.

| Topic | Status | Approved wording or required action |
|---|---|---|
| Free preparation availability | verified | “Start organising for free.” |
| Full report price | verified | “Full report — S$18.” |
| FIDReC case-pack price | verified | “FIDReC case pack — S$188.” |
| S$8 / S$12 regeneration | not publishable | The S$8/S$12 scope is frozen, but subscription checkout and public offer copy are blocked until lifecycle policy, live Stripe configuration, eligibility enforcement, and tests are approved. |
| Product does not decide outcomes / not legal advice | verified | Use the reporting disclaimer above. |
| Pre-sign-in story storage | qualified copy | “Your draft stays in this browser until you sign in.” It does not become a case until sign-in succeeds. |
| Stripe checkout handoff | qualified copy | “You’ll continue to our payment provider to complete checkout.” |
| Singpass login | qualified copy | Disabled provider option: “Singpass sign-in is not currently available.” It has no sign-in or request-access action. |
| PDPA practice | not publishable | Applicable PDPA obligations are a frozen requirement, but public wording needs legal/compliance owner approval of a current control mapping. Never imply certification or endorsement. |
| Encrypted data storage | not publishable | A scoped statement needs evidence of covered database/storage, backups, exports, transit controls, processors, and legal/access exceptions. Do not claim absolute confidentiality or security. |
| MAS guidance | not publishable | Applicable MAS guidance is a frozen requirement; public wording needs legal/compliance approval. `PDPA ✦ MAS` can only be a reviewed non-certification informational heading. |
| Data deletion | qualified copy | “Request data deletion.” The production flow must create a durable request and receipt and show “Request received,” its server reference, returned status, identity/review steps, and lawful-retention exceptions. Email-only submission cannot support those statements. |
| Automated outputs / human consultation | qualified copy | “Generated automatically by GuideBuoy AI. It has not been reviewed by a person.” “Human consultation is not currently available.” Do not imply credentials, availability, advice outcome, or fulfilment timing. |
| Help-resource directory / warm handovers | qualified copy | “Planned—not currently available through GuideBuoy.” List categories only as inactive placeholders; do not imply a live referral, partnership, endorsement, or handover. |
| Partner, regulator, authority, or platform relationship | not publishable | Do not display logos or state affiliation, support, acceptance, or reuse by FIDReC, MAS, IMDA, SPF, ScamShield, banks, or partners. |
| Refund, cancellation, or charge protection | not publishable | Do not promise refunds, free retries, or payment protection. |
| Response time | not publishable | Do not state any response time. Where the durable deletion API succeeds, confirmation says: “Request received.” |
| Endorsements, testimonials, outcomes | not publishable | Do not use endorsements, “trusted by”, success rates, or outcome promises. |
| FIDReC pathway timing/eligibility | qualified copy | “Your case information may indicate a next step. Check the official requirements before acting.” Never say eligible/accepted unless backend returns a defined informational state. |

## Replacements for retired reference copy

| Retired claim category | Replacement |
|---|---|
| Retired high-price case-pack label | “FIDReC case pack — S$188” |
| Recurring-billing assertion | Omit until lifecycle and checkout are approved. |
| Identity-provider readiness | “Singpass sign-in is not currently available.” |
| Automatic complete deletion | “Request data deletion.” The durable request/receipt API—not the browser—supplies “Request received,” reference, and status. |
| Compliance/certification badge | Omit until legal/compliance approves a scoped public statement; never imply certification or endorsement. |
| Human-review, specialist follow-up, or response commitment | “Generated automatically by GuideBuoy AI. It has not been reviewed by a person.” “Human consultation is not currently available.” |
| Refund, guarantee, or charge-protection promise | Omit. |
