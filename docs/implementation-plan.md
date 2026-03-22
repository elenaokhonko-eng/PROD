# GuideBuoy AI — PRD v2 Implementation Plan

> **Status:** Approved — implement step by step. Each step is independently shippable.
> **Project copy:** `d:\Claude\guidebuoy\docs\implementation-plan.md`

## Context

The PRD v2 describes a product significantly more sophisticated than what's currently built. The current implementation handles basic complaint intake (text/voice → AI classify → "Financial Dispute" → sign up → case form → evidence upload → PDF report). The PRD requires a 7-question conversational triage engine that routes users to one of **6 distinct paths** (A, A2, B, C, D, E), with SRF-specific eligibility logic, tiered pricing, path-specific CTAs, and several free user journeys that don't exist yet.

**Core misalignment:** The current product is a case management tool. The PRD wants a **triage-first, guidance-first** product where the most valuable moments happen *before* the paid features — and where many users never need to pay at all.

**Design constraint:** Fix what's there, extend it — do not rewrite. Each step should be shippable independently.

---

## PRD vs. Current: Key Gaps

| Gap | Severity | PRD Section |
|-----|----------|-------------|
| Triage only classifies "Financial Dispute" — no 6-path routing | Critical | §5, §6 Screen 2–3 |
| Q2 is binary (authorised/not) — PRD requires three-way classification | Critical | §5 Q2 |
| No SRF eligibility check (channel, date, entity impersonation, FI type) | Critical | §3, §5 Q3b–Q3c |
| No FIDReC subscriber lookup | Critical | §5 Q4 |
| `/router/results` is generic — no path-specific screens | Critical | §6 Screen 3 |
| Helper invite is behind paid tier — PRD says free from Screen 2 | High | §7 |
| No 4-week bank dispute tracker (Path C) | High | §5 Path C |
| No Path E static guidance (crypto/overseas) | High | §5 Path E |
| No Path A2 static IMDA guidance (telco SRF breach) | High | §5 Path A2 |
| No crisis signposting (SOS 1767, SAGE, National Care Hotline) | High | §11 |
| No catch-up flow for returning sessions (7-day window) | High | §6 Screen 1 |
| Flat pricing — PRD requires tiered S$49/79/99 + S$99/129/149 | Medium | §9 |
| Refund policy not shown before payment | Medium | §9 |
| Voice input exists — PRD explicitly says **do not offer voice in MVP** | Medium | §6 Screen 1 |
| Case Readiness Report doesn't match PRD spec (6 sections) | Medium | §6 Screen 4 |

---

## Implementation Steps

### Step 1 — Upgrade Triage Classify: Three-way Q2 + 6-Path Routing
**Value:** Makes the entire product work as intended. Currently the biggest dead end.
**Files to modify:**
- [app/api/router/classify/route.ts](app/api/router/classify/route.ts) — upgrade the Gemini prompt to extract: (a) three-way Q2, (b) scam type, (c) scam channel for phishing, (d) entity impersonation flag, (e) FI name, (f) incident date, (g) bank contact status, (h) police report status
- [lib/rules.ts](lib/rules.ts) — add `determinePath(triageResult)` function implementing the 6-path decision tree from PRD §5
- [app/api/router/session/route.ts](app/api/router/session/route.ts) — store `triage_path` (A/A2/B/C/D/E) and `srf_eligible` flag on session

**Logic to implement in `determinePath()`:**
```
if no money lost → Path D (education)
if SRF conditions all met (phishing + digital channel + impersonation + after Dec16 2024 + FIDReC subscriber FI) → Path A
if SRF waterfall → telco failed → Path A2
if FIDReC eligible but bank contact < 4 weeks → Path C
if FIDReC eligible and bank contact ≥ 4 weeks or final reply → Path B
if no FIDReC subscriber / crypto / overseas → Path D or E
```

**SRF conditions (all must be true for Path A):**
1. Scam type = phishing
2. Channel = SMS, email, WhatsApp, RCS (not phone call / physical)
3. Scammer impersonated a legitimate entity
4. Incident date ≥ 2024-12-16
5. FI is a FIDReC subscriber

---

### Step 2 — Build Path-Specific Results Pages
**Value:** Every user gets a relevant, actionable result — not a generic screen.
**Files to modify:**
- [app/router/results/page.tsx](app/router/results/page.tsx) — render different UI based on `session.triage_path`:
  - **Path A:** "Your case may qualify for a refund under Singapore's banking regulations (SRF)" → free SRF duty assessment CTA → upsell to Case Readiness Report
  - **Path A2:** "The bank met its duties — but the telco may not have" → free IMDA guidance CTA
  - **Path B:** "You may be eligible to file with FIDReC" → deadline check → paid Case Readiness Report CTA
  - **Path C:** "You contacted your bank recently — wait for the 4-week period" → free tracker CTA
  - **Path D:** Sub-path guidance table (FI not subscriber → MAS/CASE; e-commerce → platform + CASE; etc.)
  - **Path E:** Honest guidance: police report, MAS alert list, CCS/SAGE signposting
