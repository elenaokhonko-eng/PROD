# Approved copy and claim ledger

## Copy rules

Use short, factual, non-blaming sentences. Do not name internal tiers, functions, jobs, eligibility rules, or third parties as endorsements. A price appears only when its matching purchasable product is returned by the production pricing/checkout configuration.

### Approved commercial copy

| Surface | Publishable copy |
|---|---|
| Free preparation | **Start my free evaluation** (every link or button to the story box) and **Get my free evaluation** (the story form's submit button), with **Free. No card needed.** (brief W1 §A1–A3, approved by Elena 14 Nov 2026). |
| Home first screen | Line above the headline: **For scam and bank-dispute victims in Singapore.** Headline: **Scammed? Find out where you stand, and what to do next.** Sub-line: **Tell GuideBuoy what happened, once. You get a free evaluation: your facts in order, how Singapore's scam rules may apply to your case, and your next step.** Above the story box: **Tell us once. We'll help you carry it from here.** (brief W1 §A1, approved by Elena 14 Nov 2026). |
| Free evaluation | **Free evaluation.** Understand where you stand and your options, free. |
| Bank dispute pack | **Bank dispute pack — S$18.** Haven’t sent your bank a full written complaint yet, or not sure yours was complete? Prepare one with your evidence. |
| FIDReC escalation pack | **FIDReC escalation pack — S$188.** Received your bank’s final reply and disagree? Prepare a complete, neutral case pack for FIDReC. (Separate from the bank dispute pack; neither requires the other.) |
| Stage 2 packs during stage 1 | **Coming shortly** on pack cards and badges; on the home page **Coming shortly: a complaint pack for your bank (S$18) and a full case pack for FIDReC (S$188).** Shown only while `PAID_STAGES_ENABLED` is not `true`; prices come from the catalogue. When live: **When you're ready: a complaint pack for your bank (S$18) or a full case pack for FIDReC (S$188).** |
| S$8 / S$12 regeneration | Do not expose a purchasable offer yet. The frozen target is customer-level FI regeneration at S$8/month and FI/FIDReC regeneration at S$12/month; neither subscription may create a case-pack entitlement. Public exposure is blocked until the lifecycle policy, live Stripe configuration, eligibility enforcement, and tests are approved. |
| Checkout pending | **Confirming your payment.** Your case remains available while we check the latest payment status. Do not pay again unless checkout tells you to. |
| Cancellation | **Checkout was not completed.** Your case is unchanged. |
| Reporting disclaimer | **GuideBuoy helps organise information. It does not decide your case or provide legal advice.** |
| Sign-up and sign-in | Sign-up: **Save your case** · **Create a free account to keep your story private and get your evaluation.** · under the form **Free. No card needed. We never ask for your bank login, PIN or OTP.** Sign-in: **Welcome back.** · **Sign in to continue your case.** No Singpass option and no “authenticated case workspace” (brief W1 §F, approved by Elena 14 Nov 2026). |
| Data deletion | **Request data deletion.** Explain that a request is reviewed and that lawful security, accounting, and legal-retention exceptions may apply. After the canonical API creates a durable request, show **Request received**, its server reference, and returned status; do not fabricate any of them. |
| Automated outputs | **Generated automatically by GuideBuoy AI using a pre-built workflow. It has not been reviewed by a person. For a human review, book a consultation (S$99 / 30 min).** Show this on every material output and checkout surface inside the app and in every download. Public marketing pages do not repeat it; they carry “What GuideBuoy is” once instead (brief W1 §B3, Elena 14 Nov 2026). |
| What GuideBuoy is (public pages) | **What GuideBuoy is.** A guided way to prepare your own case. It is automated and is not legal advice; you check everything before you send it. If you would like a person to go through it with you, a 30-minute consultation is S$99. **Email to book** (info@guidebuoyai.sg). Once per public page that sells or explains the product: Home after the product cards, Pricing, How it works, About, FAQ, Product. On public pages “has not been reviewed by a person” appears 0 times and “S$99” at most twice. |
| Human consultation | **Human consultation: S$99 for 30 minutes. Email info@guidebuoyai.sg to book.** It is a separate optional product and must remain inactive until its operational, cancellation, refund, and record-retention gate is approved. |
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
| Free preparation availability | verified | “Start my free evaluation”, “Get my free evaluation”, “Free. No card needed.” (Elena, 14 Nov 2026). “Start organising for free” is retired. |
| Bank dispute pack price | verified | “Bank dispute pack — S$18.” |
| FIDReC escalation pack price | verified | “FIDReC escalation pack — S$188.” |
| Paid packs coming shortly (stage 1) | qualified copy | “Coming shortly”, with no date. An exception to the rule against timing claims for unavailable services, approved by Elena on 2026-11-14 (replacing “Available from [date]” of 2026-11-05 and the unrecorded “Available shortly”). Shown only while `PAID_STAGES_ENABLED` is not `true`. |
| S$8 / S$12 regeneration | not publishable | The S$8/S$12 scope is frozen, but subscription checkout and public offer copy are blocked until lifecycle policy, live Stripe configuration, eligibility enforcement, and tests are approved. |
| Product does not decide outcomes / not legal advice | verified | Use the reporting disclaimer above. |
| Pre-sign-in story storage | qualified copy | “Your draft stays in this browser tab until you sign in. It is deleted when you close the tab.” (brief W1 §B2 and Elena’s E24 of 7 Nov.) It does not become a case until sign-in succeeds. |
| Trust row above the story box | qualified copy | “We never ask for your bank login, PIN or OTP.” · “Fixed prices. No success fee.” · “Private to your account. We never share your case with any bank or authority unless the law requires it.” (Elena’s wording (b), 14 Nov; matches Privacy Policy §3, including its disclosure-required-by-law sentence) · “Singapore company, UEN 202545875C. Check on ACRA BizFile” (links out; no embed). Brief W1 §B1, approved by Elena 14 Nov 2026. |
| Before sign-up | verified | “Next you’ll create a free account, so your case is saved privately.” (brief W1 §B2, approved by Elena 14 Nov 2026). |
| Stripe checkout handoff | qualified copy | “You’ll continue to our payment provider to complete checkout.” |
| Retired public wording | retired | “Start organising”, “Singpass”, “pathway signal”, “Complaint Helper”, “free draft”, “free report”, “Report Hub”, “Full report”, “durable request”, “authenticated case workspace”, “DID +65” do not appear on public pages (brief W1 §K; checked by `tests/e2e/public/text-and-titles.spec.ts`). Use “free evaluation”, “Bank dispute pack”, “FIDReC escalation pack”, “suggested next step” and “Mobile / WhatsApp”. The Terms and Privacy Policy change only through legal review. |
| Singpass login | retired | Removed from sign-in, sign-up and the FAQ (brief W1 §F, Elena 14 Nov 2026). Do not mention Singpass until it is offered, except Terms 2.5: “Singpass sign-in is planned to be supported at a later stage.” (Elena, 14 Nov 2026). |
| PDPA practice | not publishable | Applicable PDPA obligations are a frozen requirement, but public wording needs legal/compliance owner approval of a current control mapping. Never imply certification or endorsement. |
| Encrypted data storage | not publishable | A scoped statement needs evidence of covered database/storage, backups, exports, transit controls, processors, and legal/access exceptions. Do not claim absolute confidentiality or security. |
| MAS guidance | not publishable | Applicable MAS guidance is a frozen requirement; public wording needs legal/compliance approval. `PDPA ✦ MAS` can only be a reviewed non-certification informational heading. |
| Data deletion | qualified copy | “Request data deletion.” The production flow must create a durable request and receipt and show “Request received,” its server reference, returned status, identity/review steps, and lawful-retention exceptions. Email-only submission cannot support those statements. |
| Export and deletion (public FAQ) | qualified copy | “Yes. You can download your outputs from your case. To delete a case or your account, email info@guidebuoyai.sg; we confirm and delete it, apart from records the law requires us to keep.” (brief W1 §J, 14 Nov 2026). Public pages only; in-app deletion copy keeps the row above. |
| Automated outputs / human consultation | qualified copy | “Generated automatically by GuideBuoy AI using a pre-built workflow. It has not been reviewed by a person. For a human review, book a consultation (S$99 / 30 min).” “Human consultation: S$99 for 30 minutes. Email info@guidebuoyai.sg to book.” Do not imply credentials, availability, advice outcome, or fulfilment timing. |
| Help-resource directory / warm handovers | qualified copy | “Planned—not currently available through GuideBuoy.” List categories only as inactive placeholders; do not imply a live referral, partnership, endorsement, or handover. |
| Partner, regulator, authority, or platform relationship | not publishable | Do not display logos or state affiliation, support, acceptance, or reuse by FIDReC, MAS, IMDA, SPF, ScamShield, banks, or partners. |
| Refund, cancellation, or charge protection | not publishable | Do not promise refunds, free retries, or payment protection. |
| Response time | not publishable | Do not state any response time. Where the durable deletion API succeeds, confirmation says: “Request received.” |
| Endorsements, testimonials, outcomes | not publishable | Do not use endorsements, “trusted by”, success rates, or outcome promises. |
| FIDReC pathway timing/eligibility | qualified copy | “Your case information may indicate a next step. Check the official requirements before acting.” Never say eligible/accepted unless backend returns a defined informational state. |

## Replacements for retired reference copy

| Retired claim category | Replacement |
|---|---|
| Retired high-price case-pack label | “FIDReC escalation pack — S$188” (brief W1 §K; “FIDReC case pack” is retired). |
| Recurring-billing assertion | Omit until lifecycle and checkout are approved. |
| Identity-provider readiness | No mention of providers that are not offered (Singpass removed 14 Nov 2026). |
| Automatic complete deletion | “Request data deletion.” The durable request/receipt API—not the browser—supplies “Request received,” reference, and status. |
| Compliance/certification badge | Omit until legal/compliance approves a scoped public statement; never imply certification or endorsement. |
| Human-review, specialist follow-up, or response commitment | “Generated automatically by GuideBuoy AI using a pre-built workflow. It has not been reviewed by a person. For a human review, book a consultation (S$99 / 30 min).” “Human consultation: S$99 for 30 minutes. Email info@guidebuoyai.sg to book.” |
| Refund, guarantee, or charge-protection promise | Omit. |
