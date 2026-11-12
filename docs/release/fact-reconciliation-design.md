# Fact reconciliation and stage journey: technical design (Gate S1)

**Status:** revision 2, for Elena's approval at Gate S1. It includes the S1 review decisions of 5 Nov: FIDReC rules from the Terms of Reference, the bank pack built for launch with an emergency switch and no switch-off lane, no page links on the confirm screen, and the card-loss split. Nothing here is implemented.
**Spec:** `docs/agent-briefs/2026-11-05-spec-fact-reconciliation-and-stage-journey.md` (v3). Section numbers like §3.4 refer to the spec.
**Branch:** `release/harbor-pattern-c-2026-11`. Code references are `path:line` at `5c01b1c`.

## 0. Summary for approval

| | |
|---|---|
| **Estimate (revision 2)** | **197 hours** with the recommended simplifications: 177 for the shared work, free evaluation and FIDReC pack, plus 20 for the bank pack. That is about 236 hours with 20% contingency. Before simplification it is 210 hours. Details in §12. |
| **Dates** | **Single go-live:** about **30 November**. **Staged:** free evaluation about **23 November**, then the FIDReC and bank packs about **1 December** (203 hours, §14). Both assume S1 approval on 6 November, about 10 agent hours a day, and gate reviews within a day; contingency adds about 4 days. Details in §14. |
| **Migrations** | Two additive migrations: 38 (fact model) and 39 (independent stages). Brief B goes from 37 to 39 migrations. |
| **New defects found while designing** | Four launch blockers, listed in §1.2. They are included in the estimate. |
| **Rule checks** | **FIDReC:** checked against the Terms of Reference v2.2 (1 July 2025). It differs from the spec, and Elena decided to follow the Terms of Reference (§8.1). **SRF:** sourced from the MAS/IMDA Guidelines; Elena accepted the corrections (§8.2), and card losses are split from account losses (§8.3). |
| **Decisions for you** | Approve revision 2, choose single or staged go-live, and choose which simplifications to take (§13). |

---

## 1. How it works today

### 1.1 Data flow

| Step | Code | Reads | Sees the form answers? |
|---|---|---|---|
| Onboarding | `bootstrap_case_v1` | The story | — |
| Extract | `supabase/functions/run_case_extract_v4/index.ts` | `cases.*` (1138); one `case_intake` row (1142); the latest `case_narratives` row **of any type** (1151); document extractions (379) | **No** |
| Free draft | `supabase/functions/bright-function/index.ts` | `cases`, `case_intake`, `timeline_raw`, latest extract (90–148, 396) | No |
| Decision | `run_case_decision_v1` | Latest extract, documents, regulatory matches (831–931) | No |
| S$18 report | `run_report_selfserve_v1` | Decision, extract, clauses (946–1009) | No |
| FIDReC pack | `lib/server/fidrec/*` | `cases.primary_narrative`; the narrative and final-reply text passed in the request body | No |

- Intake and follow-up answers are written to `case_responses`, but **no pipeline step reads that table**.
- The responses route overwrites answers in place (`app/api/cases/[caseId]/responses/route.ts:99-125`), so there is no answer history.
- `case_intake` allows only one row per case (`ux_case_intake_case_id`, `remote_schema.sql:2265`), so there is no story history either.

### 1.2 Defects found during this design (launch blockers, included in the estimate)

| # | Defect | Evidence | Fixed in |
|---|---|---|---|
| F1 | **The S$188 buy button can never be enabled.** The dashboard requires `eligible_actions.run_escalation_pack`, which is true only once the pack is already owned (`20260419140000_get_case_eligibility_self_serve.sql`, `e_esc := f_esc …`). It also requires `canCheckout`, which is true only when the pack is *not* owned. | `dashboard-client.tsx:266-268`, `lib/billing/case-capabilities.ts:183-192` | C2 |
| F2 | **Nothing generates the FIDReC pack after payment.** The app only reads and exports a pack (`use-tier2-pack.ts:29`, `use-case-pack-export.ts:17`). The generators run only through POST routes or the operator script `scripts/run-tier2-for-case.ts`, and payment only grants the capability. | Worker job types: `worker/index.ts:189` | C4 |
| F3 | **The extract feeds GuideBuoy's own text back in.** After the free draft, the "latest narrative" it reads is a `tier0_*` row. | `run_case_extract_v4/index.ts:1151-1155` | A3 |
| F4 | **The FIDReC executive summary falls back to the institution name "DBS"** when none is found, which invents a fact. | `lib/server/fidrec/build-executive-summary-narrative.ts:284,321,434` | C4 |

Also noted:
- The free-draft function hard-codes `gpt-4o-mini` (`bright-function/index.ts:829`), so `check-env-set` cannot check it. A3 moves it to an env setting.
- Privacy deletion is a request queue that nothing processes yet. That is outside this spec, but the new tables join the export now.

---

## 2. Fact keys, normalisation and comparison rules (§3.2)

### 2.1 Module

There is one module, `lib/facts/`, imported by both the Next.js server and the Edge Functions. The shared code lives in `supabase/functions/_shared/facts/` and is re-exported to the app, so the rules are written once. It holds:

| File | Contents |
|---|---|
| `keys.ts` | Fact keys, value types, stage requirements (§7) and plain-English labels |
| `normalise.ts` | Dates to ISO in Asia/Singapore; money to SGD with the original amount and currency kept; enums |
| `institutions.ts` | Alias table to a canonical name and a type (`bank` / `payment_service_provider` / `telco` / `other`). It starts from the existing `guessInstitutionName` aliases (`run_case_extract_v4:826`) and `fidrec_eligible.aliases`. It adds the e-wallet issuers (GrabPay, DBS PayLah!, ShopeePay, YouTrip, Singtel Dash and others) and the four network operators (Singtel, StarHub, M1, SIMBA). |
| `reconcile.ts` | Deterministic comparison producing findings |
| `rules/srf.ts`, `rules/fidrec.ts` | The cited rule tables (§8) |

### 2.2 Per-fact rules

Spec keys, plus three additions (marked +) that the SRF assessment needs.