- Show deadline warning banner if FIDReC 6-month window is within 4 weeks
- Add crisis support footer (SOS 1767, SAGE 1800-555-5555, National Care Hotline 1800-202-6868) to results page

---

### Step 3 — Add FIDReC Subscriber Lookup
**Value:** Required for accurate Path A/B/D routing. Currently missing entirely.
**Files to create/modify:**
- [lib/fidrec-subscribers.ts](lib/fidrec-subscribers.ts) — static list of MAS-licensed FIs that subscribe to FIDReC (DBS, OCBC, UOB, Standard Chartered, Citibank, GrabPay, Revolut SG, etc.) with fuzzy name matching
- Update `determinePath()` in [lib/rules.ts](lib/rules.ts) to call `isFIDReCSubscriber(fiName)`
- Update triage classify prompt to extract FI name from narrative

---

### Step 4 — Add Path E and A2 Static Guidance Pages
**Value:** Users routed to these paths currently hit dead ends. PRD says "must never hit a dead end or an empty screen."
**Files to create:**
- [app/router/path-e/page.tsx](app/router/path-e/page.tsx) — crypto/overseas honest guidance:
  - "Formal recovery is unlikely but not impossible"
  - Police report guidance (police.gov.sg/iwitness, ScamShield 1799)
  - MAS investor alert list link
  - CCS, SAGE Pro Bono SG signposting
- [app/router/path-a2/page.tsx](app/router/path-a2/page.tsx) — IMDA complaint guidance:
  - Explain SRF waterfall result
  - Step-by-step IMDA complaint instructions
  - Telco contact details, what evidence to include
  - Note: FIDReC still available as parallel path

---

### Step 5 — Add Session Catch-up Flow for Returning Users
**Value:** Scam victims are a high-dropout population. Tab closure = permanent abandonment without this.
**Files to modify:**
- [app/router/page.tsx](app/router/page.tsx) or landing page — on load, check localStorage for existing `router_session_token` with `expires_at > now`; if found, show catch-up banner: *"Welcome back. We saved where you left off — would you like to continue?"* with summary of last scam type
- [lib/router-session.ts](lib/router-session.ts) — add `getSessionSummary()` for the catch-up banner text
- If session expired (>7 days), offer short re-intake: *"Last time you told us about [scam type]. Is this still what you need help with?"*

---

### Step 6 — Move Helper Invite to Free Tier (Triage Screen)
**Value:** PRD explicitly requires helper invite to be free from Screen 2. Currently only in paid case dashboard.
**Files to modify:**
- [app/router/results/page.tsx](app/router/results/page.tsx) — add "Invite someone you trust to help" CTA on results page (free, no account required yet)
- [app/router/classify/page.tsx](app/router/classify/page.tsx) — if triage detects distress signals or elderly context, surface helper invite proactively
- Reuse existing invitation logic from [lib/case-roles.ts](lib/case-roles.ts) and [app/api/invitations/send/route.ts](app/api/invitations/send/route.ts) but allow pre-account invitation via email with link to join

---

### Step 7 — Add 4-Week Bank Dispute Tracker (Path C)
**Value:** Path C is a critical retention flow. Users who arrived too early are the most likely to eventually pay.
**Files to create/modify:**
- [app/router/tracker/page.tsx](app/router/tracker/page.tsx) — countdown timer UI showing days since bank contact, days remaining to 4-week mark, what to do in the meantime (evidence preservation tips, what NOT to say to bank)
- [app/api/router/session/route.ts](app/api/router/session/route.ts) — store `bank_contact_date` on session
- Email reminder at Day 28 (reuse existing email infra in [lib/mail.ts](lib/mail.ts)) — *"It's been 4 weeks. Ready to escalate to FIDReC?"*
- Reminder requires email collection (non-account, PDPA-compliant consent capture)

---

### Step 8 — Fix Pricing: Tiered Pricing + Refund Policy Before Payment
**Value:** Flat pricing contradicts PRD; refund policy absence creates acute trust friction for scam victims.
**Files to modify:**
- [app/app/case/[id]/checkout/page.tsx](app/app/case/%5Bid%5D/checkout/page.tsx) — implement tiered pricing display:
  - Determine tier (standard/SRF/complex) from `case.eligibility_status` and `triage_path`
  - Show price breakdown: Report + Builder + Bundle saving
  - Add refund policy section (full refund 24h if not viewed; 50% 48h; no refund after builder started)
