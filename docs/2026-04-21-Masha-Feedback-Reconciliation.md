# 2026-04-21 — Masha Feedback Reconciliation

**Purpose.** Masha gave feedback during her vacation confirming which Supabase edge functions are live (and which she archived) and, in a follow-up on 2026-04-21 PM, confirmed the **canonical call sequence**. This document reconciles that feedback with the three existing docs (`Front-to-Back-End-Integration-Summary.md`, `State-Machine-Workflow.md`, `State-Machine-Refactor-Plan.md`) and is the binding contract for the Pass 2 rewrites.

**Status.** ✅ Pass 2 in progress — 2026-04-21 PM Masha-confirmed sequence (see §0) + Dance-confirmed structural answers (see §5 annotations) are now authoritative. The three existing docs are being rewritten to match.

**Owner.** Elena + Dance. **Last updated.** 2026-04-21 (PM).

---

## Table of contents

0. [**2026-04-21 PM — RESOLVED: canonical sequence + structural answers**](#0-2026-04-21-pm--resolved-canonical-sequence--structural-answers)
1. [What Masha told us](#1-what-masha-told-us)
2. [Active edge-function set (verified 2026-04-21 in Supabase Dashboard)](#2-active-edge-function-set-verified-2026-04-21-in-supabase-dashboard)
3. [Function-by-function reconciliation](#3-function-by-function-reconciliation)
4. [Archived / removed functions](#4-archived--removed-functions)
5. [Open structural questions — RESOLVED 2026-04-21 PM](#5-open-structural-questions--resolved-2026-04-21-pm)
6. [Final end-to-end workflow (Masha + Dance confirmed 2026-04-21 PM)](#6-final-end-to-end-workflow-masha--dance-confirmed-2026-04-21-pm)
7. [What changed in Pass 1](#7-what-changed-in-pass-1)
8. [What changed in Pass 2](#8-what-changed-in-pass-2)

---

## 0. 2026-04-21 PM — RESOLVED: canonical sequence + structural answers

This section supersedes all earlier assumptions. Where §2–§8 below disagree with this section, §0 wins.

### 0.1 Canonical call sequence (Masha quote, 2026-04-21 PM)

> "То есть корректная последовательность тогда:
> Tier 0
> 1) Evidence Processed v2
> 2) Run Case Extract v4 ⇒ validation
> 3) Tier 0 Narrative Generator
> Upgrade to Tier 1 via payment via Stripe
> 4) Run Case Decision v1
> 5) Run Report Selfserve v1"

**Tier-0 (free) — three steps:**

| # | Function | Trigger |
|---|---|---|
| 1 | `evidence_processed_v2` | Server-side, per uploaded document, on the dedicated post-login "upload your evidence" screen. |
| 2 | `run_case_extract_v4` | Server-side, after minimum intake is complete. **Fires multiple times** through the gap-question loop (each gap answer, each new document, one final freshness-check pass). "Validation" is a Postgres-level trigger on `case_extract_runs` — **not** a separate function call. |
| 3 | `bright-function` (Dashboard label: "tier-0 narrative generator") | Once the gap loop has settled. Produces `tier0_summary`, `tier0_evidence_checklist`, minimal `tier0_srf_signal`. |

**Tier-1 (paid — after Stripe upgrades `plan = 'self_serve_report'`) — two steps:**

| # | Function | Trigger |
|---|---|---|
| 4 | `run_case_decision_v1` | Render worker, after Stripe webhook. **Only re-runs `evidence_processed_v2` + `run_case_extract_v4` if the user added new documents or new narrative** in the Tier-1 upgrade flow; otherwise go straight to decision. |
| 5 | `run_report_selfserve_v1` | Render worker, immediately after decision succeeds. Requires server-only `simulation_key`. |

### 0.2 `candidate-transactions` and `compute-loss` — fallback-only, NOT frontend-called

Masha confirmed (2026-04-21 PM): **`run_case_extract_v4` now calculates the loss amount itself**. `candidate-transactions` and `compute-loss` exist **only as fallbacks** — Masha triggers them manually from the Supabase Dashboard when `run_case_extract_v4` fails to compute the loss correctly.

Consequences:

- The frontend **does not** call these two functions. No server route, no client hook, no UI affordance.
- `lib/edge-functions.ts` no longer exports `CANDIDATE_TRANSACTIONS_FN` or `COMPUTE_LOSS_FN` constants, and no longer maps `candidateTransactions` / `computeLoss` routes. They live under `FALLBACK_ONLY_FNS` for grep-visibility only.
- No `/api/edge/candidate-transactions` or `/api/edge/compute-loss` route folder is created. (Pass 1 created them as placeholders; Pass 2 deletes them — though in this repo they were never actually committed beyond the constants, so there is nothing to delete on disk.)

### 0.3 Dance-confirmed structural answers (2026-04-21 PM)

These answer the eight remaining open questions that the Masha sequence alone did not close:

| # | Decision | Implication |
|---|---|---|
| A | **`candidate-transactions` + `compute-loss` are Masha-internal only.** | Removed from frontend constants / routes entirely. Documented as fallback-only. No UI auto-fallback logic. |
| B | **Gap-question loop stays.** | Tier-0 is NOT a single linear pass. `run_case_extract_v4` still fires multiple times (after intake, after each gap answer, after each new document, final freshness check). `bright-function` fires only after the user has either answered gaps or clicked "skip for now". |
| C | **Pre-login narrative capture → CLIENT-SIDE ONLY until Clerk login.** *(Revised 2026-04-21 PM after Pattern C cross-check.)* On the public landing page, user records/types their story and it is held in `sessionStorage` (or Clerk `unsafeMetadata` once they start the sign-up flow). No Supabase write happens before Clerk auth. On the first authenticated request post-login, the server creates the `cases` row + `case_intake` row via `createUserClient()` using the stored narrative. **Pattern C is unchanged** — no nullable `user_id`, no new anonymous RLS policy, no draft-token cookie, no TTL cron. Downside accepted: narrative is lost if the browser crashes or the user switches devices before login. |
| D | **Evidence upload happens AFTER narrative capture + Clerk login.** | Dedicated "upload your evidence" screen. Narrative alone is NOT enough to start the pipeline — at least one document is required before `evidence_processed_v2` fires. |
| E | **Tier-1 re-runs are conditional.** | Re-run `evidence_processed_v2` + `run_case_extract_v4` only if the user added new docs or edited the narrative after paying. Otherwise skip straight to `run_case_decision_v1` → `run_report_selfserve_v1`. |
| F | **`gemini-task` is archived.** | Removed from all docs, removed from `lib/edge-functions.ts` (replaced the `UNCONFIRMED_GEMINI_TASK_FN` constant with an `ARCHIVED_GEMINI_TASK_FN` guardrail). Do-not-call. |
| G | **"Validation" is a Postgres trigger, not a function call.** | No `/api/edge/validation` route. The frontend reads `case_validation_runs` via Realtime; the server does not call anything explicit for validation. |
| H | **Layer 3 FIDReC handoff = human-in-the-loop form.** *(Expanded 2026-04-21 PM late-afternoon from the morning's 4-field minimal form.)* User-entered: first name, last name, email, phone (auto-filled from Clerk, editable), `age` (int 13–120), `employment_status` (`professional` / `retiree` / `student` / `other`), two FIDReC-qualification booleans — `thirty_days_since_last_fi_reply` (checkbox Y/N), `fi_issued_final_response` (checkbox Y/N), optional `message` (≤ 500 chars). Server-captured, NEVER trusted from the client body: `user_id` (column `DEFAULT auth.uid()`), `case_id` (RLS ownership probe), `amount_lost_sgd` + `financial_institution` (snapshotted from the latest `case_extract_runs.extract_json` at insert time). One `upsert` (UNIQUE on `user_id + case_id`) into the contact-requests storage table (currently `escalation_waitlist` per IS §10.5; follow-up migration may rename to `contact_requests`) + one notification email to Dance. No payment, no Tier-2 paywall, no waitlist scoring. Full spec in IS §9.9 + §10.5. |

### 0.4 What this means for Pass 2

The Pass 2 rewrite (now in progress) applies §0.1, §0.2, §0.3 across:

- `docs/Front-to-Back-End-Integration-Summary.md` — §1 layer table, §2 edge-function index, §3 sections 3.4/3.5 (delete candidate-transactions/compute-loss contracts), §3.6 (replace gemini-task "unconfirmed" with "archived"), §3.7 (decision stays Layer 2), §9.1 constants file example.
- `docs/State-Machine-Workflow.md` — banner, R-rules (especially R9/R11), Tier-0 and Tier-1 sequence diagrams, Appendix A.
- `docs/State-Machine-Refactor-Plan.md` — banner, Slice 2 acceptance criteria (three steps only), Slice 4A acceptance criteria (two steps + conditional re-run), Slice 7 cleanup backlog (add `candidate-transactions` / `compute-loss` / `gemini-task` folder-removal tickets).

---

---

## 1. What Masha told us

Direct quotes from Masha (Russian, with short English paraphrase) — this is the source material for every reconciliation below.

| # | Topic | Masha said | Our reading |
|---|---|---|---|
| 1 | `.doc` / `.docx` / `.txt` / `.zip` uploads | "Не тестировала… не сработал `.txt`, `.zip`". | `.txt` and `.zip` are confirmed broken in `evidence_processed_v2`. `.doc` / `.docx` are **untested**. See §5 Q3. |
| 2 | `bright-function` trigger mechanism | "This is not auto triggered by DB inside the function. Something external must call it after documents are uploaded." | `evidence_processed_v2` (and its upstream counterparts) must be **explicitly invoked by the server** after each document upload. No DB-level trigger exists today. |
| 3 | When to fire `run_case_extract_v4` | "1) trigger `run_extract_run_v4` after minimum intake is complete… 2) after user confirms new evidence/answers we trigger it again… 3) trigger before downstream report/decision generation." | Extract must run **at least three times per case**: post-intake, after each gap/evidence change, and one final "freshness check" run immediately before decision/report. This matches our §8.2 D rule in the Integration Summary but adds the final pre-decision run. |
| 4 | Legacy extract versions | "Я их уже убрала из supabase, я почищу гит" | v1 / v2 / v3 have been deleted from Supabase. Masha will clean the git repo. Our Slice 7 backlog ticket collapses to "remove the folders `supabase/functions/run_case_extract_v{1,2,3}` from the repo". |
| 5 | Free-tier SRF panel | "Она там присутствует в очень урезанном виде — только даёт информацию is it bank path relevant, telco path relevant, is potentially fidrec subscriber match, potentially fidrec eligible. Нет анализа или информации on specific srf duties." | The free-tier SRF panel now reports **four binary signals** rather than the old narrative-style analysis. The state machine's R6 ("render whatever exists") still holds; no diagram change. |
| 6 | `bright-function` — old vs new | "Bright function — это старая версия? Да" | Ambiguous. Masha confirmed "yes, bright-function is the old version" in context of a question that conflated bright-function with evidence_processed_v2. But Supabase Dashboard **still lists `bright-function` as the active tier-0 narrative generator**. See §5 Q6 — the docs continue to treat `bright-function` as the live tier-0 narrative generator until the user or Masha corrects us. |
| 7 | v4 internal version string | "Есть только версия 4… но ты видимо смотришь на название версии внутри кода, а не на название самой функции… внутри самой функции она показана как v3.2555 or something like this." | The deployed folder name is `run_case_extract_v4`. The **internal source-level version string** reads `v3.2555…` and was the reason we mis-identified the live function as v3. **The folder name is the contract.** |

---

## 2. Active edge-function set (verified 2026-04-21 in Supabase Dashboard)

These are the **only seven** functions the Tier-0 + Tier-1 workflow invokes. Every other historical function is archived (§4).

| # | Folder / slug in Supabase | Dashboard label | Layer (MVP today) | Role |
|---|---|---|---|---|
| 1 | `candidate-transactions` | candidate-transactions | **NEW — not in old docs** | Runs across the case's documents to surface the transactions that are candidates for `compute-loss`. |
| 2 | `compute-loss` | compute-loss | **NEW — not in old docs** | Computes the user's actual monetary loss from the candidate transactions. Exists because real users often don't know the exact amount stolen. |
| 3 | `evidence_processed_v2` | evidence_processed_v2 | Layer 1 (Tier 0, free) | The single evidence-processing function. Can be run multiple times per case. **Not** auto-triggered by the DB — the server must call it explicitly per upload. |
| 4 | `run_case_extract_v4` | run_case_extract_v4 | Layer 1 (Tier 0, free) | The single extract function. Runs multiple times per case (see §1 row 3). **Internal version string reads `v3.2555…`** — do not be misled. |
| 5 | `run_case_decision_v1` | run_case_decision_v1 | Layer 2 today — but see §5 Q1 | Decision engine. Whether this also runs in Tier-0 is the single biggest open question. |
| 6 | `bright-function` | tier-0 narrative generator | Layer 1 (Tier 0, free) | Generates the Tier-0 narrative ("freemium report") after story analysis + evidence upload (+ decision? — §5 Q1). |
| 7 | `run_report_selfserve_v1` | run_report_selfserve_v1 | Layer 2 (Tier 1, paid) | Produces the paid self-serve report. Requires `simulation_key` on the body (MVP only; will be replaced with JWT auth before public launch). |

**Supabase base URL (for reference):** `https://ujilatkjweudsptpoqyr.supabase.co/functions/v1/<slug>`.

---

## 3. Function-by-function reconciliation

For each active function, we enumerate: (a) what changes relative to the old docs; (b) whether the payload contract is known; (c) open questions.

### 3.1 `run_case_extract_v4` (was `run_case_extract_v3` in our docs)

- **Rename.** Everywhere the three existing docs referred to `run_case_extract_v3`, replace with `run_case_extract_v4`. Done in Pass 1.
- **Payload contract.** **Assumed identical** to the v3 contract currently in Integration Summary §3.1 (`{ case_id, skip_validation? }`). Masha has not flagged a payload change; to be confirmed when the repo folder is updated to match the deployed function (she'll push this post-vacation).
- **Firing cadence.** Three mandatory call-sites per case (Masha's quote in §1 row 3):
  1. After the minimum intake is complete (institution, incident description, claim amount and date).
  2. Every time the user confirms new evidence or answers a follow-up question.
  3. One final call **before** decision/report generation, to guarantee the latest extract is fresh.
- **Open question.** Does call-site 3 imply we also re-call this from the Layer 2 / Stripe-webhook worker immediately before `run_case_decision_v1`? See §5 Q2.

### 3.2 `evidence_processed_v2`

- **No rename, no payload change.** Integration Summary §3.3 remains accurate for the payload and response shapes.
- **New warning:** `.txt` and `.zip` are confirmed **not supported** (§1 row 1). `.doc` / `.docx` are untested. The MIME whitelist in §9.6 (PDF / PNG / JPEG / DOCX) therefore carries an extra risk — see §5 Q3.
- **Not auto-triggered** by the database. The state-machine rule R11 ("server auto-re-fires extract after every successful evidence_processed_v2") is confirmed correct.

### 3.3 `candidate-transactions` **(NEW)**

- Payload contract: **unknown**. Needs an inspection of the deployed function.
- Expected trigger: after `evidence_processed_v2` completes for one or more bank-statement-style documents. See §5 Q4 for the firing cadence decision.
- Expected output: a list of transaction rows keyed to `case_id`, to be consumed by `compute-loss`.
- To be documented in Integration Summary §3 (new subsection) once payloads are confirmed.

### 3.4 `compute-loss` **(NEW)**

- Payload contract: **unknown**. Needs an inspection of the deployed function.
- Expected trigger: after `candidate-transactions` completes. Feeds the monetary total back into `cases.claim_amount` (or a new column) so the eventual report has the right number.
- To be documented in Integration Summary §3 (new subsection) once payloads are confirmed.

### 3.5 `run_case_decision_v1`

- **No rename, no payload change.** Integration Summary §3.5 remains accurate.
- **Layer assignment is the single biggest open question.** Dance's verbal workflow description puts this INSIDE the free Tier-0 flow; our current docs put it in Layer 2 only. See §5 Q1. Until resolved, treat the current Layer 2 assignment as provisional.

### 3.6 `bright-function` (tier-0 narrative generator)

- **No rename.** The Dashboard label `tier-0 narrative generator` is cosmetic; the folder slug `bright-function` is still the endpoint.
- **Trigger condition may change** depending on §5 Q1 (does decision precede it?).
- **Role clarification.** Despite Masha's "bright function — это старая версия? Да" reply (§1 row 6), the Supabase Dashboard still lists it as the active tier-0 narrative generator, and the deployed code (`supabase/functions/bright-function/index.ts`) declares itself as `run_tier0_summary_v1`. We continue to treat `bright-function` as the live Tier-0 narrative generator and flag it as §5 Q6 for final confirmation.

### 3.7 `run_report_selfserve_v1`

- **No rename, no payload change.** Integration Summary §3.6 remains accurate.
- Still requires `simulation_key` injection by the server route.

---

## 4. Archived / removed functions

The following are archived in Supabase as of 2026-04-21 and must be removed from **every** frontend call-site, constants file, and doc:

| Removed function | Where it appeared | Action taken (Pass 1) |
|---|---|---|
| `run_case_extract_v1` | `supabase/functions/` folder only | Retained in `lib/edge-functions.ts` under `LEGACY_EXTRACT_FNS` for grep audit; NOT callable. Masha to delete the folder. |
| `run_case_extract_v2` | same | same |
| `run_case_extract_v3` | `EXTRACT_FN` constant + every mention across the three docs | Constant now points at `run_case_extract_v4`; all doc references renamed. |
| `run_case_extract_v4` internal version string | `"v3.2555…"` inside the function source | **Nothing to do.** The internal semver is orthogonal to the folder name. Noted in `lib/edge-functions.ts` and §1 row 7 here. |
| `gemini-task` | Integration Summary §3.4 (marked "do not call from frontend") | **Status unconfirmed.** Pending §5 Q7. For now: no code calls it; keep the "do not call" note in the IS. |
| `backfill_embeddings_v1` | Integration Summary §3.7 (admin only) | Still documented as admin-only. Removed from `EDGE_ROUTES` since the frontend never hits it. |
| `url_catalogue` / `decision_url_inbox` | Integration Summary §3.8 (admin only) | Same as above — admin tooling, not in the MVP frontend call graph. |

---

## 5. Open structural questions — RESOLVED 2026-04-21 PM

All nine questions below are **resolved**. This section is retained as an audit trail of what we were uncertain about and how we answered. The current binding picture is in §0.

### Q1 — Does `run_case_decision_v1` run inside the free Tier-0 flow?

- **Dance's verbal workflow (2026-04-21):** "run_case_extract_v4 → evidence_processed_v2 → candidate-transactions → compute-loss → run_case_decision_v1 → bright-function → freemium Tier-0 report."
- **Current docs (Integration Summary §1, State Machine R9):** decision is Layer 2 only, fired by the Render worker after Stripe webhook.
- **If Dance is right:** decision is a free-tier function. Pass 2 must (a) move decision into Layer 1, (b) delete the R9 "decision fires post-webhook" assumption, (c) redraw Diagram 3 so decision is NOT part of the paid flow.
- **If Dance misspoke:** Keep current layering. Only `run_report_selfserve_v1` sits inside the paid flow.
- **Proposed answer (working hypothesis):** Dance is right — decision is now part of the free tier. But this is a ~30% confidence guess; **needs Masha confirmation**.
- **✅ RESOLVED 2026-04-21 PM (Masha).** Decision stays in **Layer 2 only**. Canonical sequence: Tier-0 is `evidence_processed_v2` → `run_case_extract_v4` → `bright-function`. Decision fires from the Render worker after the Stripe webhook, immediately before `run_report_selfserve_v1`. The hypothesis in §6 (old) that put decision in Tier-0 is **wrong** and has been removed from the rewritten §6.

### Q2 — Fire cadence for `run_case_extract_v4`'s "final freshness run"

Masha said extract must fire "one last time before downstream report/decision generation to confirm the latest extract is fresh". Where does that final call come from?

- Option A (matches Dance's description): the last extract run fires as part of the Tier-0 sequence **inside Layer 1**, just before `run_case_decision_v1` (assuming Q1=yes).
- Option B: the final run fires from the **Render worker** after the Stripe webhook, right before it calls decision.
- Option C: both — one inside Tier-0 before the Tier-0 narrative, another inside Layer 2 before the paid report.

**Proposed answer:** C (both), to guarantee freshness at every user-visible checkpoint. Needs confirmation.

- **✅ RESOLVED 2026-04-21 PM (Masha + Dance).** Tier-0: final freshness run fires inside Layer 1 just before `bright-function` (end of the gap loop). Tier-1: the Render worker re-runs `run_case_extract_v4` **only if** new documents or narrative were added after payment (Dance answer E). If nothing changed, the worker uses the latest existing extract and goes straight to `run_case_decision_v1`.

### Q3 — MIME whitelist in the upload UI

Masha confirmed `.txt` and `.zip` are broken; `.doc` / `.docx` are **untested**. Our current docs (IS §9.6) accept PDF / PNG / JPEG / DOCX.

- Option A (safe): collapse the whitelist to PDF / PNG / JPEG for MVP. DOCX moves to post-MVP.
- Option B (current): keep DOCX in and run a one-shot upload test to confirm it works, then decide.
- Option C: allow DOCX but surface a warning in the UI: "DOCX support is experimental — if processing fails, please convert to PDF."

**Proposed answer:** A for MVP. Matches the "no surprises for users" posture.

- **⏸ Still provisional (not explicitly re-confirmed 2026-04-21 PM).** Apply option A (PDF / PNG / JPEG only) for the MVP unless/until Masha signs off on DOCX. This is a small product decision, not a structural one.

### Q4 — Fire cadence for `candidate-transactions` and `compute-loss`

Three viable shapes (matches Q2 in the earlier question form that was skipped):

- Option A: fire both per-document after each `evidence_processed_v2` success (same pattern as the extract auto-refire, rule R11).
- Option B: fire both once per case, at the end of the evidence loop, before the decision/narrative step.
- Option C: `candidate-transactions` per-document; `compute-loss` once at the end.

**Proposed answer:** B — fire both once at the end of the evidence loop (keeps the number of edge-function calls bounded, and the "amount lost" number only needs to be right at the user-visible checkpoints: Tier-0 draft render and paid-report generation).

- **✅ RESOLVED 2026-04-21 PM (Masha + Dance answer A).** Neither function is called from the frontend. `run_case_extract_v4` does the loss math itself. `candidate-transactions` and `compute-loss` are Masha-internal fallbacks triggered from the Supabase Dashboard when v4 can't produce a loss number. **No frontend wiring, no server route, no UI.**

### Q5 — Pre-login landing-page narrative capture

Dance's description has the user recording/typing their story on the **public** landing page, then being prompted to sign in via Clerk, then having the stored transcript processed.

- Our current docs assume the user signs in first and lands on `/app/case/new`.
- Pre-login capture means: (a) we store the narrative in `localStorage` or an unauthenticated Supabase edge, (b) after Clerk auth returns, we create `cases` + `case_intake` from that stored narrative, (c) then fire extract.

**Proposed answer:** defer pre-login capture to a post-MVP marketing iteration. Keep the authenticated intake form for MVP. Dance to confirm.

- **✅ RESOLVED 2026-04-21 PM (Dance answer C — revised after Pattern C cross-check).** Pre-login narrative capture **is** in for MVP, but kept **client-side only** to preserve Slice 0 Pattern C intact. The landing page holds the narrative + transcript in `sessionStorage` (or Clerk `unsafeMetadata` once sign-up starts). No Supabase write happens before Clerk auth. On the first authenticated request post-login, the server reads the stored narrative from the request body, creates a `cases` row + `case_intake` row via `createUserClient()` (RLS `WITH CHECK (user_id = auth.uid())` fills `user_id` automatically), then the evidence upload screen opens (Dance answer D). **No schema change, no new RLS policy, no draft-token cookie, no TTL cron.** Accepted trade-off: if the browser crashes or the user switches device before completing Clerk sign-up, the narrative is lost and they retype. This can be revisited post-MVP once conversion data exists.

### Q6 — `bright-function` role finality

Masha's quick reply "Bright function — это старая версия? Да" could mean either (a) bright-function IS the old version (deprecated), or (b) bright-function was renamed from an older role it used to play (evidence processing) to its current role (tier-0 narrative generator).

- Supabase Dashboard shows it as active with the label "tier-0 narrative generator".
- The deployed code declares itself as `run_tier0_summary_v1` and upserts into `case_narratives`.
- We therefore treat interpretation (b) as correct.

**Proposed answer:** Keep `TIER0_FN = 'bright-function'`. Confirm with Masha post-vacation.

- **✅ RESOLVED 2026-04-21 PM (Masha).** `bright-function` IS the Tier-0 narrative generator — confirmed by its appearance as step 3 of the canonical Tier-0 sequence and the Dashboard label "tier-0 narrative generator". `TIER0_FN = 'bright-function'` stands. The earlier "старая версия" reply was Masha clarifying the terminology confusion, not deprecating the function.

### Q7 — `gemini-task` status

Dance's active list does not include `gemini-task`. But neither Masha nor Dance have explicitly said it's archived. Current Integration Summary §3.4 already says "do not call from frontend".

**Proposed answer:** Leave as-is in the docs (documented but not called) until Masha confirms archival.

- **✅ RESOLVED 2026-04-21 PM (Dance answer F).** `gemini-task` is **archived**. Removed from all three main docs. In `lib/edge-functions.ts` the `UNCONFIRMED_GEMINI_TASK_FN` constant is replaced with `ARCHIVED_GEMINI_TASK_FN` (for grep-visibility only) with a `@deprecated` JSDoc tag.

### Q8 — Tier-1 re-run policy after Stripe success

Dance said "we re-run all functions again in sequence and at the end we run report self-serve". Three interpretations:

- Option A: every function runs again (extract → evidence_processed_v2 for new docs → candidate-transactions → compute-loss → decision → report_selfserve).
- Option B: only the functions whose inputs could have changed (extract + any new-doc evidence runs + decision → report_selfserve).
- Option C: only `run_report_selfserve_v1` runs on Stripe success, reusing whatever the latest extract/decision is.

**Proposed answer:** B. Always re-run extract (narrative may have been edited) and decision (facts may have changed). Skip candidate-transactions / compute-loss unless new documents were uploaded in the paid layer.

- **✅ RESOLVED 2026-04-21 PM (Dance answer E).** Tighter than the proposed answer: **re-run `evidence_processed_v2` + `run_case_extract_v4` ONLY if the user added new docs or edited the narrative after paying.** If they just paid and clicked "generate report", the Render worker goes straight to `run_case_decision_v1` → `run_report_selfserve_v1` using the existing latest extract. (`candidate-transactions` / `compute-loss` never enter the picture — Q4 resolution.)

### Q9 — Layer 3 specialist screen placement

Dance said "at the end we show the screen to reach out to me and leave their details if they need help with FIDReC report". Today we model this as a **separate** Layer 3. Alternative: make it a footer section of the Layer 2 report-ready screen so the user sees it immediately after the paid report.

**Proposed answer:** Keep Layer 3 as a separate terminal node for MVP, but add a CTA link to it from the bottom of the Layer 2 report screen so the path is one click. Dance to confirm.

- **✅ RESOLVED 2026-04-21 PM (Dance answer H, morning).** Layer 3 is a contact form → writes to a `contact_requests` table + emails Dance → shows a "we'll be in touch" confirmation. No payment, no waitlist scoring, no Tier-2 paywall. Stays as a separate terminal node; the Tier-1 report screen shows a CTA at the bottom that links to it.
- **✅ EXPANDED 2026-04-21 PM late-afternoon (Dance follow-up).** The form is a **human-in-the-loop triage form** shown immediately after the Tier-1 report is generated. **User-entered:** first name, last name, email, phone (auto-filled from Clerk, editable), `age` (int 13–120), `employment_status` (`professional` / `retiree` / `student` / `other`), `thirty_days_since_last_fi_reply` (boolean), `fi_issued_final_response` (boolean), optional `message`. **Server-captured:** `user_id` (`DEFAULT auth.uid()`), `case_id` (RLS probe), `amount_lost_sgd` + `financial_institution` (snapshotted from latest `case_extract_runs.extract_json`). **Rationale:** Dance needs a one-glance triage view — who the person is, how much they lost, which FI, whether they've hit the two FIDReC eligibility gates (30-day and final-response), plus demographic signals (age + employment) that change how the specialist conversation is framed. Amount + FI are snapshotted server-side so the triage row matches what the user saw on their report and can't be tampered with client-side. One `upsert` (UNIQUE on `user_id + case_id`) so re-submits overwrite (e.g. user later ticks `fi_issued_final_response` after receiving the FI's letter). CTA on the Tier-1 report screen: *"Need help escalating to FIDReC? → Get help from a specialist"*.

---

## 6. Final end-to-end workflow (Masha + Dance confirmed 2026-04-21 PM)

This is the **binding contract** for all Pass 2 rewrites. Where this section disagrees with the old Working Hypothesis (preserved in git history), this section wins.

### 6.1 Landing → free Tier-0 freemium report

1. **Landing page (unauthenticated, client-side only).** User types or records their story in the hero prompt. The narrative + transcript live in browser state — `sessionStorage` while the user is still deciding, `unsafeMetadata` on Clerk's sign-up widget once they commit. **No Supabase write happens yet.** *(Dance answer C, revised after Pattern C cross-check 2026-04-21 PM.)*
2. **Clerk sign-in / sign-up.** User authenticates. Clerk returns a Supabase-compatible JWT (Pattern C, Slice 0 runbook). The `handle_new_user()` trigger writes `auth.users` → `profiles` atomically using the same UUID. The client then sends the stored narrative in the body of the first authenticated request, and the server uses `createUserClient()` to INSERT a `cases` row + `case_intake` row — RLS `WITH CHECK (user_id = auth.uid())` fills `user_id` automatically. No service-role write, no anonymous row, no schema migration.
3. **Evidence upload screen (post-login).** Dedicated screen asks the user to upload at least one supporting document. *(Dance answer D.)*
4. **Step 1 of Masha's sequence — `evidence_processed_v2`.** For each uploaded document the server calls `/api/edge/evidence` → `evidence_processed_v2`.
5. **Step 2 of Masha's sequence — `run_case_extract_v4` (+ gap loop).** After minimum intake is complete, the server calls `/api/edge/extract` → `run_case_extract_v4`. The function writes `case_extract_runs`; a Postgres trigger writes `case_validation_runs` with any gap questions. *(Q7 resolution: validation is a DB trigger, not a function call.)* The UI enters the gap-question loop: every gap answer re-fires extract; every new document upload fires evidence then auto-re-fires extract (R11). *(Dance answer B — gap loop stays.)* Once the user clicks "generate my free draft" (or answers/skips all gaps), a final "freshness check" extract run fires.
6. **Step 3 of Masha's sequence — `bright-function`.** Server calls `/api/edge/tier0` → `bright-function`. Writes `tier0_summary`, `tier0_evidence_checklist`, and (when applicable) the minimal `tier0_srf_signal` into `case_narratives`.
7. **Frontend renders the Tier-0 freemium report.** Reads `case_narratives` (rule R6 — render whatever exists).

### 6.2 Transition → paid Tier-1 self-serve report

8. User clicks "Buy full report". Eligibility gate RPC runs (IS §6). Stripe Checkout opens.
9. Stripe webhook lands. Handler verifies signature, upserts `case_entitlements.plan = 'self_serve_report'`, inserts a `jobs` row (status=queued), returns 200. R9 unchanged.
10. User lands back in the app on the Tier-1 upgrade screen. They are offered to **optionally** add more documents or edit their narrative before report generation. *(Dance answer E.)*
11. When the user clicks "Generate my full report", the Render worker picks up the queued `jobs` row.

### 6.3 Tier-1 processing on the Render worker

12. **Conditional re-runs.** If the user added new documents in step 10, the worker fires `evidence_processed_v2` for each new document. If the user added new documents OR edited the narrative, the worker then fires `run_case_extract_v4` to refresh the extract. **If nothing changed in step 10, both re-runs are skipped.** *(Dance answer E.)*
13. **Step 4 of Masha's sequence — `run_case_decision_v1`.** Worker calls `/api/edge/decision` → `run_case_decision_v1` using the latest extract.
14. **Step 5 of Masha's sequence — `run_report_selfserve_v1`.** Worker calls `/api/edge/report` → `run_report_selfserve_v1` with the server-only `simulation_key`. A `reports` row is written with `status = 'COMPLETED'`.
15. Frontend (Realtime subscription on `reports` filtered by `case_id`) advances to L2-ReportReady and renders the paid report.

### 6.4 Layer 3 — FIDReC handoff (human-in-the-loop)

16. At the bottom of the Tier-1 report screen, a CTA reads "Need help escalating to FIDReC? → Get help from a specialist" and routes to `/specialist`.
17. The `/specialist` screen shows a human-in-the-loop triage form. Identity (first name, last name, email, phone) is auto-filled from the Clerk profile and editable. The user then enters `age` (int 13–120), picks an `employment_status` (`professional` / `retiree` / `student` / `other`), ticks two FIDReC-qualification booleans — `thirty_days_since_last_fi_reply` and `fi_issued_final_response` — and optionally writes a short message (≤ 500 chars). A read-only context card above the form shows the snapshot values Dance will see: financial institution, reported loss in SGD, case ID. The client POST body contains **only the user-entered fields plus `case_id`** — `user_id`, `amount_lost_sgd`, and `financial_institution` are NEVER on the wire.
18. On submit, `POST /api/contact-requests` (a) verifies the Clerk session, (b) Zod-validates the body, (c) does an RLS-scoped ownership probe on `cases`, (d) reads the snapshot values from the latest `case_extract_runs.extract_json` row (fallback to `cases.claim_amount` / `cases.institution_name`; both may be null), (e) `upsert`s one row into the contact-requests storage table on the `(user_id, case_id)` unique key — so re-submits overwrite if the user later flips `fi_issued_final_response` after receiving the FI's final letter, (f) sends a notification email to Dance containing the full field set (failure non-fatal — row is source of truth). The user sees a "Thanks — we'll be in touch within 1–2 business days to help you prepare your FIDReC submission" confirmation. *(Dance answer H, expanded 2026-04-21 PM late-afternoon — see §0.3 row H + §5 Q9 resolution. Full spec in IS §9.9 + §10.5; SM R12 + Diagram 4 + Appendix B.8.)*

### 6.5 Fallback path (Masha-internal, NOT frontend)

If `run_case_extract_v4` returns without a reliable loss amount, Masha manually triggers `candidate-transactions` followed by `compute-loss` from the Supabase Dashboard. These functions write the loss amount back into the case row so a subsequent freshness-check `run_case_extract_v4` call picks it up. **The frontend has no code path that invokes either function**, no UI affordance, and no server route. *(Dance answer A / Q4 resolution.)*

---

## 7. What changed in Pass 1 (2026-04-21 AM)

Pass 1 applied the unambiguous factual updates without making any structural assumptions:

### 7.1 `lib/edge-functions.ts` (Pass 1 state — superseded by Pass 2 in §8)

- `EXTRACT_FN` renamed from `'run_case_extract_v3'` to `'run_case_extract_v4'`.
- Added `CANDIDATE_TRANSACTIONS_FN` = `'candidate-transactions'`.
- Added `COMPUTE_LOSS_FN` = `'compute-loss'`.
- Added route mappings for `/api/edge/candidate-transactions` and `/api/edge/compute-loss`.
- Added `LEGACY_EXTRACT_FNS` = `['run_case_extract_v1', 'run_case_extract_v2', 'run_case_extract_v3']` for grep auditability.
- Added `UNCONFIRMED_GEMINI_TASK_FN` = `'gemini-task'` with @deprecated JSDoc tag (pending Q7).

### 7.2 `docs/Front-to-Back-End-Integration-Summary.md`

- Banner at the top pointing to this reconciliation doc.
- Every `run_case_extract_v3` → `run_case_extract_v4`.
- §1 layer table updated with the (then-hypothesised) candidate-transactions + compute-loss in Layer 1.
- §2 edge-function index gained TBD rows for the two new functions.
- §3 payload-contract stubs for candidate-transactions / compute-loss.

### 7.3 `docs/State-Machine-Workflow.md`

- Banner at the top pointing to this reconciliation doc.
- R3 rule rewritten: "Only `run_case_extract_v4`".
- Every `run_case_extract_v3` → `run_case_extract_v4`.
- **No diagram structure changes** — left for Pass 2.

### 7.4 `docs/State-Machine-Refactor-Plan.md`

- Banner at the top pointing to this reconciliation doc.
- Every `run_case_extract_v3` → `run_case_extract_v4`.
- Slice 7 backlog: the repo-folder deletion ticket collapsed to v1/v2/v3.
- Slice 2 TODOs for two new server routes (then marked "blocked on Masha payload").

---

## 8. What changed in Pass 2 (2026-04-21 PM)

Pass 2 applies Masha's canonical sequence (§0.1), the fallback-only rule for candidate-transactions / compute-loss (§0.2), and Dance's eight structural answers (§0.3, §5 annotations). Changes:

### 8.1 `lib/edge-functions.ts` (final state)

- **Removed** `CANDIDATE_TRANSACTIONS_FN` and `COMPUTE_LOSS_FN` constants.
- **Removed** `candidateTransactions` and `computeLoss` from `EDGE_ROUTES` and `EDGE_ROUTE_TO_FN`.
- **Renamed** `UNCONFIRMED_GEMINI_TASK_FN` → `ARCHIVED_GEMINI_TASK_FN` with a `@deprecated` JSDoc tag.
- **Added** `FALLBACK_ONLY_FNS = ['candidate-transactions', 'compute-loss']` as a grep-audit constant only (never imported from application code).
- **Rewrote** the top-of-file docblock to describe the final 5-function canonical sequence (3 Tier-0 + 2 Tier-1) + the fallback-only functions + archived legacy set.
- No server routes exist for `candidate-transactions` or `compute-loss` on disk (never committed beyond the Pass 1 constants).

### 8.2 `docs/Front-to-Back-End-Integration-Summary.md`

- Banner rewritten from "reconciliation in progress — open questions block structural changes" to "Pass 2 complete — binding contract".
- §1 layer table: Layer 1 function list is now **`evidence_processed_v2`, `run_case_extract_v4`, `bright-function`**. Layer 2: **`run_case_decision_v1`, `run_report_selfserve_v1`**. No candidate-transactions / compute-loss. No "pending Q1" annotation.
- §2 edge-function index rebuilt to reflect the 5 active + 1 Tier-3 placeholder + archived set. `candidate-transactions` / `compute-loss` appear in the "No longer in the active set" sub-list with a "Masha-internal fallback only" note. `gemini-task` appears as archived. Row count: 5 active for the frontend.
- §3: deleted §3.4 candidate-transactions subsection, deleted §3.5 compute-loss subsection, converted §3.6 "`gemini-task` — Status unconfirmed" to "§3.6 `gemini-task` — Archived (do not call)". §3.7 onwards renumbered. §3.7 `run_case_decision_v1` description now states unambiguously "Layer 2 only — fires after Stripe webhook".
- §8.2 rule D (auto-re-fire extract after evidence): **unchanged**; still part of the gap loop.
- §9.1 constants-file example rewritten to match the post-Pass-2 `lib/edge-functions.ts` exactly.
- §11 glossary: removed candidate-transactions / compute-loss as "active"; added them as "fallback-only".

### 8.3 `docs/State-Machine-Workflow.md`

- Banner rewritten: "Pass 2 complete — canonical sequence applied; diagrams and R-rules updated".
- Tier-0 happy-path diagram (Diagram 1) shows: anonymous landing → Clerk login → user_id patch → evidence upload → `evidence_processed_v2` → `run_case_extract_v4` (with gap loop) → freshness check → `bright-function` → Tier-0 report render.
- Tier-1 happy-path diagram (Diagram 3) shows: Tier-0 report → "Buy full report" → Stripe → webhook queues job → Tier-1 upgrade screen (optional add-docs/edit-narrative) → Render worker → [conditional `evidence_processed_v2` + `run_case_extract_v4`] → `run_case_decision_v1` → `run_report_selfserve_v1` → L2-ReportReady → Layer 3 CTA.
- R-rules updated: R3 (only v4) unchanged; R9 (decision is Layer 2 only) **unchanged** — Q1 resolved in favour of R9; R11 (evidence auto-re-fires extract) **unchanged**; new R-rule added for the anonymous-draft user_id patch pattern; new R-rule added for Tier-1 conditional re-runs.
- Appendix A updated with the final function set.

### 8.4 `docs/State-Machine-Refactor-Plan.md`

- Banner rewritten: "Pass 2 complete — slice acceptance criteria updated".
- Slice 2 acceptance criteria narrowed to 3 server routes (`/api/edge/evidence`, `/api/edge/extract`, `/api/edge/tier0`). No candidate-transactions or compute-loss routes.
- Slice 4A acceptance criteria: Render worker does the conditional-rerun logic + decision + report.
- Slice 7 cleanup backlog gains tickets to remove `supabase/functions/candidate-transactions`, `supabase/functions/compute-loss`, `supabase/functions/gemini-task` folders from the repo (Masha-owned, same batch as the v1/v2/v3 cleanup).
- Added a new Slice (or engineering note) covering the anonymous draft `cases` row + RLS carve-out + user_id patch flow.

### 8.5 Code comment cleanup

- `components/state-machine/layer1/intake-form.tsx`, `components/state-machine/layer1/gap-question-panel.tsx`, `app/api/edge/evidence/route.ts`, `lib/types/extract.ts` — stale `run_case_extract_v3` references updated to `v4`.

### 8.6 Deferred / follow-up items

- Engineering-ticket: implement the **client-side-only pre-login narrative capture** (Dance answer C, revised). Needs a `sessionStorage` + Clerk `unsafeMetadata` read on the first authenticated page load, a server route that accepts `{ narrative, transcript }` in the body and writes `cases` + `case_intake` via `createUserClient()`. **No RLS change, no new cron, no schema migration** — it's a pure application-layer concern. Cross-reference: does NOT conflict with Slice 0 runbook Step 3.3 ("all `cases` inserts use `createUserClient()` with `auth.uid()`").
- Engineering-ticket: implement the Layer 3 **human-in-the-loop form** (identity auto-filled from Clerk + `age` + `employment_status` + `thirty_days_since_last_fi_reply` + `fi_issued_final_response` + optional `message`; read-only context card showing snapshot `amount_lost_sgd` + `financial_institution`) + the expanded contact-requests storage table schema (per IS §10.5 — includes `age` int CHECK 13..120, `employment_status` text CHECK enum, both FIDReC booleans NOT NULL, `amount_lost_sgd` numeric nullable, `financial_institution` text nullable, `message` text optional, UNIQUE on `user_id + case_id`) + the `POST /api/contact-requests` route (Clerk auth + Zod validation + RLS ownership probe + latest-extract snapshot read + `upsert` + notification email to Dance). Reference implementation sketch in IS §10.5. Storage table stays `escalation_waitlist` short-term; optional follow-up migration renames to `contact_requests`.
- Follow-up with Masha on Q3 (DOCX MIME whitelist) — apply option A (drop DOCX for MVP) unless Masha overrides.
- Remove the "Pass 2 complete" banners from the three existing docs once this reconciliation is fully absorbed into the team's working model (Dance + Elena).