| Fact key | Normalised value | Rule | Notes |
|---|---|---|---|
| `institution_names` | set of `{name, type}` | Set equality after alias mapping. A name present in only one source is a `conflict` if another source names a different institution, and `agreed` otherwise. | Unknown names are kept as typed and flagged `other`. |
| `account_types` | set of enums | Set equality | Adds `credit_card`, `debit_card` and `ewallet` to support the card exclusion (§8.2). |
| `scam_type` | set of enums | Equality of sets | |
| `phishing_channel` | enum | Equality. `sms` is kept separate from `messaging_app`. | Only real SMS can involve a telco (§8.2). |
| + `credentials_entry_point` | `fake_website_or_app` / `given_directly_to_scammer` / `not_shared` / `unsure` | Equality | SRF limb (c). |
| + `impersonated_entity_type` | `bank_or_fi` / `government` / `other_business` / `private_person` / `unsure` | Equality | SRF limb (a). |
| + `transactions_intended` | yes / no / unsure | Equality | SRF limb (d); tells authorised scams apart. |
| `transactions` | list of `{date, amount, currency, channel, payee, last4, instrument}`. `instrument` is `account_transfer` / `sg_card` (a Singapore-issued credit, charge or debit card) / `ewallet` / `other`, and drives the card-loss split in §8.3. | **Matching:** date within ±1 day and amount within ±1%, then payee and last-4 when present. A transaction found in a document but not in the story or answers is `unsupported`-reverse: the user is asked "Is this one of the disputed payments?". A transaction in the story or answers with no matching document is `unsupported`. | Matching is one-to-one, largest amounts first. |
| `total_loss` | money | Within S$1 between sources. Also a `conflict` if the confirmed total differs from the sum of confirmed transactions by more than S$1. | |
| `date_first_unauthorised`, `date_discovered` | date | Equal | |
| `credentials_or_otp_shared`, `clicked_link_or_installed_app` | yes / no / unsure + detail | Equal on the yes/no part; detail is not compared | |
| `reported_to_bank`, `reported_to_police`, `written_complaint_sent` | yes / no (+ date, reference) | The yes/no parts must agree; dates within ±1 day; references must be equal when both are present | "Yes" with no document is `unsupported`. |
| `bank_response_status` | enum | Equal | "Final reply" without a final-reply letter is `unsupported` (§4.1). |
| `bank_final_reply` | `{date, outcome, reference}` | Dates and outcomes equal | Needed for FIDReC; drives the deadline. |
| `amount_recovered_or_offered` | money | Within S$1 | |
| `fidrec_filed` | yes / no + date + reference | Equal | |

**What counts as `missing`:** a fact the requested stage requires (§7, and C1 below) with no value in any source and no "Not known" answer.

### 2.2a Minimum fact set for launch

**Twelve keys are reconciled**, meaning they are compared across sources and can raise conflicts. These are what the free evaluation, SRF assessment, recommendation and the two packs need:

| # | Key | Why it is needed at launch |
|---|---|---|
| 1 | `institution_names` | Every stage; FIDReC membership (ToR Rule 4(1)(ii)) |
| 2 | `account_types` | SRF protected account; card split |
| 3 | `scam_type` | SRF scope |
| 4 | `phishing_channel` | SRF scope; telco wording |
| 5 | `credentials_or_otp_shared` | Merges `credentials_entry_point` and `clicked_link_or_installed_app` into one value: `entered_on_fake_site_or_app` / `given_directly` / `installed_app_or_malware` / `not_shared` / `unsure` |
| 6 | `transactions` (with `instrument`) | Packs; card split |
| 7 | `total_loss` | Packs; the S$150,000 cap |
| 8 | `reported_to_bank` | Recommendation |
| 9 | `written_complaint_sent` (with date) | The 4-week rule |
| 10 | `bank_reply` | Merges `bank_response_status` and `bank_final_reply`: status, date, outcome, and whether the letter qualifies under Rule 13(2) |
| 11 | `reported_to_police` | Evidence (not a barrier, §8.1) |
| 12 | `amount_recovered_or_offered` | FIDReC pack |

**Taken straight from the answers, not reconciled at launch:**
- `fidrec_filed` (journey answer);
- `date_discovered` (story extraction);
- `impersonated_entity_type` (one free-evaluation question).

**Derived, not asked:**
- `date_first_unauthorised`, from the earliest confirmed transaction;
- `transactions_intended`, from `scam_type`.

These five can join reconciliation after launch, with no schema change, since the tables are keyed by `fact_key`. **Saving: about 4 hours** (A2 1 h, A4 3 h). Most of the cost is in the shared machinery rather than in individual keys.

### 2.3 Re-reconciliation (§3.4.7)

- Every reconcile run stores an input hash of the story revision, the answer revisions and the document-extraction IDs.
- A resolved finding keeps its resolution only while the **set of competing values** is unchanged; the comparison uses a hash of the sorted normalised values.
- Otherwise the old finding gets `invalidated_at` and a new open finding is created.
- Triggers for a new reconcile run: a story edit, an answer saved, a document processed or deleted.
- Delivered reports keep their `fact_snapshot_id`. The dashboard shows "Your facts have changed since this report" when the current snapshot hash differs.

---

## 3. Data model: migration 38 (additive)

All tables are case-scoped:
- RLS on, with **owner SELECT only** through `app_case_permission(case_id, 'view')`, the same as the existing case tables (`complete_pattern_c_security.sql:462`);
- **no INSERT/UPDATE/DELETE grants to `authenticated` or `anon`**;
- writes go only through service-role server routes or Edge Functions.

| Table | Purpose | Key columns |
|---|---|---|
| `case_story_revisions` | User-authored story history; fixes the one-row `case_intake` limit without changing it | `case_id`, `revision`, `text`, `origin` (`onboarding` / `user_edit`), `created_by_profile_id`, `created_at`. Unique on `(case_id, revision)`. **Backfill revision 1 from `cases.primary_narrative`.** |
| `case_response_revisions` | Append-only answer history. The current `case_responses` stays the "latest" view. | `case_id`, `question_key`, `value`, `response_type`, `origin` (`intake` / `follow_up` / `journey`), `created_at` |
| `case_fact_reconcile_runs` | One row per reconcile run | `id`, `case_id`, `input_hash`, `story_revision`, `model`, `prompt_version`, `created_at` |
| `case_fact_candidates` | One candidate value per fact per source | `case_id`, `run_id`, `fact_key`, `value jsonb`, `source_type` (`story` / `answer` / `document`), `source_ref jsonb` (story span; answer key and revision; document id, page and quote), `model`, `prompt_version` |
| `case_fact_findings` | Spec §3.6 | `id`, `case_id`, `run_id`, `fact_key`, `finding_type`, `values jsonb`, `values_hash`, `status` (`open` / `resolved` / `not_sure` / `acknowledged`), `resolution jsonb`, `resolved_by_profile_id`, `resolved_at`, `invalidated_at` |
| `case_fact_snapshots` | Immutable confirmed facts per stage | `id`, `case_id`, `stage` (`free` / `bank` / `fidrec`), `facts jsonb`, `hash`, `run_id`, `created_by_profile_id`, `created_at`. An UPDATE/DELETE trigger raises an error. |
| `case_fact_confirmation_events` | Append-only audit | `case_id`, `finding_id`, `event` (`resolved` / `not_sure` / `acknowledged` / `reopened` / `snapshot_created`), `payload`, `actor_profile_id`, `created_at` |

**New columns:**
- `reports.fact_snapshot_id`;
- `case_narratives.fact_snapshot_id` (free evaluation);
- `case_fidrec_packs.fact_snapshot_id` (new small table recording each FIDReC generation and its status, see C4);
- `jobs.payload` already exists, and the snapshot ID travels in it.

**Security tests:**
- `tests/database/security-baseline.test.sql` already finds every table through the catalogue, so RLS and the anon checks cover the new tables automatically.
- `scripts/sql/tests/test-pattern-c-security.sql` has hard-coded lists (104–126, 138–157, 183+), so all seven tables are added there.
- New pgTAP checks:
  - owner SELECT works;
  - another user sees nothing;
  - `authenticated` cannot write;
  - snapshot UPDATE fails.