- [app/api/payments/create-checkout-session/route.ts](app/api/payments/create-checkout-session/route.ts) — pass tier as metadata to Stripe, use appropriate price ID
- [supabase/migrations/](supabase/migrations/) — add `pricing_tier` column to `payments` table

---

### Step 9 — Fix Case Readiness Report Format (PRD §6 Screen 4 spec)
**Value:** The current generated report is a general summary. The PRD specifies 6 required sections.
**Files to modify:**
- [app/api/cases/[caseId]/generate-pack/route.ts](app/api/cases/%5BcaseId%5D/generate-pack/route.ts) — update Gemini prompt to generate all 6 sections:
  1. Evidence inventory (what user has ✅)
  2. Evidence gaps (what FIDReC case managers look for ❌)
  3. Bank duty checklist (SRF duties: real-time alerts, cooling-off, fraud surveillance)
  4. Timeline reconstruction (from narrative + evidence)
  5. Strength indicator (Weak / Moderate / Strong — honest)
  6. Risk flags (e.g. "You clicked a link — bank may argue negligence under EUPG")
- [app/app/case/[id]/dashboard/page.tsx](app/app/case/%5Bid%5D/dashboard/page.tsx) — display the 6-section report in structured UI, not just as raw text

---

### Step 10 — Remove Voice Input from MVP
**Value:** PRD explicitly says "Do not offer voice input in MVP." Reduces complexity and maintenance burden.
**Files to modify:**
- [app/page.tsx](app/page.tsx) — remove microphone/voice recording UI from the landing page story input
- [app/api/transcribe/route.ts](app/api/transcribe/route.ts) — can remain in codebase but remove from UI
- Keep the transcribe API route for future use; just hide the voice button

---

## Critical Files Reference

| File | Purpose |
|------|---------|
| [app/api/router/classify/route.ts](app/api/router/classify/route.ts) | Upgrade triage prompt (Step 1) |
| [lib/rules.ts](lib/rules.ts) | Add 6-path routing logic (Step 1) |
| [app/router/results/page.tsx](app/router/results/page.tsx) | Path-specific result screens (Step 2) |
| [lib/fidrec-subscribers.ts](lib/fidrec-subscribers.ts) | FIDReC lookup (Step 3, new file) |
| [app/router/path-e/page.tsx](app/router/path-e/page.tsx) | Path E static page (Step 4, new file) |
| [app/router/path-a2/page.tsx](app/router/path-a2/page.tsx) | Path A2 static page (Step 4, new file) |
| [app/router/page.tsx](app/router/page.tsx) | Session catch-up flow (Step 5) |
| [lib/router-session.ts](lib/router-session.ts) | Session summary helper (Step 5) |
| [app/router/tracker/page.tsx](app/router/tracker/page.tsx) | 4-week tracker (Step 7, new file) |
| [app/app/case/[id]/checkout/page.tsx](app/app/case/%5Bid%5D/checkout/page.tsx) | Tiered pricing + refund policy (Step 8) |
| [app/api/cases/[caseId]/generate-pack/route.ts](app/api/cases/%5BcaseId%5D/generate-pack/route.ts) | Report format fix (Step 9) |
| [app/page.tsx](app/page.tsx) | Remove voice input (Step 10) |

---

## Execution Order (by value + dependency)

| # | Step | Why this order |
|---|------|---------------|
| 1 | Step 1 — Triage engine | Everything else depends on path routing |
| 2 | Step 2 — Path results pages | Immediate user-facing value; needs Step 1 |
| 3 | Step 3 — FIDReC subscriber lookup | Unblocks accurate routing; enhances Steps 1+2 |
| 4 | Step 4 — Path E + A2 static pages | No dead ends; quick to build |
| 5 | Step 10 — Remove voice input | Quick win, reduces noise |
| 6 | Step 5 — Session catch-up | Retention-critical |
| 7 | Step 6 — Helper invite in free tier | Trust-critical |
| 8 | Step 7 — 4-week tracker | Path C retention |
| 9 | Step 8 — Tiered pricing + refund policy | Conversion-critical |
| 10 | Step 9 — Report format fix | Paid feature quality |

---

## Verification

After each step, verify end-to-end:
1. Submit a test narrative for each scam type (phishing via SMS, investment fraud, crypto) through `/router`
2. Confirm correct path is returned in session JSON (`triage_path` field)
3. Confirm results page shows path-specific content and CTAs
4. For Step 8: go through checkout, confirm pricing tier is correct and refund policy is visible
5. For Step 9: generate a report, confirm all 6 sections are present
6. Test session persistence by simulating tab close and return within 7 days