**Privacy export:** `app/api/privacy/export/route.ts` adds the seven tables.

---

## 4. Pipeline and prompt changes (§3.4)

### 4.1 Candidate extraction: one source at a time

The core idea: **the model extracts each source separately and never sees two sources at once, so it cannot quietly resolve a conflict.**

| Source | How | Model? |
|---|---|---|
| Story | The latest `case_story_revisions.text` only | Yes: one extraction call per reconcile run. Each value comes with a short quote from the story. |
| Structured answers (radio, date, number, select) | Mapped directly to fact keys through a table in `keys.ts` | No |
| Free-text answers (e.g. `institution_name`, `financial_impact`, `contact_details`) | Institution names go through the alias table; amounts and dates are parsed with the normalisers. Only text that still doesn't parse goes to the model, one answer per call. | Only for text that doesn't parse |
| Documents | One call per processed document over `case_document_extractions`. Each value carries its document ID, page and a short quote. The extraction stays as it is today. | Yes |

**Prompt: before** (`run_case_extract_v4/index.ts:1269-1274`). One call mixes all sources, including a GuideBuoy-generated row:

```
CASE: {cases.*}
INTAKE: {case_intake row}
NARRATIVE: {latest case_narratives row, any type}      <- can be GuideBuoy text
EVIDENCE_DIGEST: {document extractions}
System: "...If SERVER_COMPUTED.institution_name_guess is not null, set case_meta.institution_name
to that value unless clearly contradicted..."            <- the model arbitrates
```

**Prompt: after** (story call; the document call has the same shape with `DOCUMENT` and page markers):

```
System: You extract facts from ONE source written by the claimant. Return JSON matching FACT_TEMPLATE.
For every value include "quote": the exact words (<= 25) it comes from. If the source does not state a
fact, use null. Do not infer, do not use outside knowledge, do not reconcile with anything else.
User:   SOURCE_TYPE: story
        SOURCE_TEXT: {case_story_revisions.text}
        FACT_TEMPLATE: {keys from lib/facts/keys.ts}
```

**The existing extract stays.** The decision, follow-up questions and validation still need its output. From A3 it reads the story revision and answers instead of the latest narrative row, which removes F3. A contract test fails if any pipeline input contains a `tier0_*`, report or pack row.

### 4.2 Confirmation and snapshot

1. `POST /api/cases/:id/facts/reconcile` starts a run (service role). It runs automatically after every trigger in §2.3.
2. `GET /api/cases/:id/facts?stage=free|bank|fidrec` returns agreed facts and the open, resolved and missing findings for that stage, plus the counter of what's left.
3. `POST /api/cases/:id/facts/findings/:findingId` records `{choice | corrected_value | not_sure | acknowledged, note}`. It is allowed only if the finding is open and belongs to the caller's case, and it writes an audit event.
4. `POST /api/cases/:id/facts/snapshot?stage=…` returns **409 `facts_unconfirmed`** if any finding the stage needs is open. Otherwise it freezes a snapshot and returns its ID.

Generation (free draft, bank report job, FIDReC job) **accepts only a snapshot ID**. It checks again on the server that the snapshot is the latest for that stage and that no relevant finding has reopened since. This is how "no report with open findings" is enforced even if the UI is bypassed.

### 4.3 Report prompts: before and after (all three stages)

- **Before:**
  - `run_report_selfserve_v1:297-331` sends `extract_json` and `decision_json` with the rule "use only extract_json and decision_json".
  - The free draft sends `cases` fields, the intake and the latest extract (`bright-function:125-148`).
  - The FIDReC generators receive the narrative and final-reply text from the request body.
- **After:** each stage gets `CONFIRMED_FACTS` from the snapshot, with every fact labelled `confirmed`, `not_sure` or `claimant_only` (unsupported but kept). They also get the evidence index and regulatory context. These rules are added to every system prompt:

```
Use only CONFIRMED_FACTS for facts. Facts labelled "confirmed" are stated as facts.
Facts labelled "not_sure" must be written as unconfirmed ("The claimant is not sure whether ...").
Facts labelled "claimant_only" must be attributed ("According to the claimant, ...").
Never state a date, amount, institution or yes/no fact that differs from CONFIRMED_FACTS.
Write neutrally: do not overstate or understate. No legal conclusions, no predictions of outcome.
```

- **Stage-specific additions:**
  - **Free evaluation:** situation summary; journey position; the SRF scope assessment text, chosen by the server from `rules/srf.ts` and **not written by the model**; key gaps; the recommendation, chosen by the server (§6).
  - **Bank pack:** "Concise. Key facts only. Claim letter ≤ 1 page, chronology ≤ 10 entries."
  - **FIDReC pack:** "Comprehensive. Set out the institution's position from its final reply and the claimant's position. Then give arguments for the claimant AND arguments for the institution, each linked to evidence IDs." `build-executive-summary-narrative.ts` no longer falls back to "DBS" (F4); an unknown institution stays "the institution".
- **"Facts you confirmed"** is rendered **by the server from the snapshot**, not by the model, so it is always exact.

### 4.4 Output validation (§3.4.6)

`lib/facts/validate-output.ts` runs after generation, before the commit RPC. These checks are deterministic:

| Check | How |
|---|---|
| Amounts | Every money amount in the text must equal a confirmed amount (within S$1) or a sum of confirmed transactions |
| Dates | Every date in the text must be a confirmed date, or be labelled unconfirmed |
| Institutions | Every institution named, after alias matching, must be in the confirmed `institution_names` |
| Yes/no facts | A phrase list per fact, such as "did not report … police", "no police report", "had not contacted the bank". A match against a confirmed opposite value fails. |
| `not_sure` / `claimant_only` | The sentence that mentions the fact must carry an approved qualifier |
| Structured fields | The report JSON fields (`disputed_transactions`, `timeline`) must equal the snapshot |

- On failure the stage regenerates once, with the failed checks added to the prompt. If it fails again, the job fails with `output_validation_failed`, the user sees "We couldn't produce a reliable report; we've been notified", and no report is delivered.
- **Limit:** the yes/no check is a phrase list, not full understanding. It catches direct contradictions such as the 5 November case; it cannot catch every paraphrase. The contradicting-output fixtures (§11) measure this.

---

## 5. Journey questions (§4.1)

- The six questions are stored as `case_responses` with `journey_*` keys and `origin = journey`, and they become answer candidates.
- A "final reply" answer with no final-reply document becomes `unsupported`. The user either uploads the letter or confirms "I don't have it".
- **Final-reply follow-up (ToR Rule 13(2)):** "Does the letter say it is the bank's final reply and that you can contact FIDReC within six months?" (Yes / No / Not sure). Only "Yes" counts as a qualifying final reply and starts the 6-month deadline. With "No" or "Not sure", the copy explains that FIDReC decides whether a letter counts as a final reply, and the 4-week route (§6) still applies.
- **Question 2 needs a date** when the answer is "Yes", because the 4-week rule counts from it.

```
┌ Where are you with your bank? ───────────────────────── step 2 of 4 ┐
│ 1  Have you told your bank or financial institution?               │
│    ( ) No   (•) Yes  → Date [12/10/2026]  How? [Hotline ▾]  Ref [ ] │
│ 2  Have you sent them a full written complaint with your evidence?  │
│    ( ) No   (•) Yes → Date [15/10/2026]   ( ) Not sure              │
│ 3  Has the institution replied?                                     │
│    ( ) No reply yet ( ) Acknowledged only ( ) Interim reply         │
│    (•) Final reply → Date [28/10/2026] Outcome [Rejected ▾]         │
│        [ Upload the letter ]                                        │
│        Does it say it's the final reply and mention FIDReC?         │
│        (•) Yes ( ) No ( ) Not sure                                  │
│ 4  Have you filed a police report?  ( ) No (•) Yes → Date, report no│
│ 5  Have you already filed with FIDReC?  (•) No ( ) Yes              │
│ 6  Which are involved? [x] Bank [ ] E-wallet/payment app            │
│    [x] Mobile operator (the scam SMS came through it) [ ] Other     │
│                                   [ Save and continue ]             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Recommendation and deadlines (§4.2)

- `lib/facts/recommend.ts` is a pure function of the confirmed facts, `BANK_PACK_ENABLED` and today's date. Its output is `{position, recommended, alsoAvailable[], reasons[], deadline?, warnings[]}`.
### 6.1 Recommendation table

This replaces the spec's §4.2 table, following the Terms of Reference as Elena decided on 5 Nov.

| Journey position | Recommended | Also available | Notes |
|---|---|---|---|
| Not yet told the institution | **Bank pack**, plus urgent guidance to report to the bank and the police now | Free evaluation | SRF timing: report within 30 calendar days of the bank's alert (G 7.3) |
| Told the institution; no written complaint | **Bank pack** | Free evaluation | |
| Written complaint sent **less than 4 weeks ago**; no final reply | **Bank pack (optional)**: we can't judge the complaint already sent. Plus guidance to chase the institution. | Free evaluation | FIDReC pack shown as "available from [complaint date + 28 days]" (Rule 13(1)(i)) |
| Written complaint sent **4 weeks or more ago**; no qualifying final reply | **FIDReC pack** | Bank pack; free evaluation | No deadline shown, because the 6-month clock starts only with a qualifying final reply (Rule 13(1)(ii), Rule 13(2)) |
| **Qualifying final reply**, within 6 months | **FIDReC pack**, with the deadline | Free evaluation | Bank pack not offered after a final reply (spec §5). Warning at 30 days or fewer remaining. |
| Qualifying final reply, **more than 6 months ago** | Explain that the window has passed (Rule 5(vi)) and suggest getting advice | Free evaluation | |
| Final reply received but **not qualifying, or not sure** | **FIDReC pack** if 4 weeks have passed since the written complaint; otherwise as the "less than 4 weeks" row | Free evaluation | "FIDReC decides whether a letter counts as a final reply (Rule 13(2))" |
| Already filed with FIDReC | **FIDReC pack** (case management / adjudication) | Free evaluation | Mentions the S$50 adjudication fee for individuals (Annex 1 6.6) |
| Full refund or resolved | No further step needed | Free evaluation | Settled complaints are excluded (Rule 5(ix)) |

**Also shown on the recommendation screen:**
- **The S$150,000 cap:** when the confirmed `total_loss` is above S$150,000, the free evaluation and the recommendation state the award cap (Rule 29(1)). A larger claim reaches adjudication only if the user limits the claim or the bank agrees (Rule 21(2)).
- **FIDReC membership:** if no institution in the case is found in `fidrec_eligible`, the copy says "We couldn't confirm that [institution] is a FIDReC member; FIDReC can tell you" (Rule 4(1)(ii)). This is not a block, because the member list may be incomplete.
- **Telco:** for SMS cases, the free evaluation says disputes about the mobile operator go to IMDA in writing, not FIDReC (G 7.11).
- **Police reports:** no barrier wording (Elena, 5 Nov). Rule 5(iv) is not used in the recommendation.

**Deadline calculation:**
- `qualifying_final_reply.date + 6 calendar months`. Where the result day doesn't exist (31 August → 28/29 February), it uses the last day of the month.
- A warning appears when 30 days or fewer remain.
- **The 4-week date** is `written_complaint_sent.date + 28 days`.
- The constants come from `rules/fidrec.ts` (§8.1).

```
┌ Your next step ─────────────────────────────────────────────────────┐
│ Where you are: your bank sent its final reply on 28 Oct 2026 and    │
│ you disagree with it.                                               │
│ ★ Recommended: FIDReC escalation pack · S$188                       │
│   Why: after a final reply, FIDReC is the next independent step.    │
│   You get: a complete, neutral case pack for FIDReC case managers…  │
│   ⏰ File with FIDReC by 28 Apr 2027 (6 months after the final reply)│
│   [ Prepare my FIDReC case ]                                        │
│ Also available: Free evaluation · [ Get your free evaluation first ]│
│ Bank dispute pack: not offered after a final reply.                 │
└─────────────────────────────────────────────────────────────────────┘
 State "deadline close" (≤ 30 days): amber banner "Only 12 days left to file with FIDReC (by 9 Nov)".
 State "window passed": no FIDReC button; "The 6-month window ended on …. You may wish to get advice."
 State "complaint sent 10 days ago, no reply":
   ★ Recommended (optional): Bank dispute pack · S$18. We can't check the complaint you already sent;
     a GuideBuoy pack sets out your evidence and the bank's duties.
   Chase your bank for a reply (steps listed).
   FIDReC escalation pack · available from 3 Dec 2026 (4 weeks after your written complaint)
 State "loss above S$150,000": note "FIDReC awards are capped at S$150,000 per claim. …"
 State "emergency switch off" (bank pack only): "Bank dispute pack · temporarily unavailable"
```

---

## 7. Confirm-your-facts screen (§3.5)

```
┌ Confirm your facts ─────────────────────── 2 to resolve · 1 to check ┐
│ We found two different answers. Please tell us which is correct.    │
│                                                                     │
│ ▸ Facts that agree (9)                                  [ show ]    │
│                                                                     │
│ ① Did you report this to the police?                     CONFLICT   │
│   Your story: "…I reported it to the bank and the police."          │
│   Your answer (intake): No                                          │
│   ( ) Yes, I reported it   ( ) No, I didn't   ( ) I'm not sure      │
│   If yes: date [        ] report number [        ]   Note [       ] │
│                                                                     │
│ ② Amount lost                                            CONFLICT   │
│   Your story: "S$2,400"                                             │
│   Bank statement (synthetic-statement.pdf): S$2,400 + S$600, 3 Oct  │
│   ( ) S$2,400  ( ) S$3,000  ( ) Enter amount [     ]  ( ) Not sure  │
│                                                                     │
│ ③ Bank's final reply                                  NO DOCUMENT   │
│   Your answer: Final reply received on 28 Oct 2026                  │
│   [ Upload the letter ]  or  [ ] I don't have a document for this   │
│                                                                     │
│ Missing for this pack: Did you share an OTP or password?  [ Answer ]│
│                                                                     │
│ [ Generate my FIDReC pack ]  (disabled · 3 items left)              │
└─────────────────────────────────────────────────────────────────────┘
```

- **Order:** conflicts, then unsupported claims, then missing facts; agreed facts are collapsed at the top. A document value names the document (Elena, 5 Nov: no page links at launch). The page and quote are still stored in `source_ref`, so links can be added later without a schema change.
- **When nothing has changed** since the last snapshot for this stage, a one-line step appears instead: "Your facts haven't changed since [date]. [Review] [Continue]".
- **Accessibility:**
  - each finding is a `fieldset` with a `legend`;
  - the counter is an `aria-live` region;
  - the layout is a single column on mobile;
  - it respects the sensory mode (`lib/sensory-mode-shell.ts`).

---

## 8. Rule tables with citations

### 8.1 FIDReC rules (Terms of Reference v2.2, 1 July 2025)

Encoded in `lib/facts/rules/fidrec.ts` with the clause citations below. The Terms of Reference text itself stays outside the repo (Elena, 5 Nov).

| # | Rule | Product behaviour | Clause |
|---|---|---|---|
| F1 | Complain to the institution first. A dispute not raised with the institution is sent back to it. | Recommendation requires `reported_to_bank` | Rule 4(2) |
| F2 | **Earliest filing:** the institution's internal process has not resolved the matter, **or** at least 4 weeks have passed since the matter was referred to it, whichever is earlier | S$188 available with a qualifying final reply **or** 28 days after the written complaint. **This differs from spec v3 §4.2 and Q-D; Elena decided on 5 Nov to follow the Terms of Reference.** | Rule 13(1)(i); Rule 4(1)(v) |
| F3 | **Latest filing:** no later than 6 months after the institution's final reply | Deadline shown only with a qualifying final reply; after it passes, S$188 is refused with `fidrec_window_expired` | Rule 13(1)(ii); Rule 5(vi) |
| F4 | **What counts as a final reply:** a written document that expressly says it is the final reply, says the customer can contact FIDReC within 6 months, gives FIDReC's contact details, and leaves no outstanding issues. FIDReC decides disputes about this. | Journey follow-up question (§5). Only "Yes" starts the deadline. | Rule 13(2) |
| F5 | The institution must be a FIDReC subscriber at the time of the events and when the complaint is filed | Soft note when the institution isn't found in `fidrec_eligible` | Rule 4(1)(ii), (vi) |
| F6 | Award cap S$150,000 per claim. Above that, adjudication only if the claim is limited or the institution agrees. | Free evaluation and recommendation note when `total_loss` > S$150,000 | Rule 29(1); Rule 21(2) |
| F7 | Excluded: complaints settled privately, decided by a court, or already decided by FIDReC without new material information | "Resolved" row; the FIDReC pack is not offered when `fidrec_filed` shows a decided case | Rule 5(viii)–(x) |
| F8 | Eligible complainants: individual consumers, sole proprietors, small businesses and charities with a customer relationship | No block. This is wider than the SRF (individuals only, §8.2 S7). | Rule 6 |
| F9 | Case fee (Annex 1 6.6, "Other Claims"): S$50 payable by an individual complainant if the dispute goes to adjudication; S$250 for a charity or small business. The S$250 fee and S$200 refund in 6.4–6.5 apply only to motor accident claims under the FIDReC-NIMA Scheme. | Mentioned in the FIDReC pack's next-steps guidance | Annex 1, 6.4–6.6 |
| F10 | Excluded: "cases under investigation by any law enforcement agency … referred to the police for investigation" | **Not used as a barrier and no wording** (Elena, 5 Nov). FIDReC handles many scam claims in practice; Elena is confirming its practice directly. | Rule 5(iv) |

**Secondary source**, consistent with F2 and F3: MoneySense, "Resolving a dispute with a financial institution".

### 8.2 SRF: sourced

Encoded in `lib/facts/rules/srf.ts`. Sources:
- **G** = MAS/IMDA *Guidelines on Shared Responsibility Framework*, issued 24 Oct 2024, effective 16 Dec 2024;
- **R** = MAS/IMDA *Response to Consultation* (24 Oct 2024);
- **CP** = Consultation Paper (25 Oct 2023);
- **E** = MAS *E-Payments User Protection Guidelines* (from 16 Dec 2024).

URLs are listed at the end of this document.

**Assessment rules**, applied to confirmed facts:

| # | Rule | Source |
|---|---|---|
| S1 | **Likely in scope** only if all four limbs hold: (a) a legitimate business or government entity serving Singapore was impersonated; (b) contact came through a digital messaging platform (SMS, email, WhatsApp, social media); (c) credentials were entered on a **fake website or app**; (d) the transactions were not intended | G §2.1, "seemingly authorised transaction" (a)–(d) and "legitimate business or government entity" |
| S2 | Protected account: held only by individuals, retail, usable for e-payments, and able to hold more than S$1,000 or a credit facility. For e-wallets, a Major Payment Institution licensed for account issuance. | G §2.1, "protected account", "relevant payment service provider"; G fn 2; R 8.4 |
| S3 | **Out:** transactions on Singapore-issued credit, charge and debit cards (covered by the ABS Code instead) | G fn 1; R 8.3(d) |
| S4 | **Out:** malware and malvertising, hacking, identity theft | R 3.4; CP 4.4(c) |
| S5 | **Out:** non-digital phishing (phone call only, face to face) and credentials given directly to the scammer | R 3.5; CP 4.4(b); G §2.1 limb (c) |
| S6 | **Out:** authorised scams (investment, romance, job, e-commerce where the user intended to pay) | CP 4.4(a); E fn 4(a) |
| S7 | **Out:** corporate accounts; sole proprietors (inferred from comparing G and E) | R 8.3(b); G §2.1 "protected account"(a) |
| S8 | In force from **16 Dec 2024**. Transactions before then: "likely out of scope". **No source states this**, so the wording stays "likely". | G cover; MR |
| S9 | **Waterfall, all or nothing:** the institution bears the full loss if it breached any duty in G 4.2, even if the telco also breached. The telco bears it **only** if the scam came by real SMS (not WhatsApp, iMessage, RCS or social media), the institution met all its duties, and the loss arises from the telco breaching its own duty. Only the network operators Singtel, M1, StarHub and SIMBA are covered. Otherwise the account holder bears the loss, and other routes remain open. | G 6.2–6.7; G §2.1 "SMS"; R fn 2 |
| S10 | **Consumer timing:** report as soon as practicable, and within 30 calendar days of the institution's alert. Give an email address and supporting information within 3 calendar days. Late reporting is not an automatic bar. | G 7.3; G fn 14 |
| S11 | The institution investigates in 21 business days (45 if complex) and replies in writing | G 7.9–7.10 |
| S12 | **Disputes:** with the institution, FIDReC; with the telco, write to **IMDA** (not FIDReC) | G 7.11 |
| S13 | **Out of scope still has remedies:** the institution's own process under the EUPG, FIDReC and goodwill payments | G 6.8, 7.11; E 5.2–5.6; R 6.11(d) |

**Corrections to spec §4.3:**
1. **"The telco may share responsibility"** is wrong. Responsibility is all-or-nothing and sequential (S9). The free-evaluation wording becomes: *"Because the scam message came by SMS, your mobile operator may be responsible if your bank met all its duties and the operator did not meet its own. Your bank assesses this; disagreements about the operator go to IMDA."*
2. **"Credit facilities"** must not include Singapore-issued cards (S3).
3. **"Websites"** is the fake platform, not a contact channel. Credentials given directly to the scammer are out (S1, S5).

**Unverified (wording stays "likely"):**
- pre-16 Dec 2024 transactions;
- whether e-wallet providers have joined FIDReC;
- the default alert threshold amount;
- whether consumer recklessness under EUPG 5.2 can defeat an SRF claim;
- an IMDA complaint channel.

---

### 8.3 Card losses and account losses (Elena, 5 Nov)

When a case has both Singapore-card transactions and account or e-wallet transactions (`transactions[].instrument`), every stage treats them as **two portions**:

| Portion | Framework | Basis |
|---|---|---|
| Account transfers and e-wallet payments from a protected account | SRF assessment S1–S9 (duties, waterfall) | G §2.1, Section 6 |
| Singapore-issued credit, charge and debit card transactions | **Outside the SRF.** Assessed under the E-Payments User Protection Guidelines and the card industry's ABS Code of Practice. | G fn 1; R 8.3(d); E paras 5.2–5.6 |

**How each stage uses the split:**
- **Free evaluation:** one SRF paragraph per portion, with subtotals, for example "S$2,400 by bank transfer: likely in scope …; S$600 on your credit card: the SRF does not cover Singapore-issued cards; the E-Payments Guidelines apply instead".
- **FIDReC pack:** separate analysis sections per portion, with the claimant's and the institution's arguments under the right framework, and subtotals that add up to `total_loss`.
- **Bank pack:** duty points grouped by portion.
- **Validator (§4.4):** portion subtotals must equal the confirmed transactions.
- **Tests:** a mixed-portion synthetic fixture in `srf-scope.test.ts` and the output-validation tests.

**One check during implementation:** how far E §2.1 ("protected account") applies to card accounts. That wording is fixed only after the clause is cited in `rules/srf.ts`.

---

## 9. Separate stages: migration 39 and API (§5)

### C1. Readiness: "can buy" and "can run" per product

A new RPC, `get_case_product_readiness_v1(case_id, product_key)`, returns `{can_buy, can_run, reason}`. **The same function runs inside `reserve_checkout_purchase_v1`**, so the database refuses what the API refuses.

| Product | Can buy when | Reason codes |
|---|---|---|
| Free evaluation | A story exists and a `free` snapshot exists | `story_missing`, `facts_unconfirmed` |
| Bank pack (`self_serve_report`) | Emergency switch on; documents processed; a bank snapshot exists with the bank-stage facts confirmed; no final reply confirmed; not already bought | `product_not_available`, `documents_processing`, `facts_unconfirmed`, `final_reply_received`, `already_purchased` |
| FIDReC pack (`fidrec_tier2_pack`) | Documents processed; a FIDReC snapshot exists with `reported_to_bank` confirmed; **either** a qualifying final reply confirmed with a date and today ≤ the deadline (F3, F4), **or** a confirmed written complaint dated 28 or more days ago (F2); not already bought | `documents_processing`, `facts_unconfirmed`, `complaint_not_raised`, `fidrec_too_early` (with the available-from date), `fidrec_window_expired`, `already_purchased` |

- **Switch in the database:** the emergency switch is an env setting read by the app. The RPC receives `p_bank_pack_enabled` from the server route, which is service role only. Clients can't call `reserve_checkout_purchase_v1` directly: the function is revoked from `PUBLIC`, `anon` and `authenticated` and granted only to `service_role` (`release_security_and_fulfilment_hardening.sql:504-507`).
- **Removed:**
  - `FI Guide purchase required` (`release_security_and_fulfilment_hardening.sql:421`);
  - the qualifying-capability raise in `grant_fidrec_pack_capability_v1` (`:1047`), which instead sets `allow_escalation_pack` on a new or existing row without touching `allow_self_serve_report`;
  - `requiresReportEntitlement` (`case-capabilities.ts:50,194`).
- **Products are independent:** neither grants the other. The D6 check (`report-purchase-readiness.ts`) becomes a thin wrapper over this RPC.

### C2. Checkout and capabilities

- Checkout returns 409 `{error, reason}` from the RPC.
- Capabilities return `{state: available | coming_soon | blocked | owned, reason}` per product.
- The dashboard's `canBuyTier2` uses `fidrecPack.canCheckout` only (F1).

### C3. Free evaluation

- `bright-function` reads the `free` snapshot only. It writes `tier0_*` rows with `fact_snapshot_id`, plus the server-chosen SRF and recommendation blocks.
- **The automatic trigger goes.** Today the free draft fires automatically after validation (`use-tier0-auto-fire.ts:97-128`). The user now presses "Get my free evaluation" after confirming. Without this, the confirm screen could be skipped.
- The model setting moves to `TIER0_MODEL`, checked by `check-env-set`.

### C4. FIDReC pack on purchase (F2)

1. The payment webhook enqueues a new `fidrec_pack_generation` job carrying the FIDReC snapshot ID, the same way `enqueue_post_payment_report_generation` works today.
2. The worker runs the existing generators in the operator-script order (`scripts/run-tier2-for-case.ts:232-256`). It feeds them the snapshot facts and the **final-reply letter text from the uploaded document**, instead of request-body text.
3. It adds an **"arguments for the claimant / arguments for the institution"** section, each argument tied to evidence IDs, and an "institution's position" section from the bank assertions.
4. Each run and its status (`queued`, `running`, `ready`, `failed`) is recorded in `case_fidrec_packs`.
5. The dashboard polls the status, the same way as D7.
6. The POST routes stay for operator use, behind the same entitlement checks.

### C5. State machine

The stages become separate branches instead of one chain:

```
story → intake → journey → evidence → [recommendation] → confirm(stage) → generate(stage)
```

- `use-state-machine.ts` gains `S1-Journey`, `S1-Recommendation` and `S1-ConfirmFacts`.
- The L2 (bank) and L3 (FIDReC) branches are selected by **what was bought, not by plan order**.
- `?intent=bank|fidrec` from a banner is carried through sign-in (`redirect_url=/onboarding?intent=…`). It only preselects; the recommendation still runs.

### C6. Bank-pack emergency switch (Elena, 5 Nov)

The bank pack launches **on** in both staging and production, like the other packs. The switch is only for emergencies, so there is **no second service and no switch-off CI lane**.

- `BANK_PACK_ENABLED` (`true` / `false`) is **required** in `check-env-set` for both environments, and a missing value fails the check. Both environments are set to `true`.
- **When it's off:**
  - checkout returns 409 `product_not_available`;
  - capabilities return `unavailable`;
  - the banner and recommendation show "Temporarily unavailable";
  - existing purchases are still fulfilled, because the job doesn't check the switch.
- **No waitlist** at launch.
- **Tests:** unit and contract tests only (readiness, checkout route, capabilities and recommendation with the switch off).
- **Runbook:** both directions are a Render env change plus a restart.

---

## 10. Home page (§6)

- Three cards on the SRF route in `app/(marketing)/page.tsx`, built from `components/harbor/pack-comparison.tsx` with prices from `PRODUCT_CATALOGUE`:

```
┌ Free evaluation ──────┐ ┌ Bank dispute pack · S$18 ─────┐ ┌ FIDReC escalation pack · S$188 ┐
│ Understand where you  │ │ Haven't sent your bank a full │ │ Received your bank's final     │
│ stand and your        │ │ written complaint yet, or not │ │ reply and disagree? Prepare a  │
│ options, free.        │ │ sure yours was complete?      │ │ complete, neutral case pack    │
│ For: anyone affected  │ │ Prepare one with your evidence│ │ for FIDReC.                    │
│ by a scam             │ │                               │ │                                │
│ [ Start free ]        │ │ [ Prepare my bank complaint ] │ │ [ Prepare my FIDReC case ]     │
└───────────────────────┘ └───────────────────────────────┘ └────────────────────────────────┘
 Emergency switch off, middle card:  Bank dispute pack · Temporarily unavailable
```

- The pricing and how-it-works pages describe three separate options.
- These are updated:
  - `docs/harbor-ui/route-and-cta-matrix.md`;
  - `docs/harbor-ui/copy-and-claims.md`, where the new copy goes into the claim ledger;
  - `scripts/test-harbor-ui-contract.ts`.

---

## 11. Test plan

Nothing existing is weakened. Tests that encode the old chain are rewritten to the new rule, with the reason given in the commit, never deleted.

| Area | Tests | Where |
|---|---|---|
| Comparison rules | Each fact key: agree, conflict, tolerance edges (±1 day, ±1%, ±S$1), aliases (POSB→DBS, PayLah→DBS e-wallet, Singtel→telco), transaction matching, total ≠ sum | `tests/contracts/facts-reconcile.test.ts` |
| Re-reconciliation | A changed value reopens a finding; an unchanged value keeps the resolution | same |
| Source separation | Pipeline inputs never contain `tier0_*`, report or pack rows; extract, free evaluation and FIDReC read answers and snapshots | `tests/contracts/pipeline-inputs.test.ts` |
| Open findings | Snapshot 409 `facts_unconfirmed` for every stage; job refuses a stale snapshot | contract + authenticated |
| Output validation | Fixtures of model output contradicting police yes/no, amount, date and institution must fail; correct output passes; regenerate-once, then fail | `tests/contracts/output-validation.test.ts` |
| Conflict fixtures (synthetic) | Police yes vs no; story amount vs statement; institution mismatch; final reply claimed with no letter | seed + contract |
| Recommendation | One test per §6.1 row; 4-week boundary (27 / 28 days); qualifying vs non-qualifying final reply; window inside, ≤ 30 days, expired; month-end dates; S$150,000 cap note; IMDA wording for SMS cases; emergency switch off | `tests/contracts/recommend.test.ts` |
| SRF | Digital phishing in scope; malware out; phone-only out; credentials given directly out; Singapore card out; before 16 Dec 2024 "likely out"; SMS → telco wording; WhatsApp → no telco; **mixed card and account case split into two portions with correct subtotals** | `tests/contracts/srf-scope.test.ts` |
| Entitlements (pgTAP + API) | S$188 with a qualifying final reply; S$188 four weeks after a written complaint with no reply; S$188 refused before 4 weeks (`fidrec_too_early`) and after the window; S$18 allowed before a final reply and refused after; S$18 refused with the switch off (unit/contract only); empty case refused; products independent | `scripts/sql/tests/*`, checkout spec |
| Security | Seven tables: RLS, owner-only SELECT, no client writes, snapshot immutable; export includes them | baseline + pattern-c lists |
| Authenticated end-to-end | (i) fresh → free evaluation → recommendation; (ii) fresh, no final reply → bank pack (Stripe test); (iii) fresh with a qualifying final reply → FIDReC pack directly; (iv) bank pack, then final reply, then FIDReC on the same case; (v) conflict resolved, and the choice appears in each stage's report. No switch-off end-to-end test (Elena, 5 Nov). | `tests/e2e/authenticated/*` |
| Rich-case regression | The local answer key outside the repo, with a field diff reported (counts only) | existing regression script |

---

## 12. Estimate (revision 2)

These figures include Elena's S1 decisions of 5 Nov:
- confirm screen without page links: −3 h;
- the Terms of Reference rules (4-week route, qualifying final reply, cap, fee, membership note): +3 h;
- the card-loss split: +6 h;
- the minimum fact set: −4 h;
- bank pack built for launch, with the emergency switch tested by unit tests only and no switch-off lane;
- after-payment FIDReC generation kept.

### 12.1 Shared work, free evaluation and FIDReC pack

| Part | Item | Hours |
|---|---|---|
| A1 | Migration 38: seven tables, RLS, grants, story backfill, security lists | 7 |
| A2 | Fact keys (minimum set), normalisers, alias table with types, transaction `instrument` | 6 |
| A3 | Candidate extraction per source; extract reads story and answers (F3); model env setting | 12 |
| A4 | Reconciler and re-reconciliation (12 reconciled keys) | 7 |
| A5 | Facts API: reconcile, findings, snapshot; audit | 6 |
| A6 | Confirm screen (documents named, no page links) | 9 |
| A7 | Output validator (including portion subtotals); server-rendered "Facts you confirmed" | 9 |
| A8 | Privacy export | 2 |
| A9 | Part A tests | 10 |
| B1 | Journey questions, final-reply follow-up, complaint date | 7 |
| B2 | Rules modules (SRF, FIDReC with ToR citations) and recommendation engine (4-week route, cap, fee, membership) | 7 |
| B3 | Recommendation screen, all states | 6 |
| B4 | SRF scope assessment with card and account portions | 6 |
| B5 | Part B tests | 5 |
| C1 | Migration 39: per-product readiness (4-week route), remove the chain | 9 |
| C2 | Checkout and capabilities, reason codes, F1 | 5 |
| C3 | Free evaluation on snapshot, portions, cap note, IMDA wording | 11 |
| C4 | FIDReC pack job, both-sides arguments per portion, fee guidance, F2, F4 | 22 |
| C5 | State machine and intent | 8 |
| C6t | Part C tests, end-to-end (i), (iii), (v) | 10 |
| D | Home page, pricing, how-it-works, copy docs, UI contract | 10 |
| Q2 | Option (a): evidence list stays visible | 3 |
| R | Release: two migrations into the hashed procedure and brief B; staging deploys; seed; walkthrough doc; regression diff | 10 |
| | **Subtotal** | **187** |

### 12.2 Bank pack (shown separately)

| Item | Hours |
|---|---|
| K1 Bank report on snapshot: input, concise template, duty points by portion, validator settings | 10 |
| K2 Bank prerequisites (no final reply, required facts) | 2 |
| K3 Emergency switch `BANK_PACK_ENABLED` (env, check-env-set, checkout, capabilities, UI), unit and contract tests only | 4 |
| K4 Bank tests: end-to-end (ii), (iv); entitlement cases | 7 |
| **Subtotal** | **23** |

**Before simplification: 210 hours.**

### 12.3 The ten largest items, and whether a simpler launch version exists

| # | Item | Hours | Simpler launch version | Saves | Recommendation |
|---|---|---|---|---|---|
| 1 | C4 FIDReC pack job | 22 | Track status in the existing `jobs` table instead of a new `case_fidrec_packs` table; reuse the operator-script order as it is | 3 | **Take** |
| 2 | A3 Candidate extraction | 12 | Map document facts deterministically from the existing extraction JSON, with the model only for yes/no facts | 3 | Don't take: lower recall from documents means more missed conflicts |
| 3 | C3 Free evaluation | 11 | Keep today's free-draft sections; add the SRF, recommendation and cap blocks rendered by the server | 2 | **Take** |
| 4 | A9 Part A tests | 10 | — | 0 | No cut (tests) |
| 5 | C6t Part C tests | 10 | — | 0 | No cut (tests) |
| 6 | D Home page and marketing pages | 10 | Three cards on the home page; only the text that names a forced sequence changes on the pricing and how-it-works pages | 3 | **Take** |
| 7 | R Release work | 10 | Deploy to staging at 3 milestones (after A+B, after C, after the bank pack and D) instead of after each of 6 steps | 2 | **Take** |
| 8 | K1 Bank report | 10 | Keep today's report template; change only the inputs (snapshot) and the prompt rules | 3 | **Take** |
| 9 | A6 Confirm screen | 9 | Drop the "unchanged since …" short step; always show the full screen with agreed facts collapsed | 2 | Optional: a slower repeat purchase |
| 10 | A7 Output validator | 9 | Smaller phrase list for yes/no facts | 2 | Don't take: this is the contradiction safety net |

**Recommended simplifications: −13 h. Revised total: 197 hours** (177 shared, 20 bank), **about 236 with 20% contingency.** Taking the optional and not-recommended rows as well would reach 190.

Daily status reports will track hours against 197, and I'll flag it if the total heads past 246 (25% over).

---

## 13. Decisions needed at S1 (revision 2)

| # | Decision | Status |
|---|---|---|
| D1 | Approve revision 2 and the estimate of 197 hours | **Open** |
| D2 | Free evaluation as a button after confirming facts | Agreed 5 Nov |
| D3 | Bank pack built for launch, emergency switch, no switch-off lane | Agreed 5 Nov |
| D4 | SRF corrections (§8.2) and card-loss split (§8.3) | Agreed 5 Nov |
| D5 | Follow the Terms of Reference (§8.1 F2–F4); no police-exclusion wording (F10) | Agreed 5 Nov |
| D6 | Confirm screen without page links; FIDReC generated automatically after payment | Agreed 5 Nov |
| D7 | Brief B goes to 39 migrations | Agreed 5 Nov |
| D8 | Simplifications in §12.3 | **Open.** I recommend the five marked "Take". |
| D9 | Single or staged go-live (§14) | **Open** |

---

## 14. Go-live options, costed

Assumptions:
- S1 approved on **Friday 6 November**;
- about **10 agent hours a day**;
- each gate review within a day;
- about 3 days from staging-ready to cutover (walkthrough, G3b and G5, brief B about 6.5 hours);
- a weekday cutover, as agreed.

The 20% contingency would add about 4 days to each date.

### 14.1 Single go-live

| | Hours | Staging ready | Go-live |
|---|---|---|---|
| Everything | 197 | about Wed 25 Nov | **about Mon 30 Nov** |

### 14.2 Staged go-live

| Stage | Contents | Hours | Staging ready | Go-live |
|---|---|---|---|---|
| **1. Free evaluation** | All of Part A (68) and Part B (31); free evaluation (C3, simplified, 9); state machine and capabilities for the free path (7); home page with both paid packs shown as "coming soon" (7, plus 2 for a FIDReC "coming soon" state); Q2 (3); stage-1 end-to-end tests (4); release with migration 38 only (6) | **137** | about Thu 19 Nov | **about Mon 23 Nov** |
| **2. FIDReC and bank packs** | C1 migration 39 (9); rest of C2 and C5 (6); FIDReC job (19); Part C tests (6); bank pack (20); a second production release with migration 39 (6) | **66** | about Sat 28 Nov | **about Tue 1 Dec** |
| **Total** | | **203** | | |

**What the staged option means:**
- Promotion can start about **a week earlier** (23 Nov rather than 30 Nov).
- The paid packs arrive about **1–2 days later** than with a single go-live.
- It costs about **6 extra hours**, for a second production release and the "coming soon" state of the FIDReC pack.
- Brief B runs twice: first with 38 migrations, then a short second run that applies migration 39 through the same hashed procedure.
- **Risk:** the first live user's FIDReC pack waits for stage 2, about 1 December.

## Sources

- G: https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidelines/pso/guidelines-on-shared-responsibility-framework/guidelines-on-shared-responsibility-framework.pdf
- R: https://www.mas.gov.sg/-/media/mas-media-library/publications/consultations/pd/2023/srf/mas-imda-response-to-consultation-on-shared-responsibility-framework.pdf
- CP: https://www.mas.gov.sg/-/media/mas-media-library/publications/consultations/pd/2023/srf/consultation-paper-on-proposed-shared-responsibility-framework.pdf
- E: https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidelines/pso/e-payments-user-protection-guidelines-with-effect-from-16-dec-2024/e-payments-user-protection-guidelines-with-effect-from-16-december-2024.pdf
- MR: https://www.mas.gov.sg/news/media-releases/2024/mas-and-imda-announce-implementation-of-shared-responsibility-framework-from-16-december-2024
- MoneySense: https://www.moneysense.gov.sg/resolving-a-dispute-with-a-financial-institution/
- FIDReC, Terms of Reference v2.2, with effect from 1 July 2025 (copy held outside the repo).

## Appendix: e-wallet and telco data check (counts and field names only)

| Source | Finding |
|---|---|
| Pre-reset staging dump (2 Nov), which holds the original test data | 50 cases, all `claim_type = phishing_scam`. 1 `case_responses` row in total. |
| E-wallet terms (e-wallet, e-money, GrabPay, PayLah, ShopeePay, PayPal and similar) | 2 cases, counting only user-written text or documents |
| Telco terms (Singtel, StarHub, M1, SIMBA, "telco", "mobile operator") | 2 cases in user-written text; none in documents |
| SMS mentioned | 7 cases |
| Synthetic seed | No e-wallet or telco cases |
| Schema | No institution type, account type, scam type or channel field. The extract has one `case_meta.institution_name`; the only telco field is `regulatory_documents.duties_telco` in the regulation library. |

These counts are term matches, not classifications. The synthetic fixtures (§11) add one e-wallet case and one SMS/telco case.
