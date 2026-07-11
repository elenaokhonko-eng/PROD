# Front-to-Back End Integration Summary

> ✅ **2026-04-21 PM — Masha feedback reconciliation complete + Layer 3 human-in-the-loop refinement.** Masha confirmed the canonical 5-function sequence (3 Tier-0 + 2 Tier-1). `candidate-transactions` and `compute-loss` are **Masha-internal fallbacks only** (invoked from the Supabase Dashboard when `run_case_extract_v4` can't compute the loss number) — the frontend does NOT call them. `gemini-task` is **archived**. Legacy `run_case_extract_v1` / `_v2` / `_v3` are **archived** in Supabase; repo-folder deletion pending Masha. **Layer 3 (late-afternoon 2026-04-21 PM refinement):** the terminal contact form shown right after the Tier-1 report now also captures **age**, **employment status** (professional / retiree / student / other), and **two FIDReC-qualification checkboxes** (≥ 30 days since last FI reply? FI issued final response?). The server snapshots `amount_lost_sgd` + `financial_institution` from the latest `case_extract_runs` row at insert time, so Dance's triage view always matches the number the user saw. See §9.9 + §10.5. The binding contract is [`2026-04-21-Masha-Feedback-Reconciliation.md`](./2026-04-21-Masha-Feedback-Reconciliation.md) §0 (canonical sequence) and §6 (end-to-end workflow). This Integration Summary has been rewritten to match.
> ✅ **2026-05-04 — Slice 5 wiring landed on `Version-2.0-Refactor`.** Dashboard is driven by `useStateMachine()` + Slice 4 hooks. Contact path is `POST /api/contact-requests` only (no edge function). Bootstrap is `POST /api/cases/bootstrap`. Legacy waitlist route/page removed. Run [Test-Plan.md](./Test-Plan.md) §5 before sign-off.
> ✅ **2026-04-26 / 2026-05-02 updates.** Layer 3 and Tier 2 now refer to the same post-Tier-1 surface: FIDReC handoff form plus specialist consult/case-pack commerce, with the persistent WhatsApp `wa.me` widget kept in the root layout and no duplicate global widget. The contact form path still has **no edge function**. Structured validation gaps now use `v_case_validation_gap_items` as the preferred UI source with `questions_to_user` fallback (§4.5). The quick QA checklist is in [`Test-Plan.md`](./Test-Plan.md).

**Purpose.** This document is the single source of truth for the frontend (Elena) on how to call Masha's Supabase backend. It enumerates **every Edge Function the app must invoke**, the **exact JSON payload** each function expects, the **response shape** it returns, the **frontend layer (1 / 2 / 3) that triggers it**, and the **tables the UI must read back** to render state.

It is intentionally written so it can feed directly into a follow-up **State Machine / Workflow Document** (e.g. `User clicks "Get my free draft" (Layer 1) → frontend calls bright-function → poll case_narratives → render Tier-0 draft screen`).

**Test plan.** The standalone execution checklist lives in [`Test-Plan.md`](./Test-Plan.md). Keep it aligned with §4.5, §8, §9, and the state-machine Appendix B walkthrough.

**Scope and source of truth.**

- Aligned to the wiki pages in `docs/.wiki-import/` and `docs/Project Documentation` (synced 2026-04-19).
- Cross-checked against the deployed function folders in `supabase/functions/` of this repo.
- Schema authority: `supabase/migrations/20260314055326_remote_schema.sql` and follow-on `20260419140000_get_case_eligibility_self_serve.sql`.
- Where the wiki uses informal names (e.g. "T-zero narrative generator"), this document uses the **deployed function folder name** (e.g. `bright-function`).

**Conventions.**

- All edge function calls are **HTTPS POST** unless the row labelled "Method" says otherwise.
- All payloads are JSON (`Content-Type: application/json`).
- Auth model varies per function — see **Auth** column. Most are documented as "internal only" today; the frontend should call them through a thin Next.js Route Handler / server action that holds the service-role key, **not** by exposing the function directly to the browser.
- "Layer" in this document refers to the **frontend product layer** the user is in when the call is triggered. Layers 1 and 2 map 1:1 to the current backend tiers and entitlement values in `user_entitlements` / `case_entitlements`; Layer 3 is the post-Tier-1 / Tier-2 surface:
  - **Layer 1 = Tier 0 = `free`** (everything pre-payment: Tier-0 freemium report)
  - **Layer 2 = Tier 1 = `self_serve_report`** (paid self-serve FIDReC report)
  - **Layer 3 = Tier 2 post-report surface** — human-in-the-loop FIDReC contact form plus specialist consult / case-pack commerce. The contact form has no edge function and writes to the contact-requests storage table + notification email to Dance. The persistent WhatsApp link is a third-party `wa.me` entry point in the root layout. Slice 8 adds SGD 99 / SGD 800 Stripe checkouts on the same surface (§10.6).

---

## 1. Frontend layers ↔ backend tiers (terminology bridge)

| Frontend layer | Backend tier | `plan` value | Paid? | What the user is doing | Edge functions invoked from this layer |
|---|---|---|---|---|---|
| **Layer 1 — Free intake + Tier-0 draft** | **Tier 0** | `free` | Free | (a) Pre-login: typing/recording their story on the public landing page (client-side only, no Supabase write); (b) post-Clerk-login: the server materialises the case from the client-held narrative; (c) uploading evidence; (d) iterating gap-question loop; (e) reviewing the free Tier-0 draft (summary + evidence checklist + minimal SRF signal). | **Three functions, in this order:** `evidence_processed_v2` → `run_case_extract_v4` (fires multiple times through the gap loop) → `bright-function`. |
| **Layer 2 — Paid Self-Serve Report** | **Tier 1** | `self_serve_report` | Paid | Paying via Stripe; (optionally) adding more documents or editing the narrative; reviewing the decision; generating and viewing/downloading the formal complaint report. | **Two functions, in this order (on the Render worker):** `run_case_decision_v1` → `run_report_selfserve_v1`. Conditional re-runs of `evidence_processed_v2` + `run_case_extract_v4` happen **only** if the user added new documents or edited the narrative in the Tier-1 upgrade screen. All gated by `get_case_eligibility` RPC. |
| **Layer 3 / Tier 2 — FIDReC handoff + specialist commerce** | **Tier 2 surface** | Contact form has no entitlement; paid add-on plan names are finalized in Stripe metadata / Slice 8 | Free contact + optional paid add-ons | After the Tier-1 self-serve report, the user can submit the FIDReC handoff form, use the persistent WhatsApp link, and, after Slice 8, buy specialist consult / case-pack prep. | **No edge function for the contact form.** Server snapshots `user_id`, `case_id`, `amount_lost_sgd`, `financial_institution`; user supplies identity, demographics, qualification booleans, optional message. Writes to contact-requests storage and emails Dance. WhatsApp is third-party `wa.me`; paid add-ons reuse Stripe checkout/webhook patterns (§10.6). |

**Canonical happy-path sequence (Masha-confirmed 2026-04-21 PM).**

**Tier-0 (free) — 3 functions:**

1. **`evidence_processed_v2`** — fires per uploaded document on the post-login "upload your evidence" screen. Classifies, verifies, chunks, extracts transactions. **Not** auto-triggered by the DB — the server must call it explicitly per upload.
2. **`run_case_extract_v4`** — structured extraction + **loss calculation** (v4 now does the math itself; the old `candidate-transactions` + `compute-loss` split became Masha-internal fallbacks, see §2 "No longer in the active set"). Fires multiple times per case through the **gap-question loop**: after initial intake, after each gap answer, after each new document upload, and once more as a freshness-check pass right before `bright-function`. "Validation" is a Postgres trigger on `case_extract_runs` — **not** a separate function call.
3. **`bright-function`** (Dashboard label: "tier-0 narrative generator") — turns case + intake + processed evidence + latest extract into the user-readable Tier-0 narrative (`tier0_summary` + `tier0_evidence_checklist`, plus the minimal `tier0_srf_signal` when valid). Fires **once** after the gap loop has settled.

**Tier-1 (paid, Render worker after Stripe webhook) — 2 functions:**

4. **`run_case_decision_v1`** — decision engine. Runs on the latest extract. Conditional upstream re-runs (`evidence_processed_v2` per new document, `run_case_extract_v4` if anything changed) fire first **only** if the user added new documents or edited the narrative on the Tier-1 upgrade screen.
5. **`run_report_selfserve_v1`** — produces the paid self-serve report. Requires the server-only `simulation_key` on the body.

Layer 2 unlocks only after Stripe success upgrades the case to `plan = 'self_serve_report'` and `get_case_eligibility(case_id).eligible_actions.run_report_selfserve === true`.

---

## 2. Edge function index (at a glance)

**The five frontend-invoked edge functions** (Masha-confirmed 2026-04-21 PM):

| # | Function (deployed folder name) | Method | Layer (= Tier) | Triggered by | Auth model today |
|---|---|---|---|---|---|
| 1 | `evidence_processed_v2` | `POST` | **Layer 1 (Tier 0, free)** | Each document upload on the post-login evidence screen. Also re-runs in Tier-1 when the user uploads more documents after paying. | None enforced inside function — service role used. **Wrap behind server route.** |
| 2 | `run_case_extract_v4` | `POST` (also `GET` healthcheck) | **Layer 1 (Tier 0, free)** — fires multiple times through the gap-question loop, plus a final freshness-check pass before `bright-function`. Also re-runs in Tier-1 if the user edited narrative or added documents. | Server-side after minimum intake is complete; re-fires on every gap-question answer, on every new `evidence_processed_v2` success (rule R11 in SM), and once more as a freshness check before step 3. | None enforced inside function — service role used. **Wrap behind server route.** |
| 3 | `bright-function` (Dashboard label: "tier-0 narrative generator"; source declares itself `run_tier0_summary_v1`) | `POST` | **Layer 1 (Tier 0, free)** | Fires **once** after the gap loop settles (user clicks "generate my free draft" or answers/skips all gaps). | None enforced inside function — service role used. **Wrap behind server route.** |
| 4 | `run_case_decision_v1` | `POST` | **Layer 2 (Tier 1, paid)** — runs on the Render worker after Stripe webhook, immediately before step 5. | Stripe success → webhook queues a `jobs` row → Render worker runs conditional upstream re-runs (steps 1 + 2 if new docs/narrative) then calls decision. | None enforced inside function — service role used. **Wrap behind server route (called by Render worker).** |
| 5 | `run_report_selfserve_v1` | `POST` | **Layer 2 (Tier 1, paid Self-Serve Report)** | Render worker calls it immediately after step 4 succeeds. | **`simulation_key` in body** vs env `SIMULATION_KEY` (no JWT). MVP only. **Server route must inject the key.** |

**Layer 3 / Tier 2** has no Supabase edge function for the contact form. It uses `/api/contact-requests` for the handoff, the root-layout `wa.me` link for WhatsApp, and, after Slice 8, Stripe routes for specialist add-ons. See §9.9 and §10.6.

**No longer in the active set** (2026-04-21 — do NOT call from the frontend — see reconciliation doc §0.2, §4):

- **`candidate-transactions`** — **Masha-internal fallback only.** Previously hypothesised as a Layer 1 function (Pass 1 of this doc listed it as active). Masha confirmed 2026-04-21 PM that `run_case_extract_v4` now does the loss calculation itself; `candidate-transactions` is only invoked from the Supabase Dashboard by Masha when v4 fails to compute the loss correctly. No server route, no client hook, no UI affordance. Tracked in `lib/edge-functions.ts` under `FALLBACK_ONLY_FNS` for grep-visibility only.
- **`compute-loss`** — **Masha-internal fallback only** (same rationale as `candidate-transactions`). Fires from the Supabase Dashboard after `candidate-transactions` when the v4 loss math fails.
- **`gemini-task`** — **archived** (Dance decision 2026-04-21 PM). Previously documented here as "do not call alongside `evidence_processed_v2`"; now formally out of the active set. Tracked in `lib/edge-functions.ts` as `ARCHIVED_GEMINI_TASK_FN` with a `@deprecated` JSDoc tag for grep-visibility only.
- **`backfill_embeddings_v1`** — admin tooling only (Masha cron). Not in the frontend call graph.
- **`decision_url_inbox`** (deployed as `url_catalogue`) — admin tooling only. Not in the frontend call graph.

**Archived as of 2026-04-21** (confirmed with Masha — see reconciliation doc §4): `run_case_extract_v1`, `run_case_extract_v2`, `run_case_extract_v3`. **Standardise on v4.** The v4 folder is the only live extract function, even though its internal source-level version string still reads `v3.2555…` — do not let that mislead you; the folder name is the contract.

The Postgres RPC **`get_case_eligibility(p_case_id)`** is also called from the frontend (via `supabase.rpc(...)`) as a **gate** before showing the "Generate report" button. It is not an edge function but is part of the integration contract — see §6.

---

## 3. Edge function contracts (one section per function)

Each section follows the same template:
- **Layer** + trigger
- **Endpoint**
- **Request payload** (with field-by-field notes)
- **Success response**
- **Error response**
- **What it writes to the DB** (so the frontend knows where to read back)
- **What the frontend reads back to update the UI**

---

### 3.1 `run_case_extract_v4` — Structured extraction (Layer 1, Tier 0)

**Layer:** **Layer 1 (Tier 0, free)** — both the first call after submission and every re-run inside the free intake/gap loop.

**User action that triggers it:**
- First call: User clicks "Submit" on the initial intake form (after frontend has inserted a `cases` row + first `case_intake` row).
- Re-run: User clicks "Save answer" on a gap-question (frontend appends a new `case_intake` row first), or finishes uploading + processing a new document.

**Endpoint (deployed):** `POST {SUPABASE_URL}/functions/v1/run_case_extract_v4`
**Healthcheck:** `GET` same URL (returns `{ ok, version, request_id }`).

**Request payload:**

```json
{
  "case_id": "uuid",
  "skip_validation": false
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `case_id` | yes | — | UUID of the row in `cases`. **Must already exist before calling.** |
| `skip_validation` | no | `false` | `false` ⇒ also invoke `run_validation_v1` RPC and return its run id. Frontend should leave this `false` unless writing tests. |

**Success response (validation ran):**

```json
{
  "ok": true,
  "version": "run_case_extract_v4::v3.2555…::<exact-string-to-be-confirmed-post-Masha-vacation>",
  "request_id": "uuid",
  "stage": "10_rpc_ok",
  "extract_run": { "id": "uuid", "case_id": "uuid" },
  "validation_run_id": "uuid",
  "rpc_error": null,
  "evidence_docs_used": ["uuid", "..."],
  "server_computed": {
    "institution_name_guess": "DBS/POSB",
    "reported_loss": { "amount": 5000, "currency": "SGD", "source": "case_claim_amount" }
  },
  "debug_counts": { "all_unique_docs": 8, "prompt_docs": 6 }
}
```

**Other success variants:**
- *Validation skipped:* same shape but `validation_run_id: null` and a warning string.
- *Validation RPC failed but extraction succeeded:* `ok: true`, `validation_run_id: null`, `rpc_error: "..."`.

**Error response:** HTTP `500` with `{ ok: false, version, request_id, stage, error }`.

**What it writes:**
- **INSERT** into `case_extract_runs` — new row with `case_id`, `extract_json`, `missing_fields`, `model_name`, `prompt_version`, `intake_id`. **No `force` flag exists**; every successful call is appended.
- **INSERT** into `case_validation_runs` (via `run_validation_v1`) when `skip_validation: false` — at most one row per `extract_run_id` (`UNIQUE` constraint).

**What the frontend reads back to render the UI:**
- `case_extract_runs` row identified by the returned `extract_run.id`:
  - `extract_json` — render to drive the gap questionnaire (timeline, case_meta, customer_actions, institution_actions, losses, evidence_status).
  - `missing_fields` — array of explicitly-missing required fields (`incident_date`, `reported_loss.amount`, `case_meta.institution_name`).
- `case_validation_runs` selected by `validation_run_id` from `get_case_eligibility`:
  - Parent state: `status`, `missing_fields`, `ambiguities`, `questions_to_user`, `validation_summary`, `is_valid`, `error_message`.
- `v_case_validation_gap_items` selected by the same `validation_run_id`, ordered by `sort_order`:
  - Preferred ordered UI gaps: `field_key`, `question_text`, `expected_answer_type`, `answer_options`, `severity`, `help_text`.
  - Fallback to parent `questions_to_user` only when the view returns zero rows.

**Latency expectation:** seconds (one OpenAI call + optional retry + one RPC). Show a loading spinner; do not block other UI.

**Idempotency:** None. Each call appends. Frontend must avoid double-firing (e.g. disable the submit button until response).

---

### 3.2 `bright-function` — Tier-0 narrative + evidence checklist (Layer 1, Tier 0)

**Function name nuance.** The wiki page is titled **"Tier-0 narrative generator"** and the source declares the function as `run_tier0_summary_v1`. **The deployed Supabase function folder is `bright-function`** — that is the name the frontend invokes.

**Layer:** **Layer 1 (Tier 0, free)** — this is the function that produces the **free Tier-0 draft** the user sees before paying.

**User action that triggers it:**
- Frontend reaches the Layer 1 "Free Draft" view after extraction + at least one round of evidence processing has completed (typically called once automatically when the user lands on the Tier-0 draft screen). Can be re-fired by an explicit "Refresh draft" button.

**Endpoint (deployed):** `POST {SUPABASE_URL}/functions/v1/bright-function`

**Request payload:**

```json
{
  "case_id": "uuid",
  "prompt_version": "v0.1"
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `case_id` | yes | — | UUID. Function reads the case + latest `case_intake` + latest `timeline_raw` narrative. |
| `prompt_version` | no | `"v0.1"` | Used to build the `source_ref` (`"tier0:v0.1"`). Re-using the same `prompt_version` for the same `(case_id, narrative_type)` will **upsert** the narrative row instead of duplicating it. |

**Success response:**

```json
{
  "ok": true,
  "case_id": "uuid",
  "source_ref": "tier0:v0.1"
}
```

> The function returns only the metadata. The actual narrative text lives in `case_narratives` and the frontend reads it back from there.

**Error response:**
- `400` if `case_id` missing: `{ ok: false, error: "..." }`.
- `500` on any other failure: `{ ok: false, error: "..." }`.

**What it writes:**
- **UPSERT** into `case_narratives` keyed on `(case_id, narrative_type, source_ref)`:
  - One row with `narrative_type = "tier0_summary"`, `title = "Incident summary (Tier-0)"`, `text_content` = LLM-generated chronological summary.
  - One row with `narrative_type = "tier0_evidence_checklist"`, `title = "Evidence checklist (Tier-0)"`, `text_content` = recommended evidence to upload.
  - When SRF/telco signals are valid, may also write `narrative_type = "tier0_srf_signal"` (per the Frontend Integration Handover wiki — note: the source code in `bright-function` today writes the first two reliably; treat SRF as best-effort until verified in a deployed run).
- Both rows are written with `version = 1`, `audience = "user"`, `intake_id` from latest intake, `language` from intake or `"en"`.

**What the frontend reads back to render the UI:**

```sql
-- Pseudo; use supabase-js
SELECT narrative_type, title, text_content
FROM case_narratives
WHERE case_id = :case_id
  AND narrative_type IN ('tier0_summary', 'tier0_evidence_checklist', 'tier0_srf_signal')
ORDER BY narrative_type;
```

Render:
- `tier0_summary` → main "Your story so far" panel.
- `tier0_evidence_checklist` → list of evidence prompts that link to the upload UI.
- `tier0_srf_signal` (when present) → labelled **"Preliminary signal — informational only, not a final eligibility decision"**.

**Latency expectation:** seconds (one OpenAI call). Show a loading spinner.

**Idempotency:** Soft — same `(case_id, narrative_type, source_ref)` is updated in place via update-then-insert (not fully atomic under concurrency). Avoid firing twice in parallel.

---

### 3.3 `evidence_processed_v2` — Document parse / classify / verify (Layer 1, Tier 0)

**Layer:** **Layer 1 (Tier 0, free).** Per Masha's handover ("move evidence upload early"), evidence collection happens **before** payment so the free Tier-0 draft can lean on real documents.

**User action that triggers it:**
- User uploads a document on the evidence screen. The app calls **`POST /api/evidence/upload`**, which uploads the blob to Supabase Storage and **`INSERT`s `case_documents`** (declared `document_type`, `storage_bucket`, `storage_path`, `processing_status: 'pending'` — IS §4.2), **then** calls this function with `{ document_id }`.
- "Re-process my evidence" button — call with `case_id` (batch mode).

**Endpoint (deployed):** `POST {SUPABASE_URL}/functions/v1/evidence_processed_v2`

**Edge secrets / behaviour (repo `supabase/functions/evidence_processed_v2`):**
- **`GEMINI_API_KEY`** — required (same as today).
- **`EVIDENCE_GEMINI_MODEL`** — optional. Defaults to **`gemini-2.5-flash`** (was `gemini-3-pro-preview`). Set in Supabase Dashboard → Project Settings → Edge Functions secrets if you need another model id (e.g. `gemini-1.5-flash`).
- **Rate limits:** `generateContent` is wrapped with retries on HTTP **429**, **503**, and JSON **`RESOURCE_EXHAUSTED`** (initial delay 6.5s, ×1.5 backoff, 3 retries = 4 attempts total). Logs: `[evidence_processed_v2] Gemini overloaded …`.

**Request payload — single-document mode (preferred per upload):**

```json
{
  "document_id": "uuid",
  "force": false
}
```

**Request payload — case batch mode:**

```json
{
  "case_id": "uuid",
  "force": false,
  "continue_on_error": true,
  "max_docs": 100,
  "reprocess_errors_only": false
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `document_id` | one of the two | — | UUID of the row in `case_documents`. Single-document mode. |
| `case_id` | one of the two | — | UUID of the case. Triggers batch mode. |
| `force` | no | `false` | `true` ⇒ re-run Gemini even if a content row exists for the same `(document_id, model, prompt_version, pipeline_version)`. |
| `continue_on_error` | no (batch) | `true` | Continue processing remaining docs after a failure. |
| `max_docs` | no (batch) | `100` | Range `1–500`. |
| `reprocess_errors_only` | no (batch) | `false` | `true` ⇒ only target documents currently in `failed`/error state. |

**Success response — single-document:**

```json
{
  "ok": true,
  "requestId": "uuid",
  "mode": "single",
  "result": {
    "ok": true,
    "document_id": "uuid",
    "content_id": "uuid",
    "gemini_ran": true,
    "mime_used": "application/pdf",
    "predicted_document_type": "BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS",
    "duty_category": "GENERAL",
    "tier_flags": { "critical": true, "escalation_grade": false },
    "verification_status": "accepted",
    "chunks_created": 8,
    "transactions_extracted": 12
  }
}
```

**Success response — batch:**

```json
{
  "ok": true,
  "requestId": "uuid",
  "mode": "case",
  "case_id": "uuid",
  "listed": 5,
  "selected": 3,
  "failed": 0,
  "results": [
    { "ok": true, "document_id": "uuid", "content_id": "uuid", "predicted_document_type": "POLICE_REPORT_OF_FRAUD_SCAM" }
  ]
}
```

**Error response:** HTTP `500` JSON with error message; per-document errors are also reflected on the `case_documents.processing_error` and `processing_status = "failed"` columns.

**What it writes:**
- **`case_documents`** updates: `processing_status` (`parsing` → `verifying` → `chunking` → `extracting` → `ready` | `failed`), `processing_error`, `is_processed`, `content_latest_id`, `verified_document_type`, `verification_status` (`accepted` | `rejected` | `needs_review`), `verification_confidence`.
- **`case_documents_content`** insert: parsed text + `content_json`, `pipeline_version`, `model`, `prompt_version`, `parse_status`.
- **`case_document_verifications`** insert: declared vs predicted type, confidence, `decision`, reason, evidence spans.
- **`case_document_chunks`** inserts: paragraph chunks (~1100 chars) with metadata; `UNIQUE (content_id, chunk_index)`.
- **`case_document_extractions`** insert(s): always one `doc_summary_v3` row; one `transactions_v1` row when transactions were detected.

**What the frontend reads back to render the UI:**

Recommended single-query read:

```sql
SELECT *
FROM case_documents_enriched
WHERE case_id = :case_id;
```

Render per document:
- Row in `case_documents`: badge for `verification_status`, percentage from `verification_confidence`, label from `verified_document_type`. If `processing_status = "failed"`, show retry CTA.
- Row(s) in `case_document_extractions` via the enriched view: `extracted_json` (e.g. transactions table), `extracted_text` (preview), `extraction_confidence`, `verification_decision`, `verification_reason`, `verification_spans` (page-aware quoted snippets to show in document viewer).

**Behaviour rules:**
- If `verification_status = 'rejected'` → show "We don't think this matches the type you selected — please re-upload or change the type" CTA.
- If `verification_status = 'needs_review'` → show "We're not sure — please confirm" CTA.
- After processing a document, the frontend should **also re-run `run_case_extract_v4`** so the new evidence is incorporated.

**Latency expectation:** seconds per document (Gemini call + chunking). For batch, scales linearly. The frontend should show per-document spinners using the `processing_status` column (poll or subscribe via Realtime).

**Idempotency:** Built-in — re-runs reuse the prior content row when `(document_id, model, prompt_version, pipeline_version)` matches and `force = false`. Safe to retry.

**Plain-text caveat:** `.txt` uploads are not first-class today (MIME sniff defaults unknown to `image/jpeg` for Gemini). Prefer PDF/PNG/JPEG until extended.

---

### 3.4 `run_case_decision_v1` — Decision engine (Layer 2, Tier 1)

**Layer:** **Layer 2 (Tier 1, paid Self-Serve Report)** — server-side only, invoked by the **Render worker** after the Stripe webhook upgrades the case to `plan = 'self_serve_report'`. The user does not trigger it directly; the worker runs conditional upstream re-runs (evidence + extract, if the user added documents or edited narrative on the Tier-1 upgrade screen) and then calls decision. The 2026-04-21 PM reconciliation confirmed decision is **Layer 2 only** — it does NOT run in Tier-0.

**User action that triggers it:**
- Stripe webhook → server upgrades the case to `self_serve_report` → server route then calls `run_case_decision_v1` → on success calls `run_report_selfserve_v1`. The frontend simply shows progressive states ("Analysing case…" → "Drafting report…" → "Done").
- Optional explicit "Re-evaluate" button (admin-flagged) when `force = true` is required.

**Endpoint (deployed):** `POST {SUPABASE_URL}/functions/v1/run_case_decision_v1`

**Request payload:**

```json
{
  "case_id": "uuid",
  "force": false,
  "top_k_clauses": 10,
  "top_k_decisions": 10,
  "clause_similarity_threshold": 0.12,
  "prompt_version": "decision_v1.2_spans_doc_types"
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `case_id` | yes | — | UUID. Function loads latest `case_extract_runs` for the case (returns `404` if none). |
| `force` | no | `false` | `false` ⇒ if a decision already exists for `(case_id, extract_run_id)` it is **reused** (returns the existing row). `true` ⇒ regenerate and update in place. |
| `top_k_clauses` | no | `10` | Range `1–20`. Regulatory clause matches retrieved via `match_regulatory_clauses_threshold`. |
| `top_k_decisions` | no | `10` | Range `1–20`. Public decisions retrieved via `match_public_decisions`. |
| `clause_similarity_threshold` | no | `0.12` | Range `0–1`. |
| `prompt_version` | no | `"decision_v1.2_spans_doc_types"` | Stored on the decision run row. |

**Success response — reused existing decision (`force: false` and a row already exists):**

```json
{
  "ok": true,
  "reused": true,
  "decision_run_id": "uuid",
  "case_id": "uuid",
  "extract_run_id": "uuid",
  "eligibility_status": "medium",
  "strength_score_value": 75,
  "decision_json": { "...": "case_decision_v1 schema" }
}
```

**Success response — newly generated or force-updated:**

```json
{
  "ok": true,
  "reused": false,
  "updated_existing": false,
  "decision_run_id": "uuid",
  "case_id": "uuid",
  "extract_run_id": "uuid",
  "eligibility_status": "medium",
  "strength_score_value": 75,
  "decision_json": {
    "decision_version": "case_decision_v1",
    "case_id": "uuid",
    "generated_at": "2026-03-21T00:00:00.000Z",
    "summary": "...",
    "eligibility": { "status": "medium", "score": 75, "rationale": "..." },
    "critical_flags": [],
    "gaps": [],
    "recommended_actions": [],
    "references": { "regulatory_clauses": [], "public_decisions": [], "evidence": [] },
    "diagnostics": { "assumptions": [], "limits": [] }
  },
  "debug": {
    "clause_threshold": 0.12,
    "retrieved_clause_count": 10,
    "retrieved_decision_count": 10,
    "top_clause_similarity": [0.71, 0.69],
    "top_decision_similarity": [0.65, 0.62]
  }
}
```

**Error responses:**
- `405` for non-POST.
- `404` if no `case_extract_runs` row exists for the case → frontend must run extraction first.
- `500` plain text with error name + message + stack trace.

**What it writes:**
- **`case_decision_runs`** insert (or update when `force = true` and the `(case_id, extract_run_id)` row exists — partial unique index enforces this): `decision_json`, `eligibility_status` (low/medium/high — server-derived from clamped score), `strength_score_value` (0–100, server-clamped), `model_name`, `prompt_version`, `extract_run_id`, `created_at`.

**What the frontend reads back to render the UI:**
- `case_decision_runs` row identified by `decision_run_id` (or via SQL helper `get_latest_decision_run(:case_id)`):
  - `eligibility_status` — band badge (low/medium/high).
  - `strength_score_value` — score gauge.
  - `decision_json.summary`, `eligibility.rationale` — narrative panels.
  - `decision_json.critical_flags`, `gaps`, `recommended_actions`, `references` — populate "Why this score" / "Next steps" / "Citations" panels.

**Latency expectation:** ~5–15 seconds (one embedding call + two RPC retrievals + one structured-output OpenAI call). Show a multi-step progress indicator.

**Idempotency:** Strong — `(case_id, extract_run_id)` is a partial unique key. Re-runs without `force` return the existing row. Safe to retry.

---

### 3.5 `run_report_selfserve_v1` — Generate the paid self-serve report (Layer 2, Tier 1)

**Layer:** **Layer 2 (Tier 1, paid Self-Serve Report).** This is the function that actually produces the paid deliverable.

**User action that triggers it:**
- After Stripe success and entitlement upgrade, the frontend (via a server route holding `SIMULATION_KEY`) calls this function. UX-wise the user clicks "Generate my report" or simply reaches the post-payment screen and the server kicks it off.
- The frontend **must first** check `supabase.rpc('get_case_eligibility', { p_case_id: caseId })` and only proceed when `eligible_actions.run_report_selfserve === true`. See §6.

**Endpoint (deployed):** `POST {SUPABASE_URL}/functions/v1/run_report_selfserve_v1`

**Request payload:**

```json
{
  "case_id": "uuid",
  "force": false,
  "prompt_version": "selfserve_v1.6_exec_summary_normalize_and_checklist_fix",
  "simulation_key": "secret",
  "user_id": "uuid-or-null"
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `case_id` | yes | — | UUID. |
| `force` | no | `false` | `false` ⇒ return the latest existing `reports` row for the case if it has `report_json`. `true` ⇒ always insert a new report row (append-only when forced). |
| `prompt_version` | no | `"selfserve_v1.6_exec_summary_normalize_and_checklist_fix"` | Returned in `debug`; not stored on the report row. |
| `simulation_key` | **yes** | — | Must match env `SIMULATION_KEY`. **MVP only — replace with JWT auth before public launch.** Server route must inject this; never expose to the browser. |
| `user_id` | no | `null` | Written into the inserted `reports` row when provided. |

**Success response — reused existing report:**

```json
{
  "ok": true,
  "reused": true,
  "report_id": "uuid",
  "case_id": "uuid",
  "user_id": "uuid",
  "status": "COMPLETED",
  "report_json": { "...": "self_serve_report_v1 schema" }
}
```

**Success response — newly generated:**

```json
{
  "ok": true,
  "reused": false,
  "report_id": "uuid",
  "case_id": "uuid",
  "user_id": "uuid",
  "status": "COMPLETED",
  "report_json": {
    "report_version": "self_serve_report_v1",
    "case_id": "uuid",
    "generated_at": "2026-03-21T00:00:00.000Z",
    "title": "Complaint Report",
    "executive_summary": "...",
    "timeline": [{ "at": "...", "label": "...", "detail": "..." }],
    "scam_nature": "Phishing scam",
    "disputed_transactions": [
      { "label": "...", "amount": 5000, "currency": "SGD", "authorised": "unclear", "notes": "..." }
    ],
    "totals": { "total_amount": 5000, "currency": "SGD" },
    "key_responsibility_points": ["..."],
    "requested_resolution": ["..."],
    "evidence_checklist": ["..."],
    "disclaimers": ["..."],
    "limitations": ["..."],
    "missing_facts": ["..."]
  },
  "debug": {
    "decision_run_id": "uuid",
    "extract_run_id": "uuid",
    "prompt_version": "selfserve_v1.6_exec_summary_normalize_and_checklist_fix",
    "model": "gpt-4.1-mini",
    "derived": {
      "payee_added": null,
      "payee_added_agent": null,
      "provided_otp_or_creds_or_link": false,
      "step_up_authentication_used": null,
      "transaction_block_attempted": null
    }
  }
}
```

**Error responses:**
- `401` `{ ok: false, error: "missing_or_invalid_simulation_key" }`.
- `405` for non-POST.
- `404` if no `case_decision_runs` row exists, or its linked `case_extract_runs` row is missing.
- `500` plain text on internal failures.

**What it writes:**
- **`reports`** insert with `user_id`, `case_id`, `status = "COMPLETED"`, `report_json`, `created_at`, `updated_at`. (No update of existing rows; reuse happens by selecting the latest existing row.)

**What the frontend reads back to render the UI:**
- The function returns `report_json` directly — render immediately after success.
- For subsequent visits / refresh, read:

```sql
SELECT id, status, report_json, created_at
FROM reports
WHERE case_id = :case_id
ORDER BY created_at DESC
LIMIT 1;
```

Render per `report_json` field:
- `title`, `executive_summary` → header.
- `timeline` → chronological list.
- `disputed_transactions` (capped to 5 items) → table; show `authorised` badge (`yes` / `no` / `unclear` / `null`).
- `totals.total_amount` + `currency` → "Total amount in dispute".
- `key_responsibility_points`, `requested_resolution`, `evidence_checklist`, `disclaimers`, `limitations`, `missing_facts` → respective sections.

**Latency expectation:** ~10–25 seconds (single OpenAI call with strict schema + post-processing scrubs). Show a clear "Drafting your report — this can take up to 30 seconds" message.

**Idempotency:** Soft — `force: false` returns latest report. With `force: true`, every call inserts a new row, so multiple completed reports per case can accumulate.

---

### 3.6 `backfill_embeddings_v1` — Vector backfill (admin only, NOT for frontend)

**Layer:** none — admin / cron only. Documented for completeness so the frontend never calls it.

**Endpoint:** `POST {SUPABASE_URL}/functions/v1/backfill_embeddings_v1`

**Request payload:**

```json
{ "table": "regulatory_clauses", "limit": 50, "force": false, "model": "text-embedding-3-small" }
```

`table` ∈ `regulatory_clauses` | `public_decisions`. `limit` `1–200`.

**Response:**

```json
{ "ok": true, "table": "regulatory_clauses", "processed": 50, "updated": 47, "failed_count": 3, "embedding_model": "text-embedding-3-small" }
```

**Frontend rule:** **do not invoke**. Used by Maria / cron jobs to populate `regulatory_clauses.embedding` and `public_decisions.embedding` so `match_regulatory_clauses_threshold` and `match_public_decisions` work for `run_case_decision_v1`.

---

### 3.7 `decision_url_inbox` (deployed as `url_catalogue`) — URL inbox queue (admin only, NOT for frontend)

**Layer:** none — admin / scraper only. Documented for completeness so the frontend never calls it.

**Endpoint:** `POST {SUPABASE_URL}/functions/v1/url_catalogue?action=upsert|next|mark`

**Payload examples:**

```json
{ "source_url": "https://example.com/decisions/123", "source_system": "AFCA", "jurisdiction_code": "AU", "forum_name": "AFCA", "domain": "financial" }
```

```json
{ "limit": 10, "status": "new", "source_system": "AFCA" }
```

```json
{ "source_url": "https://example.com/decisions/123", "status": "ingested", "notes": "ok" }
```

**Frontend rule:** **do not invoke**.

---

## 4. Frontend write contracts (what the app must INSERT / UPDATE before calling each function)

Edge functions assume the data they read already exists. The frontend is responsible for these direct Supabase inserts/updates (via PostgREST / supabase-js with the user's Clerk-bridged JWT or via a server route with service role).

### 4.1 Before calling `run_case_extract_v4`

**Insert / update `cases`** (Layer 1 first time):

```ts
const { data: caseRow } = await supabase.from('cases').insert({
  user_id,                    // Clerk-mapped profile id
  creator_user_id: user_id,
  owner_user_id: user_id,
  claim_type,                 // CHECK constraint — see schema
  jurisdiction,               // e.g. 'SG'
  claim_amount,
  claim_currency,             // e.g. 'SGD'
  institution_name,
  incident_date,
  incident_datetime,
  primary_narrative,          // headline user story (free text / voice transcript)
  status: 'draft',
  case_status: 'DRAFT',
}).select('id').single();
```

**Insert `case_intake`** (Layer 1 first time and every gap-question answer):

```ts
await supabase.from('case_intake').insert({
  case_id: caseRow.id,
  narrative_text,             // raw user / voice text
  answers_json,               // { gap_field: user_answer, ... }
  source: 'web',              // or 'voice'
  intake_type: 'initial',     // or 'gap_response'
  language: 'en',
  timezone: 'Asia/Singapore',
  is_user_confirmed: true,
  // version is auto-assigned by trigger set_case_intake_version
});
```

### 4.2 Before calling `evidence_processed_v2`

**Upload blob to Supabase Storage**, then **insert `case_documents`**:

```ts
const { data: doc } = await supabase.from('case_documents').insert({
  case_id,
  filename,
  original_filename,
  file_size,
  mime_type,
  document_type,              // user-declared, normalised to evidence taxonomy
  upload_date: new Date().toISOString(),
  storage_provider: 'supabase',
  storage_bucket: 'case-evidence',   // prod route tries `case_evidence` then `evidence` — whichever succeeds
  storage_path,
  is_processed: false,
  processing_status: 'pending',
}).select('id').single();

// Then call evidence_processed_v2 with { document_id: doc.id }
```

**Production app path.** The Next.js handler [`app/api/evidence/upload/route.ts`](../app/api/evidence/upload/route.ts) uploads to Storage (`case_evidence`, then fallback `evidence`) and performs this **same INSERT** immediately after a successful blob write. **Supabase no longer auto-inserts** `case_documents` from `storage.objects` — the dashboard trigger `sync_case_document_from_storage` was **disabled** (2026‑05); only the app INSERT creates the row, so `case_documents_storage_unique` collisions from dual writers are gone.

**2026-05-03 trigger decision.** The storage auto-insert trigger disablement is treated as a hosted Supabase operational setting. No Git migration is required at this point.

### 4.3 Before calling `run_case_decision_v1` (Layer 2, Tier 1, server-side)

- `case_extract_runs` must exist (call `run_case_extract_v4` first).
- Optional but recommended: `case_validation_runs` row for that extract.

### 4.4 Before calling `run_report_selfserve_v1` (Layer 2, Tier 1, server-side)

- `case_decision_runs` row must exist (call `run_case_decision_v1` first).
- Stripe success → server inserts/updates `case_entitlements` (or `user_entitlements`) so `plan = 'self_serve_report'`.
- Server must verify `get_case_eligibility(:case_id).eligible_actions.run_report_selfserve === true`.

### 4.5 Structured validation gaps (Phase 2 DB — migrations `20260502133000_case_validation_gap_items.sql`, `20260502150000_run_validation_v1_gap_items.sql`)

Validation after each extract remains **inside Postgres** (trigger on `case_extract_runs` invoking `run_validation_v1`). **Additive Phase 2 (2026‑05‑02):** the canonical JSON arrays on **`case_validation_runs`** (`missing_fields`, `questions_to_user`, …) are **unchanged** for backward compatibility.

**Row-level gaps (preferred for deterministic UI)**

- **`case_validation_gap_items`** — One row per user-facing gap for a validation run.
  - **Keys / FKs:** `validation_run_id` → `case_validation_runs(id)` (CASCADE delete), `case_id` → `cases(id)`, optional `extract_run_id` → `case_extract_runs(id)`.
  - **Identity / ordering:** `field_key` (text, required), **`sort_order` int** (default 0); **unique** `(validation_run_id, field_key, sort_order)` so multiple questions for the same field are allowed when `sort_order` differs.
  - **Presentation:** `question_text`, optional `help_text`, `severity` (`required` | `recommended` | `optional`), `gap_type` (e.g. `missing_required_field`, `ambiguous_field`, `contradiction`, `needs_confirmation`, `evidence_gap`), `expected_answer_type`, **`answer_options` jsonb array**, `source` (default `'run_validation_v1'`).
  - **Audit / debug:** `raw_gap` jsonb (element from `missing_fields`), `raw_question` jsonb (matched question object or null).
- **`v_case_validation_gap_items`** — Read view over the stable columns (exposes the same semantic fields without requiring clients to parse raw blobs).

**`run_validation_v1` behaviour (dual write + deterministic pairing)**

1. Builds `missing_fields` and `questions_to_user` jsonb arrays (same semantics as before) and **`INSERT`s `case_validation_runs`** (`status`, `missing_fields`, `questions_to_user`, …).
2. For each element **`missing_fields[i]`** (`i = 0 .. n-1`), inserts **exactly one** **`case_validation_gap_items`** row with **`sort_order = i`**:
   - **Question text** comes from the **first** matching entry in **`questions_to_user`** with the same **`field`**, ordered by **array position** (`jsonb_array_elements … WITH ORDINALITY`, first match wins). That removes the old “dual array” nondeterminism.
   - If no usable match: synthetic `question_text` and `expected_answer_type = 'text'` / empty options.
3. **Integrity check:** inserted gap-item **count must equal `n`**; mismatch raises an exception and the function marks the parent **`case_validation_runs`** row **`status = 'error'`**, **`is_valid = false`**, **`error_message`** set (nested block `EXCEPTION WHEN OTHERS`).

**Frontend implementation contract (updated 2026-05-02).**

- Keep **`case_validation_runs`** as the parent validation state. The state machine still reads `status`, `missing_fields`, `questions_to_user`, `is_valid`, and `error_message` from the parent row selected by primary key.
- For the gap-question UI, prefer **`v_case_validation_gap_items`** filtered by **`validation_run_id`** and ordered by **`sort_order`**, then `created_at`. Use the base table only for backend/debug work.
- Normalize DB rows into the UI question shape before rendering: `field_key`/legacy `field` -> `key`; `question_text`/legacy `question` -> `question`; `expected_answer_type`/legacy `answer_type` -> `field_type`; `answer_options`/legacy `options` -> `options`; `severity === 'required'`/legacy `required === true` -> `required`.
- If the view returns zero rows, fall back to the parent JSON **`questions_to_user`** so older validation runs and partially migrated environments still render.
- If the parent row has **`status = 'error'`**, do not render normal gap questions. Surface **`error_message`** in the gap area and block Tier-0 auto-fire.
- Gap-answer saves still go through the existing responses path, but the frontend should send `response_type` from the normalized `field_type` instead of hard-coding `text`.

---

## 5. Frontend read contracts (where the UI reads state for each layer)

| Layer (= Tier) | Screen | Tables / views to read | Why |
|---|---|---|---|
| Layer 1 (Tier 0) | Intake form | `cases` (own row) | Pre-fill on edit. |
| Layer 1 (Tier 0) | "Analysing your story…" loader after submit | `case_extract_runs` (latest by `case_id`, `created_at DESC`) | Detect when `run_case_extract_v4` finished and gather `extract_json` + `missing_fields`. |
| Layer 1 (Tier 0) | Gap-question screen | `case_extract_runs.extract_json`; two-step **`case_validation_runs`** by PK (`status`, `missing_fields`, `questions_to_user`, `error_message`); preferred **`v_case_validation_gap_items`** filtered by `validation_run_id`, **`ORDER BY sort_order, created_at`** (§4.5); JSON fallback from `questions_to_user` when the view returns no rows | Parent validation row drives state and errors. Preferred view rows drive ordered UI questions after normalization; legacy JSON keeps older runs working. |
| Layer 1 (Tier 0) | Evidence screen | `case_documents`, `case_documents_enriched` (joined view) | Per-doc status, verification, extracted facts. |
| Layer 1 (Tier 0) | Tier-0 free draft screen | `case_narratives` rows where `narrative_type IN ('tier0_summary', 'tier0_evidence_checklist', 'tier0_srf_signal')` | Render free draft. |
| Layer 1 → Layer 2 transition | Pre-checkout gate ("Upgrade to full report") | RPC `get_case_eligibility(case_id)` | Confirm `eligible_actions.run_report_selfserve` before showing the "Buy report" CTA. |
| Layer 2 (Tier 1) | "Analysing case…" / "Drafting report…" progress | `case_decision_runs` (latest, or via `get_latest_decision_run(:case_id)`) | Score, status, rationale, references — surface progressively while `run_report_selfserve_v1` runs. |
| Layer 2 (Tier 1) | Report viewer | `reports` (latest by `case_id`, `created_at DESC`) | Render `report_json`. |
| Layer 3 / Tier 2 (post-report handoff + commerce) | Human-in-the-loop contact form, specialist recommendation copy, persistent WhatsApp link, and Slice 8 paid add-ons | Contact form writes only (one `upsert` into the contact-requests storage table — currently `escalation_waitlist`, UNIQUE on `user_id + case_id`); no edge function reads. Server-side snapshot read of latest `case_extract_runs.extract_json` happens inside `/api/contact-requests`, not from the client. WhatsApp is a third-party `wa.me` link. Paid add-ons use Stripe checkout/webhook routes. | Per §9.9 and §10.6 — triage form, server-captured amount + FI, email notification to Dance, confirmation screen, root-layout WhatsApp, and optional SGD 99 / SGD 800 specialist add-ons. |
| All layers | Header / nav badges | `user_entitlements` (own row); `case_entitlements` (this case); RPC `get_effective_entitlement(case_id)` | Show plan label and feature flags. |

**Realtime tip:** subscribe to `case_documents` (filter `case_id = eq.<id>`) for live `processing_status` updates instead of polling.

---

## 6. Postgres RPC integration (`get_case_eligibility`)

**Why it matters.** This RPC is the **single gating point** for the Layer 1 → Layer 2 transition (i.e. unlocking the paid Self-Serve Report). The server-side `run_report_selfserve_v1` already calls it internally, so client-side checks must use the same source.

**Call (frontend, via supabase-js):**

```ts
const { data, error } = await supabase.rpc('get_case_eligibility', { p_case_id: caseId });
```

**Returned JSON shape (illustrative):**

```json
{
  "case_id": "uuid",
  "user_id": "uuid",
  "plan": "self_serve_report",
  "features": { "self_serve_report": true, "...": "..." },
  "prerequisites": {
    "has_extract": true,
    "has_validation": true,
    "has_decision": true,
    "has_documents": true
  },
  "resolved_ids": {
    "extract_run_id": "uuid",
    "validation_run_id": "uuid",
    "decision_run_id": "uuid"
  },
  "eligible_actions": {
    "run_decision": true,
    "run_report_selfserve": true,
    "run_escalation_pack": false
  }
}
```

**Frontend rule.** Show the "Generate report" CTA only when `eligible_actions.run_report_selfserve === true`. If `false`, surface the missing prerequisite (e.g. "Add at least one supporting document" if `prerequisites.has_documents === false`).

The complementary RPC **`get_effective_entitlement(p_case_id)`** returns the merged plan + features (case-level override on top of user-level). Use this for header badges and feature flags.

---

## 7. End-to-end happy-path call sequence (compressed)

This is the minimum sequence the State Machine document will need to expand.

**Pre-login (public landing page, client-side only)**

0. User arrives on the public landing page. They type or voice-record their story in the hero prompt. The narrative + transcript live in **`sessionStorage`** (and in Clerk `unsafeMetadata` once the user clicks "Get my free report" and opens the Clerk sign-up widget). **No Supabase write happens yet.** (See the revised Dance answer C in reconciliation doc §5 — we keep Pattern C intact rather than creating an anonymous draft row.)

**Layer 1 — Tier 0 (free): post-login intake → evidence → extract + gap loop → narrative**

1. User completes Clerk sign-up / sign-in. Clerk returns a Supabase-compatible JWT (Pattern C, Slice 0 runbook); `handle_new_user()` trigger auto-creates `auth.users` + `profiles` with the same UUID.
2. First authenticated page load: client sends the `sessionStorage` / Clerk `unsafeMetadata` narrative in the body of a `POST /api/cases/bootstrap` call. The server uses `createUserClient()` to `INSERT` into `cases` (RLS `WITH CHECK (user_id = auth.uid())` fills `user_id` automatically) and into `case_intake` (`intake_type = 'initial'`). Returns `caseId`. Client clears the sessionStorage.
3. Evidence upload screen opens. User uploads documents → `POST /api/evidence/upload` (Storage write + **`INSERT case_documents`**, §4.2) → server route `POST /api/edge/evidence` (`/functions/v1/evidence_processed_v2` `{ document_id }`) per upload. Read `case_documents_enriched` for per-doc verification + extractions.
4. Once the minimum intake is present (institution, rough incident description, claim amount, date — Masha's explicit guidance) the server fires the first `POST /api/edge/extract` (`/functions/v1/run_case_extract_v4`) with `{ case_id }`. On success, client reads the new `case_extract_runs` row plus validation via **gotcha 6** (RPC + **`case_validation_runs`** PK). The gap UI then prefers **`v_case_validation_gap_items`** rows (§4.5) in deterministic `sort_order`, with `questions_to_user` JSON as fallback.
5. **Gap loop (still Layer 1):** for each gap question answered, frontend `INSERT`s a new `case_intake` row (`intake_type = 'gap_response'`) and re-fires `run_case_extract_v4`. Each new document upload also re-fires `run_case_extract_v4` after its `evidence_processed_v2` completes. Read updated `extract_json` + `missing_fields` after each run.
6. Once the user clicks "generate my free draft" (or has answered / skipped all gaps), the server runs one final **freshness-check** pass of `run_case_extract_v4`, then fires `POST /api/edge/tier0` (`/functions/v1/bright-function`) `{ case_id }`. **`bright-function` runs once.**
7. Frontend reads `case_narratives` rows (`tier0_summary`, `tier0_evidence_checklist`, optionally `tier0_srf_signal`) and renders the free draft screen.

**Layer 1 → Layer 2 transition (gate + payment)**

8. Frontend calls `supabase.rpc('get_case_eligibility', { p_case_id: caseId })`. Show the "Buy full report" CTA only when `eligible_actions.run_report_selfserve === true`. If `false`, surface the missing prerequisite from the response.
9. User clicks "Buy full report" → redirected to Stripe Checkout. The Stripe webhook (server) updates `case_entitlements` → `plan = 'self_serve_report'` and **enqueues a `jobs` row** for the Render worker.

**Layer 2 — Tier 1 (Render worker, paid Self-Serve Report) — two functions, with conditional upstream re-runs**

10. User is returned to an "Upgrade your report" screen where they can **optionally** add new documents or edit the narrative. If they do, the worker will pick those changes up in step 11's conditional re-run; if they skip, the worker runs on the existing Tier-0 data.
11. Render worker picks up the queued `jobs` row. Conditional re-runs: if there are `case_documents` rows newer than the last decision run, call `evidence_processed_v2` for each; if narrative was edited or any evidence was re-processed, call `run_case_extract_v4` once more. If nothing changed, skip both.
12. Worker calls `run_case_decision_v1` `{ case_id }` (loading state on the client: "Analysing case…").
13. Worker calls `run_report_selfserve_v1` `{ case_id, simulation_key, user_id }` (loading state: "Drafting report…").
14. Frontend subscribes to `jobs.status` + latest `reports` row via Realtime and renders `report_json` when it lands. Subsequent visits read the latest `reports` row for the case.

**Layer 3 / Tier 2 — FIDReC handoff, specialist copy, and optional commerce**

15. **Contact path — no edge function.** User reaches the Layer 3 / Tier 2 screen (entered via a CTA on the Tier-1 report viewer: "Need help escalating to FIDReC? -> Get help from a specialist"). Per §9.9 it includes a human-in-the-loop contact form. **User-entered:** name, email, phone, age (integer), employment status (professional / retiree / student / other), two FIDReC-qualification checkboxes (>= 30 days since last FI reply? FI issued final response?), optional message. **Auto-captured server-side (never trusted from the client):** `user_id` (from JWT), `case_id` (from route context), `amount_lost_sgd` + `financial_institution` (snapshotted from the latest `case_extract_runs` row at insert time). Submit POSTs to `/api/contact-requests`, which performs an RLS-scoped ownership probe + snapshot read + `upsert` into the contact-requests storage table (UNIQUE on `user_id + case_id`) and emails Dance. The same surface keeps the root-layout WhatsApp entry point and, after Slice 8, adds SGD 99 / SGD 800 Stripe add-ons (§10.6). The contact route itself remains no-edge-function.

---

## 8. Decisions locked for MVP (State Machine contract)

All seven gotchas plus two cross-cutting questions are now resolved. The table below is the **binding contract** for the State Machine document — every transition must conform to these rules.

### 8.1 Gotcha resolutions

| # | Topic | MVP decision | Why / rationale | What the State Machine must show |
|---|---|---|---|---|
| 1 | **SRF signal in Tier-0 draft** | Tier-0 draft screen renders **whatever `case_narratives` rows exist** for the case. Do not block on a specific count. | Eliminates a hidden "hang forever" failure path if `bright-function` doesn't write `tier0_srf_signal` on every run. | Tier-0 draft node's condition: *"On any `case_narratives` insert/update, re-render panels from whichever rows exist."* Panels: `tier0_summary` (required), `tier0_evidence_checklist` (required), `tier0_srf_signal` (conditional — render only if row is present). |
| 2 | **Edge function auth** | **Every edge function call goes through a Next.js server route.** No direct browser → edge function calls, ever. | Keeps `simulation_key` and service-role key out of the browser; provides a single place to enforce Clerk auth + "does this user own this case" checks. | Every call arrow is a **3-hop arrow**: `browser → Next.js server route → Supabase edge function`. Never draw a 2-hop arrow for edge functions. (Direct `supabase-js` reads on RLS-protected tables from the browser remain fine.) |
| 3 | **Layer 3 / Tier 2 FIDReC handoff** | Post-Tier-1 surface with a **human-in-the-loop contact form** plus specialist recommendation copy. User enters name, email, phone, **age**, **employment status** (professional / retiree / student / other), and two **FIDReC-qualification checkboxes** (>= 30 days since last FI reply? FI issued final response?) plus an optional message. Server snapshots `user_id`, `case_id`, `amount_lost_sgd`, `financial_institution` from the latest `case_extract_runs` row at insert time. Submit POSTs to `/api/contact-requests`, writes one row to the contact-requests storage table, emails Dance, shows confirmation. WhatsApp is required as the existing persistent root-layout `wa.me` link. Slice 8 adds SGD 99 / SGD 800 Stripe add-ons on this same surface. **No LinkedIn CTA, no generic coming-soon waitlist, no contact-route edge function.** | 2026-04-21 PM late-afternoon refinement added demographics + qualification booleans. 2026-04-26 update: Layer 3 = Tier 2 surface, persistent WhatsApp remains, and specialist consult / case-pack commerce is added through Stripe, not Supabase edge functions. | Contact form remains a **3-state branch** `L3-FormFilling → L3-Submitting → L3-Confirmed`. The form action is an `upsert` (UNIQUE on `user_id + case_id`) via `/api/contact-requests`. WhatsApp is a third-party link. Paid add-ons use Stripe checkout/webhook routes. |
| 4 | **Evidence file types** | Frontend upload UI **only accepts PDF, PNG, JPEG, DOCX.** Reject `.txt` (and everything else) at the file-picker step — do not upload to Storage. | Stops silent mis-processing by Gemini (which coerces unknown MIMEs to `image/jpeg`). DOCX is covered here pending confirmation that Gemini accepts it; see §10 residual items. | Upload node annotation: *"Accepted types: PDF, PNG, JPEG, DOCX. Client-side validation rejects everything else before upload."* Future-work annotation (out of MVP scope): *"Backend to extend MIME detection so `.txt` can be accepted natively."* |
| 5 | **Legacy extract function versions (`v1`, `v2`, `v3`)** | **Frontend pins `run_case_extract_v4`** via a single constants file (see §9.1). Masha archived v1/v2/v3 from Supabase on 2026-04-21 (see reconciliation doc §4); remaining work is to delete the `supabase/functions/run_case_extract_v{1,2,3}` folders from the repo. | Prevents accidental wiring to the wrong version and documents the cleanup debt. | Every reference in the State Machine diagram uses the literal string **`run_case_extract_v4`**. A note in the diagram margin reads: *"v1, v2, v3 are archived — do not call. v4's internal version string reads `v3.2555…`; the folder name is still the contract."* |
| 6 | **Validation read is a two-step lookup plus preferred gap rows** | Use **`get_case_eligibility(case_id)`** as the single source of truth for current run IDs. Read `resolved_ids.validation_run_id`, then `SELECT * FROM case_validation_runs WHERE id = :validation_run_id`. For the gap UI, additionally read `v_case_validation_gap_items WHERE validation_run_id = :id ORDER BY sort_order, created_at`; fallback to parent `questions_to_user` only when the view returns zero rows. | The RPC already does the join correctly. Writing a one-shot query on `case_id` silently returns the wrong row or nothing. The view gives deterministic order and stable `field_key`/answer metadata for rendering. | Every validation / gap-question read is annotated as: Step 1: `rpc('get_case_eligibility', { p_case_id })` -> take `resolved_ids.validation_run_id`. Step 2: parent `case_validation_runs` by PK for state/errors. Step 3: `v_case_validation_gap_items` by `validation_run_id` for ordered questions, normalized into the UI shape. |
| 7 | **`force` flag semantics** | **Do not expose `force: true` anywhere in the MVP UI.** Every re-run is "natural" — user changes input (answers a gap, uploads a new doc, edits intake) → the frontend calls the function **without** `force`. | Sidesteps three incompatible re-run behaviours. When a force flag is eventually needed (admin tool / support), it will be a separate internal surface, not user-facing. | For each re-run path in the diagram, annotate:<br>• **Extract node:** *"Re-run always appends a new `case_extract_runs` row. No `force` flag."*<br>• **Decision node:** *"Re-run without `force` reuses the existing decision via the `(case_id, extract_run_id)` partial unique index. `force: true` is NOT called in MVP UI."* **TODO (post-MVP):** add audit-trail table in Supabase so overwrites from `force: true` preserve prior versions.<br>• **Report node:** *"`force: false` reuses the latest completed report. UI always renders `SELECT * FROM reports WHERE case_id = :id ORDER BY created_at DESC LIMIT 1`."* |

### 8.2 Cross-cutting decisions

| # | Topic | MVP decision | Why | What the State Machine must show |
|---|---|---|---|---|
| A | **Polling vs Realtime** | **Realtime** for `case_documents.processing_status` (users stare at the upload UI). **Single-shot read after the explicit "Submit" spinner completes** for `case_extract_runs` — no subscription. | Live upload feedback is critical UX. Extract is a deliberate user action with a short spinner; polling/subscribing adds complexity without user benefit. | Evidence node transition: *"On Supabase Realtime message (table: `case_documents`, filter: `case_id = eq.<id>`), advance per-document state (`pending → parsing → verifying → chunking → extracting → ready`/`failed`)."* Extract transition: *"After `run_case_extract_v4` POST returns `200`, re-read `case_extract_runs` once + run the two-step validation read (see gotcha 6)."* |
| B | **Stripe webhook fan-out** | **Background job.** Stripe webhook handler does only: (1) verify signature, (2) upgrade `case_entitlements` / `user_entitlements`, (3) enqueue a background job that fires `run_case_decision_v1` → `run_report_selfserve_v1`, (4) return `200` to Stripe in <1 second. Frontend watches the `reports` table for the new row via Realtime. | Stripe's ~10s webhook timeout would otherwise cause retries and duplicate report generation (40s combined decision + report latency). Background job also gives us a clean "Analysing case… / Drafting report…" progress UX. | Post-payment flow in the diagram has **three sequential states** (not one): **S-pay → S-decision-running → S-report-drafting → S-report-ready**. The frontend enters **S-decision-running** immediately after Stripe returns success, and advances on Realtime events:<br>• To **S-report-drafting** when a new `case_decision_runs` row appears.<br>• To **S-report-ready** when a new `reports` row with `status = 'COMPLETED'` appears. |
| C | **When does `bright-function` fire?** | **Auto-fire** once the gap loop has no blocking `missing_fields` **and** at least one document has reached `processing_status = 'ready'`. Re-fire-able via an explicit "Refresh draft" button on the Tier-0 screen. | Handover doc's "move evidence upload early" guidance plus the design intent that Tier-0 draft should reflect real evidence. | Transition into Tier-0 draft node is **automatic** when both conditions are true. The Tier-0 node also has a **self-loop** labelled *"User clicks 'Refresh draft' → re-POST `bright-function`"*. |
| D | **Does `run_case_extract_v4` auto-re-fire after each document?** | **Yes.** Every time an `evidence_processed_v2` call completes with `ok: true`, the Next.js server route also re-fires `run_case_extract_v4` for that `case_id`. No user action required. | Keeps `extract_json`, parent validation JSON, and `v_case_validation_gap_items` rows in sync with newly processed evidence automatically. | Evidence node has a **fan-out transition**: on `evidence_processed_v2` success, the server route additionally calls `run_case_extract_v4` and the frontend updates via Realtime/single-shot read on `case_extract_runs` plus the validation two-step read. |

---

## 9. Frontend implementation requirements (feeds directly into the State Machine)

This section consolidates every concrete engineering action implied by §8 so the State Machine author can annotate nodes and arrows with unambiguous implementation notes. Each item has an **action** the frontend must implement and an explicit **State Machine mention** to include in the diagram.

### 9.1 Edge-function constants file (one source of truth for function names)

**Action.** Create `lib/edge-functions.ts` (or equivalent path in the Next.js app) that exports every edge function name as a constant. All call sites — both the browser and the Next.js server routes — import from this file; no raw strings.

```ts
// lib/edge-functions.ts (current, post-2026-04-21 PM reconciliation — five frontend-invoked functions)
export const EVIDENCE_FN = 'evidence_processed_v2';  // Tier-0 step 1
export const EXTRACT_FN = 'run_case_extract_v4';     // Tier-0 step 2 (fires multiple times through the gap loop)
export const TIER0_FN = 'bright-function';           // Tier-0 step 3 — Dashboard label "tier-0 narrative generator"
export const DECISION_FN = 'run_case_decision_v1';   // Tier-1 step 4 (Render worker, post-Stripe)
export const REPORT_FN = 'run_report_selfserve_v1';  // Tier-1 step 5 (Render worker)

// Archived / fallback-only / do-not-call (kept here ONLY so grep finds them when auditing)
export const LEGACY_EXTRACT_FNS = ['run_case_extract_v1', 'run_case_extract_v2', 'run_case_extract_v3'] as const;
export const ARCHIVED_GEMINI_TASK_FN = 'gemini-task';                               // archived 2026-04-21 PM
export const FALLBACK_ONLY_FNS = ['candidate-transactions', 'compute-loss'] as const; // Masha-internal only
```

See the live file at [`lib/edge-functions.ts`](../lib/edge-functions.ts) — the constants above mirror it 1:1.

**State Machine mention.** At the top of the diagram, include a note: *"All edge function names are imported from `lib/edge-functions.ts`. Never inline the string. Legacy `run_case_extract_v1`/`v2`/`v3`, `gemini-task`, `candidate-transactions`, and `compute-loss` are not called from the frontend — the first three are archived, the last two are Masha-internal fallbacks triggered from the Supabase Dashboard when `run_case_extract_v4` can't compute the loss."*

### 9.2 Server-route wrapper pattern (blanket auth boundary — Pattern C locked)

**Auth architecture recap (see §10.4 for full proof).** Clerk is the user-facing auth provider. Supabase runs as a **Third-Party Auth consumer** — it verifies the Clerk JWT via JWKS and issues a Supabase UUID that populates `auth.users.id` and `public.profiles.id`. RLS policies on `cases` and every descendant table (`case_documents`, `case_outcomes`, `case_responses`, `evidence`, `case_collaborators`, …) are already written against `auth.uid()`. **RLS therefore enforces ownership automatically — the server route does not need to re-implement it.**

**Action.** For every edge function the frontend needs (except admin-only), create a thin Next.js App Router route handler under `app/api/edge/<name>/route.ts` that:

1. **Verifies the Clerk session.** `const { userId, getToken } = auth()` from `@clerk/nextjs/server`. `userId === null` → return `401 Unauthorized`.
2. **Creates a Supabase client bound to the Clerk JWT.** Use the Clerk–Supabase integration so every downstream query runs under `auth.uid() = <Supabase UUID>`. Concretely:
   ```ts
   const token = await getToken({ template: 'supabase' }); // Clerk JWT template signed for Supabase
   const supabase = createClient(
     process.env.NEXT_PUBLIC_SUPABASE_URL!,
     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,   // anon key, NOT service role
     { global: { headers: { Authorization: `Bearer ${token}` } } }
   );
   ```
   (Clerk + Supabase quickstart: configure a `supabase` JWT template in Clerk Dashboard → JWT Templates, and enable Clerk as the third-party auth provider in Supabase Dashboard → Authentication → Third-Party Auth.)
3. **Do not re-check case ownership manually.** RLS already rejects any `SELECT`/`UPDATE`/`DELETE` the user doesn't own. This removes the extra `cases.owner_user_id = X` pre-read that v1 of this document required.
4. **Inject server-side secrets when forwarding to the edge function.** This is the only place the route handler uses privileged credentials:
   - `run_report_selfserve_v1` → adds `simulation_key: process.env.SIMULATION_KEY` to the body.
   - All others → sets `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` on the outbound `fetch`.
   - Uses a **separate** service-role Supabase client only for the `fetch` call — never pass service role back to the browser.
5. **Forward to the Supabase edge function URL** and return the JSON response unchanged to the browser.

**Reference implementation (paste this once, duplicate per function).**

```ts
// app/api/edge/extract/route.ts
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { EXTRACT_FN } from '@/lib/edge-functions';

export async function POST(req: Request) {
  const { userId, getToken } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  if (!body.case_id) return new Response('case_id required', { status: 400 });

  // 1) User-scoped client (RLS applies). We use this to read the case to prove
  //    the user has any relationship to it before burning an edge-function call.
  //    RLS returns 0 rows if the user doesn't own it → treat as 404.
  const userToken = await getToken({ template: 'supabase' });
  const supabaseUser = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } }
  );
  const { data: own, error: ownErr } = await supabaseUser
    .from('cases').select('id').eq('id', body.case_id).maybeSingle();
  if (ownErr || !own) return new Response('Not found', { status: 404 });

  // 2) Forward to the edge function with service role (never reaches browser).
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${EXTRACT_FN}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(body),
    }
  );
  const out = await res.json();
  return Response.json(out, { status: res.status });
}
```

**Why a user-scoped read before the forward (step 1 above)?** The edge functions themselves are documented as running with service role internally and do not currently enforce ownership. Adding the 1-row `SELECT` is a cheap belt-and-braces check so a malicious browser can't trigger extract runs on other users' `case_id`s. Cost: ~10 ms per call. RLS makes it safe.

**State Machine mention.** Every edge-function arrow in the diagram is labelled with the server route path, e.g. `browser → POST /api/edge/extract → Supabase run_case_extract_v4`. A legend panel states: *"All edge-function arrows are 3-hop: browser → Next.js route handler → Supabase. Route handlers verify Clerk session, forward a Clerk-signed JWT to Supabase so RLS enforces ownership, then inject service-role credentials on the final leg to the edge function."*

### 9.3 Realtime subscription for evidence processing status

**Action.** On the evidence upload screen, the frontend opens a Supabase Realtime subscription:

```ts
const channel = supabase
  .channel(`case_documents:${caseId}`)
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'case_documents', filter: `case_id=eq.${caseId}` },
    (payload) => {
      // update local state for this document: processing_status, verification_status, etc.
    }
  )
  .subscribe();
```

Unsubscribe on screen unmount.

**State Machine mention.** Evidence node is annotated: *"Frontend holds a Realtime subscription on `case_documents` filtered to this `case_id`. Per-document state transitions (`pending → parsing → verifying → chunking → extracting → ready`/`failed`) are driven by Realtime events, not polling."*

### 9.4 Single-shot read for extraction + validation (with two-step validation lookup)

**Action.** After the "Submit" spinner for `run_case_extract_v4` completes (POST returns `200`), the frontend executes this sequence once (no subscription):

```ts
// Step 1: get the current run IDs for this case via RPC (single source of truth)
const { data: elig } = await supabase.rpc('get_case_eligibility', { p_case_id: caseId });
const extractRunId = elig.resolved_ids.extract_run_id;
const validationRunId = elig.resolved_ids.validation_run_id;

// Step 2a: read the latest extract (drives gap questionnaire shape)
const { data: extract } = await supabase
  .from('case_extract_runs')
  .select('*')
  .eq('id', extractRunId)
  .single();

// Step 2b: read the matching validation parent row (drives state/errors)
const { data: validation } = await supabase
  .from('case_validation_runs')
  .select('*')
  .eq('id', validationRunId)
  .single();

// Step 2c: read preferred structured gap rows for UI questions
const { data: gapItems } = await supabase
  .from('v_case_validation_gap_items')
  .select('*')
  .eq('validation_run_id', validationRunId)
  .order('sort_order', { ascending: true })
  .order('created_at', { ascending: true });

// Render normalized gapItems when present; otherwise normalize
// validation.questions_to_user for backward compatibility.
```

**Never** write a one-shot query on `case_id` against `v_latest_validation` — it is keyed by `extract_run_id`.

**State Machine mention.** The gap-questionnaire node is annotated: *"Two-step read. Step 1: `rpc('get_case_eligibility', { p_case_id })` -> take `resolved_ids.extract_run_id` and `resolved_ids.validation_run_id`. Step 2: fetch the matching parent rows by primary key. Step 3: fetch `v_case_validation_gap_items` by `validation_run_id`, ordered by `sort_order`, and normalize to the UI question shape; fallback to parent `questions_to_user` if the view returns zero rows. Do not query `v_latest_validation` or `case_validation_runs` by `case_id` directly."*

### 9.5 Tier-0 draft screen: render-whatever-exists

**Action.** The Tier-0 draft screen reads:

```sql
SELECT narrative_type, title, text_content, created_at
FROM case_narratives
WHERE case_id = :case_id
ORDER BY created_at DESC;
```

It renders three panels keyed by `narrative_type`:

- `tier0_summary` — main "Your story so far" panel.
- `tier0_evidence_checklist` — evidence prompts list.
- `tier0_srf_signal` — **confirmed present** on multiple test cases in Supabase (verified 2026-04-20). Label it *"Preliminary signal — informational only, not a final eligibility decision."*

All three are expected to be written by `bright-function` on every successful run, but the screen **still follows a render-whatever-exists rule**: if any one row is missing for any reason (schema drift, failed run, future prompt changes), render the panels that exist and omit the ones that don't — never block the whole screen on a row count. If no rows exist yet, show the loading state tied to the `bright-function` POST in flight.

> **Note on product intent.** The `Project Documentation` mentions a discussion about removing the SRF panel. For MVP we keep it because it adds free perceived value to Tier 0 and differentiates it from competitor summaries. If product decides to remove it later, the render-whatever-exists rule means the frontend needs zero changes — stop writing the row and it simply stops appearing.

**State Machine mention.** Tier-0 draft node is annotated: *"Three `case_narratives` rows expected: `tier0_summary`, `tier0_evidence_checklist`, `tier0_srf_signal`. Render whichever rows exist — never block on row count."*

### 9.6 Upload UI — MIME whitelist

**Action.** The file picker uses `accept="application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document"` and an explicit client-side MIME check (not just extension) before calling Supabase Storage. Rejections show an inline message: *"We accept PDF, PNG, JPEG, or DOCX. Please convert your file and try again."*

**State Machine mention.** Upload node is annotated: *"Accepted types: PDF, PNG, JPEG, DOCX. Client-side MIME validation rejects everything else **before** upload to Storage. Post-MVP: extend `evidence_processed_v2` MIME detection so `.txt` can be accepted natively."*

> ⚠️ **Residual check** (§10.2): DOCX is in the whitelist pending confirmation that `evidence_processed_v2` handles DOCX cleanly. If not, the list collapses to PDF / PNG / JPEG for MVP and DOCX moves to the post-MVP list.

### 9.7 Stripe webhook fan-out — background job

**Action.** The Stripe webhook handler (`app/api/stripe/webhook/route.ts` or equivalent) does only:

1. Verify the Stripe signature.
2. Load the `case_id` and `user_id` from the session metadata.
3. `INSERT`/`UPDATE` `case_entitlements` so `plan = 'self_serve_report'`.
4. **Enqueue** a background job (Supabase Queues, Inngest, Render background worker, or a simple Supabase cron-triggered edge function — choose one and document).
5. Return `200` to Stripe.

The background job:
1. POSTs `run_case_decision_v1` via the server route.
2. On success, POSTs `run_report_selfserve_v1` via the server route.
3. (Optional) emits Resend email on completion.

The frontend, meanwhile, has been redirected to `/app/case/[id]/report` after Stripe success. That screen:

1. Opens a Realtime subscription on `case_decision_runs` filtered by `case_id` → advances to "Drafting report…" when a row appears.
2. Opens a Realtime subscription on `reports` filtered by `case_id` → advances to "Report ready" when a `status = 'COMPLETED'` row appears.

**State Machine mention.** Post-payment flow is drawn with **three sequential states** (not one): `S-decision-running → S-report-drafting → S-report-ready`. Each transition is driven by a Realtime event on the matching table. The diagram explicitly marks: *"Stripe webhook returns `200` in <1s. Heavy work runs in a background job."*

### 9.8 Audit-trail TODO (post-MVP follow-up)

**Action.** Track a Supabase backlog ticket: *"Add audit trail for `case_decision_runs` overwrites."* Today, calling `run_case_decision_v1` with `force: true` **updates in place** and prior decision content is lost. Add a shadow table `case_decision_runs_history` (or use Postgres row-versioning / `pg_history`) so overwrites preserve prior versions. Out of MVP scope because the MVP UI does not expose `force: true`.

**State Machine mention.** Decision node margin note: *"TODO (post-MVP, Supabase backlog): add audit-trail table so `force: true` overwrites preserve prior versions."*

### 9.9 Layer 3 / Tier 2 — FIDReC handoff contact form (human-in-the-loop)

**Action.** The Layer 3 / Tier 2 screen has **no edge function calls for the contact form**. It is the post-Tier-1 surface the user sees after the self-serve report is generated. It includes the human-in-the-loop FIDReC contact form, specialist recommendation copy, the persistent root-layout WhatsApp entry point, and, after Slice 8, specialist consult / case-pack Stripe add-ons (§10.6). The form captures the information Dance needs to triage the request at a glance — who the person is, which FI is involved, how much they lost, whether they are even at a stage where FIDReC will accept the case, and some light demographics.

Dance's 2026-04-21 PM decision (refined by the 2026-04-21 PM late-afternoon Layer 3 spec expansion — see reconciliation doc §0.4): "Show a human-in-the-loop screen as the last thing the user sees after their self-serve report. Capture name, phone, email, age, employment status, case_id, user_id, amount lost, and two yes/no FIDReC-qualification questions. Write to the contact-requests storage table, email me, show a 'we'll be in touch' confirmation." The 2026-04-26 product update keeps that form and adds persistent WhatsApp plus paid specialist add-ons on the same Layer 3 / Tier 2 surface.

**One screen, one form** — the user types the few fields Dance genuinely needs; everything else (case identity, amount lost, FI name, user_id) is **snapshotted server-side** from the latest `cases` + `case_extract_runs` rows at the moment of submit. The user never types or edits the amount or the FI name — those are displayed read-only so the user knows what Dance will see.

#### 9.9.1 Fields on the form

Split into three groups by how the value is obtained.

**Group A — auto-captured server-side (never sent from the client; snapshotted at `INSERT` time).**

| Field | Source | Notes |
|---|---|---|
| `user_id` | `auth.uid()` from the Clerk-signed Supabase JWT | Column `DEFAULT auth.uid()`; RLS enforces `user_id = auth.uid()`. |
| `case_id` | Passed from the current dashboard route (`/app/case/[id]/...`) | Server route validates ownership via RLS probe before insert. |
| `amount_lost_sgd` | `SELECT case_extract_runs.extract_json.losses.reported_loss.amount FROM case_extract_runs WHERE case_id = :id ORDER BY created_at DESC LIMIT 1` — **falls back** to `cases.claim_amount` if the extract row has no amount. Always in SGD (§10.x assumes SGD-only MVP). | Frozen at submit time so Dance sees the number the user was looking at when they clicked through. |
| `financial_institution` | `SELECT case_extract_runs.extract_json.case_meta.institution_name ...` — **falls back** to `cases.institution_name`. | Frozen at submit time. |

**Group B — auto-filled on the client, user can edit before submit.**

| Field | Source for pre-fill | Editable? | Required |
|---|---|---|---|
| First name | Clerk user (`firstName`) | yes | yes |
| Last name | Clerk user (`lastName`) | yes | yes |
| Email | Clerk user (primary email) | yes | yes |
| Phone | Clerk user (primary phone) or blank | yes | yes |

**Group C — user-entered (no pre-fill).**

| Field | Widget | DB column | Required |
|---|---|---|---|
| Age | Number input (13 ≤ n ≤ 120) | `age int` with CHECK constraint | yes |
| Status | Radio group: **Professional** / **Retiree** / **Student** / **Other** | `employment_status text` CHECK `IN ('professional','retiree','student','other')` | yes |
| "Has it been **30 days or more** since you last heard back from your bank or financial institution?" | Checkbox (Yes / No) | `thirty_days_since_last_fi_reply boolean NOT NULL` | yes |
| "Has the financial institution **issued their final response** to your complaint?" | Checkbox (Yes / No) | `fi_issued_final_response boolean NOT NULL` | yes |
| Additional context (optional) | Textarea, 500 char max | `message text` | no |

**Why those two checkbox questions.** FIDReC only accepts a dispute once the consumer has given the FI a chance to resolve it and either waited out the statutory review period (≥ 30 days after last FI response) **or** received the FI's final response. Dance needs to know both answers at triage time so he can tell the user either (a) "we can start on your FIDReC submission now," or (b) "you need to wait another X days before FIDReC will accept the case — let's plan accordingly." They are therefore **required** and stored as booleans, not free-text.

**Amount and FI displayed read-only on the form.** Above the form body, show a small context card:

> **Your case as we understand it today**
> *Financial institution:* DBS Bank *(from your case details)*
> *Reported loss:* SGD 47,200.00 *(from your case extract)*
> *Case ID:* `a1b2c3d4…` *(for Dance's reference)*

If either value is `NULL`, render "—" and allow the user to continue — Dance can follow up to fill the gap.

#### 9.9.2 Submit behaviour

On submit, the frontend POSTs to the Next.js server route `/api/contact-requests` with body `{ first_name, last_name, email, phone, age, employment_status, thirty_days_since_last_fi_reply, fi_issued_final_response, message?, case_id }`. The client does **not** send `user_id`, `amount_lost_sgd`, or `financial_institution` — the server sets those itself (§9.9.1 Group A). The route:

1. Verifies the Clerk session (401 if missing).
2. Zod-validates the body.
3. Using the user-scoped Supabase client (`createUserClient()`), performs a 1-row ownership probe on `cases` filtered by `case_id` (RLS rejects non-owners → route returns 403/404).
4. Reads the latest `case_extract_runs` row for that `case_id` via the same user-scoped client and extracts `amount_lost_sgd` + `financial_institution`.
5. `INSERT`s one row into the contact-requests storage table (schema in §10.5) with the snapshot values merged into the user-provided fields.
6. Sends a notification email to Dance (Resend or equivalent) containing `{ case_id, name, phone, email, age, employment_status, thirty_days_since_last_fi_reply, fi_issued_final_response, amount_lost_sgd, financial_institution, message?, submitted_at }`. Email failures are logged but do not fail the request — the DB row is the source of truth.
7. Returns `{ ok: true, id }`.

**Confirmation state:** *"Thanks — we'll be in touch within 1–2 business days to help you prepare your FIDReC submission."*

**Entry point.** A single CTA rendered on the Tier-1 report viewer (`L2-ReportReady`), immediately after the report content:

> **Need help escalating to FIDReC?**
> If the financial institution hasn't resolved this to your satisfaction, we can help you prepare a formal FIDReC submission.
> **→ Get help from a specialist**

Clicking the CTA navigates to `L3-ContactForm`.

**WhatsApp / specialist copy.** Keep the existing root-layout WhatsApp `wa.me/6590727915` entry point on every route, including public pages. Do not add a duplicate global widget. On the Layer 3 / Tier 2 screen, add copy recommending the user reach the Scam and Fraud Specialist for consult or Q&A. The public WhatsApp link is R13-safe because it is a third-party link only, with no Supabase client on pre-login paths.

**State Machine mention.** Layer 3 / Tier 2 keeps the contact form as a three-state branch: `L3-FormFilling` → `L3-Submitting` → `L3-Confirmed`. The form side effects are a single `INSERT` / `upsert` into the contact-requests storage table and one email to Dance. No Supabase edge function is called by the contact path. The same surface also carries the root-layout WhatsApp entry point and, after Slice 8, the specialist add-on checkout CTAs from §10.6.

*(Deprecated from earlier 2026-04-21 PM morning design: LinkedIn CTAs and the generic "Escalation Pack — coming soon" waitlist framing. Deprecated from the 2026-04-21 PM mid-afternoon design: the 4-field "name / email / phone / optional message" minimal form — expanded on 2026-04-21 PM late-afternoon to capture FIDReC-qualification signals and demographics. The 2026-04-26 WhatsApp requirement supersedes the older "no WhatsApp" wording.)*

---

## 10. Residual items and locked follow-ons

Everything in §8 and §9 is locked for MVP. Sections marked ✅ are settled follow-ons or schema contracts; unmarked items are residual unknowns to verify before implementation.

### 10.1 ~~Does `bright-function` actually emit `tier0_srf_signal`?~~ ✅ Confirmed present (2026-04-20)

**Status.** **Closed.** Verified in Supabase Dashboard → Table Editor → `case_narratives`: multiple test cases run by Masha contain rows with `narrative_type = 'tier0_srf_signal'`. The Tier-0 draft screen will display three panels on the happy path.

**Note.** The `Project Documentation` contains a discussion about removing the SRF panel. The current MVP decision is to **keep** it because it adds perceived value to the free tier. The render-whatever-exists rule in §9.5 means no frontend changes are needed if it is later removed — the backend stops writing the row, the panel stops appearing.

### 10.2 DOCX support in `evidence_processed_v2`

**Status.** The MIME whitelist in §9.6 includes DOCX, but the wiki only explicitly guarantees PDF / PNG / JPEG through the Gemini inline-data path. Masha's existing test cases did not include DOCX or any other document uploads, so DOCX behaviour is untested on the production path.

**Verification plan.** Once the frontend is wired to the backend, upload a small DOCX to a test case and call `evidence_processed_v2` via a server route. Check `case_documents.processing_status` — `ready` means it worked; `failed` plus `processing_error` means Gemini rejected it.

**Architectural decision — where the fix lives if DOCX fails.** Keep the fix **inside the Supabase edge function `evidence_processed_v2`**. Do NOT add a DOCX-to-PDF conversion step in Render or in the Next.js server route.

Rationale:
- **Single responsibility.** Document parsing is already the edge function's job. Splitting it creates two places that must agree on "what is a valid document".
- **Fewer hops.** Supabase-only keeps the flow at: browser → Storage → edge function. Adding Render pre-processing inserts a duplicate copy of the blob and a second round-trip (browser → Storage → Render → re-upload → edge function).
- **State consistency.** `case_documents.processing_status` is written by the edge function. A Render intermediate step would have to mirror those status transitions or the two services would drift.
- **No new secret surface.** Render pre-processing would need its own Gemini API key (or Supabase service role), doubling the secret footprint.

**Implementation options for Masha inside `evidence_processed_v2`** (choose one):
1. Extract DOCX text using a Deno-compatible library (`mammoth`-style) and feed the plain text into Gemini via the text-content path (not inline-data).
2. Convert DOCX bytes to PDF in-function and reuse the existing PDF path.

**If DOCX fails and Masha cannot fix it quickly.** Collapse the MVP whitelist in §9.6 and the State Machine upload node to **PDF / PNG / JPEG** only. Move DOCX to the post-MVP backlog (Masha ticket: *"Extend `evidence_processed_v2` to handle DOCX natively"*).

### 10.3 ✅ Background-job runtime: Render background worker (locked 2026-04-20)

**Decision.** The post-Stripe background job runs as a **Render background worker** service. It polls (or subscribes to) a lightweight `jobs` table in Supabase and executes the decision → report chain.

**Rationale — why Render, not Supabase `pgmq`:**

| Dimension | Supabase `pgmq` | **Render background worker (chosen)** |
|---|---|---|
| Code language | Deno (edge functions) | Node.js / TypeScript — **same as Next.js web app** |
| Code reuse | Would duplicate `lib/edge-functions.ts`, the server-route client, and types in a second runtime | Imports directly from the Next.js monorepo — one implementation |
| Ops surface | Supabase-only logic split into "edge functions" + "pgmq workers" + "cron" | One Render service dashboard; one place to check |
| Observability | Supabase function logs (per-invocation, less rich) | Render logs + metrics + restart signals — first-class |
| Failure handling | Build retry yourself on top of `pgmq` | Render auto-restarts crashed workers; use `p-retry` for per-call backoff |
| Cost (MVP) | Free | ~$7/mo Starter worker |
| Mental model | "Some work on Supabase, some on Render, some on pgmq" | **"Data + auth on Supabase, heavy work on Render"** — one-sentence explanation |

**Implementation outline:**
1. Add a `jobs` table in Supabase: `id uuid, case_id uuid, job_type text, status text, attempts int, last_error text, created_at timestamptz, updated_at timestamptz`.
2. Stripe webhook handler (Next.js) inserts one row with `job_type = 'post_payment_report_generation'` and `status = 'queued'`.
3. Render background worker polls `jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED` every few seconds, or subscribes via Supabase Realtime on inserts.
4. Worker calls the Next.js server routes for `run_case_decision_v1` then `run_report_selfserve_v1` (reuses the same auth-wrapped endpoints).
5. Worker updates `jobs.status` to `running` / `succeeded` / `failed` with exponential backoff retries.
6. Frontend watches `case_decision_runs` and `reports` via Realtime (per §9.7) — not `jobs` — so the user-facing state machine stays clean.

**State Machine impact.** None — the diagram still shows "background job" generically. This decision only matters for the implementation plan and for the PaaS bill.

### 10.4 ✅ Clerk → Supabase user-ID mapping — locked (Pattern C, verified 2026-04-20)

**Status.** ✅ **Confirmed.** The project runs the **Clerk + Supabase Third-Party Auth** pattern (Pattern C in the rewrite below). Clerk issues the frontend JWT; Supabase Auth consumes it and issues a Supabase UUID that is used as the primary key on `auth.users`, `public.profiles`, and the `cases.user_id` / `cases.owner_user_id` / `cases.creator_user_id` columns.

**Evidence gathered from the Supabase Dashboard:**

1. `cases.user_id` has a FOREIGN KEY to `auth.users.id` (proven in `supabase/migrations/20260314055326_remote_schema.sql`, line 2445).
2. `cases.owner_user_id` and `cases.creator_user_id` have FOREIGN KEYs to `public.profiles.id` (lines 2435, 2440).
3. RLS policies on `cases` use `auth.uid() = user_id` (lines 2582, 2644, 2690) — which means `auth.uid()` must return the same UUID that is stored in `user_id`.
4. `auth.users` is populated with rows whose `raw_user_meta_data` contains `{"sub": "693567ab-1802-4a71-95ae-82e0aa597c53", …}` — a standard Supabase Auth UUID (the `sub` claim of the issued JWT).
5. A `profiles` table exists with columns `id uuid NOT NULL, email text NOT NULL, …` and a trigger `handle_new_user()` that copies every new `auth.users` row into `profiles` with the **same UUID** (line 259: `INSERT INTO public.profiles VALUES (NEW.id, …)`).
6. A `clerk_id` column is present on at least one table (Dashboard observation) and stores the raw Clerk ID (`user_2aBcD3eFgHiJkLmNoPqRsTuV`) as a **convenience reference**; it is **not** used by RLS.

**Architecture in one diagram.**

```
Clerk (browser)                       Supabase Auth                        Supabase tables
──────────────                        ─────────────                        ───────────────
user signs in                         verifies Clerk JWT via JWKS
                        ─────────>    creates/reuses auth.users row
                                      id = <UUID derived from Clerk 'sub'>
                                           │
                                           │  handle_new_user() trigger
                                           ▼
                                      INSERT INTO public.profiles (id = same UUID)
                                           │
                                           ▼
                                      auth.uid() in RLS returns the same UUID
                                           │
                                           ▼
                                      cases.user_id        = auth.users.id  (UUID)
                                      cases.owner_user_id  = profiles.id    (UUID)
                                      cases.clerk_id       = raw Clerk ID   (text, reference only)
```

**Consequences for the server-route template (§9.2).**

Because RLS enforces ownership via `auth.uid()`, **the server route does not need to perform a manual `cases.owner_user_id = X` check**. It just has to:
1. Read the Clerk session (`auth()` from `@clerk/nextjs/server`) — this gives a signed Clerk JWT.
2. Hand that JWT to the Supabase client (`supabase.auth.setSession(...)` or the Clerk–Supabase adapter) so every subsequent query runs under the authenticated user's identity.
3. Call Supabase. RLS rejects anything the user doesn't own.

Compared to the original plan, this **removes one database round-trip per edge-function call** (no pre-read of `cases.owner_user_id`). See §9.2 (now rewritten).

**Consequences for `cases` writes.**

When the frontend creates a case, it must `INSERT` with `user_id = <auth.users.id>`. The easiest way is to issue the INSERT through a Supabase client that already has the Clerk JWT attached — `auth.uid()` is used as the default in the RLS policy `"Enable insert for users based on user_id"` (line 2564). No manual `user_id` injection is needed if the RLS `WITH CHECK` clause is set up correctly.

**Consequences for the `escalation_waitlist` table (§10.5).**

`escalation_waitlist.user_id` is declared `text` in the current §10.5 schema so it could hold a raw Clerk ID. **This must be changed to `uuid` referencing `auth.users.id`** so RLS works the same way as every other table. §10.5 has been updated below.

**State Machine impact.** None on the diagrams. The implementation detail is captured in §9.2 (rewritten) and the State Machine's §7 checklist row 2 (simplified to: "server route forwards Clerk JWT to Supabase; RLS handles ownership").

**Slice 0 implementation note (2026-04-20).** The live code in [lib/auth.ts](../lib/auth.ts) and the Clerk webhook at [app/api/webhooks/clerk/route.ts](../app/api/webhooks/clerk/route.ts) still carry a **Pattern B** fallback (custom `profiles.clerk_id` lookup + `crypto.randomUUID()`) left over from an earlier iteration. Because all current rows in `auth.users`, `public.profiles`, and `public.cases` are test data owned by Elena, **Slice 0 wipes them rather than migrating** — see [docs/runbooks/slice-0-auth-reconciliation.md](runbooks/slice-0-auth-reconciliation.md) for the exact Clerk + Supabase Third-Party Auth setup steps, the env-var checklist, the truncate script, and the three end-to-end smoke tests that must pass before Slice 1 starts. Slice 0 also rewrites `lib/auth.ts` to a two-line `getCurrentUser()` helper and removes the profile-insert branch of the Clerk webhook. No subsequent slice is allowed to reintroduce a custom Clerk→UUID mapping.

### 10.5 ✅ Contact-requests storage for Layer 3 — `escalation_waitlist` table, pending rename to `contact_requests` (locked 2026-04-20, schema expanded 2026-04-21 PM)

**Decision.** A single table in Supabase (no third-party dependency — no Resend-as-storage, no ConvertKit) that captures everything Dance needs to triage a Layer 3 FIDReC-handoff request at a glance. Because §9.9 is an **in-app form filled after the Tier-1 report is generated**, the schema has to hold:
- The user's self-entered identity (name / email / phone), age, and employment status.
- Two FIDReC-qualification booleans (30-day statutory period, final response issued).
- A **snapshot** of the case context at submit time (amount lost, FI name) so Dance sees the number the user saw.
- Foreign keys back to `auth.users` and `public.cases` for RLS + audit.
- An optional free-text message from the user + a free-text `notes` column for Dance.

The table is currently named `escalation_waitlist` (locked 2026-04-20). The Refactor Plan Slice 7 includes an optional follow-up migration to rename it to `contact_requests` for naming consistency with the 2026-04-21 PM Layer 3 design. Until that migration lands, both the route and the hook reference `escalation_waitlist`.

**Schema (migration to be written by Masha).** Updated 2026-04-20 to use Pattern C UUIDs (§10.4) and on 2026-04-21 PM to add the Layer 3 FIDReC-qualification and demographic columns.

```sql
CREATE TABLE public.escalation_waitlist (
  -- Identity + ownership
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                             uuid NOT NULL DEFAULT auth.uid()
                                           REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id                             uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,

  -- User-entered (Group B + C from §9.9.1)
  first_name                          text NOT NULL,
  last_name                           text NOT NULL,
  email                               text NOT NULL,
  phone                               text NOT NULL,
  age                                 int  NOT NULL CHECK (age BETWEEN 13 AND 120),
  employment_status                   text NOT NULL
                                           CHECK (employment_status IN ('professional','retiree','student','other')),
  thirty_days_since_last_fi_reply     boolean NOT NULL,
  fi_issued_final_response            boolean NOT NULL,
  message                             text,                       -- optional additional context (≤ 500 chars, enforced in the route)

  -- Server-side snapshot (Group A from §9.9.1) — frozen at INSERT time
  amount_lost_sgd                     numeric(14, 2),              -- nullable if extract had no amount
  financial_institution               text,                        -- nullable if unknown

  -- Specialist-side triage state
  status                              text NOT NULL DEFAULT 'new'
                                           CHECK (status IN ('new','contacted','onboarded','declined','cancelled')),
  notes                               text,                        -- free-text field for Dance

  -- Timestamps
  created_at                          timestamptz NOT NULL DEFAULT now(),
  updated_at                          timestamptz NOT NULL DEFAULT now(),
  contacted_at                        timestamptz,

  -- One handoff request per user per case (re-submit upserts)
  UNIQUE (user_id, case_id)
);

CREATE INDEX escalation_waitlist_status_idx        ON public.escalation_waitlist (status, created_at DESC);
CREATE INDEX escalation_waitlist_case_id_idx       ON public.escalation_waitlist (case_id);
CREATE INDEX escalation_waitlist_employment_idx    ON public.escalation_waitlist (employment_status);

CREATE TRIGGER escalation_waitlist_set_updated_at
  BEFORE UPDATE ON public.escalation_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

**Notes on the new columns.**
- `age` stored as an integer so Dance can bucket however he likes when triaging. If PII considerations later push us to buckets, add a generated column `age_bucket` and keep `age` for internal use only.
- `employment_status` deliberately kept as a small text enum (via CHECK) rather than a separate lookup table — the four values are stable for MVP and a lookup table would be overkill.
- `thirty_days_since_last_fi_reply` and `fi_issued_final_response` are `NOT NULL` because they're required on the form. They drive FIDReC eligibility — if both are `false`, Dance knows the case isn't ready yet.
- `amount_lost_sgd` is `numeric(14, 2)` and assumed SGD-only for MVP (matches §10.x assumptions). If we later support multi-currency, add `currency text DEFAULT 'SGD'` alongside.
- `financial_institution` is a snapshot string rather than an FK — Masha's `case_extract_runs` returns a free-text institution name, not an ID.

**Row-level security.** Enable RLS. Insert policy: authenticated users may insert rows only where `user_id = auth.uid()` and they own the referenced `case_id` (enforced transitively via RLS on `cases`). Select / update restricted to an admin / specialist role.

```sql
ALTER TABLE public.escalation_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_can_insert_own" ON public.escalation_waitlist
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = escalation_waitlist.case_id
        AND cases.user_id = auth.uid()
    )
  );

CREATE POLICY "users_can_read_own" ON public.escalation_waitlist
  FOR SELECT USING (user_id = auth.uid());

-- Specialist admin role (to be defined) reads everything.
-- CREATE POLICY "specialist_can_read_all" ON public.escalation_waitlist
--   FOR SELECT USING (<role check on profiles.role = 'admin'>);
```

**Server-route shape (Next.js, Pattern C).** The route **never** accepts `user_id`, `amount_lost_sgd`, or `financial_institution` from the client — it snapshots them server-side. RLS rejects any attempt to forge them.

```ts
// app/api/contact-requests/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { createUserClient } from '@/lib/supabase/server';
import { sendContactRequestEmail } from '@/lib/email/contact-request';

const Body = z.object({
  case_id: z.string().uuid(),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(6).max(32),
  age: z.number().int().min(13).max(120),
  employment_status: z.enum(['professional', 'retiree', 'student', 'other']),
  thirty_days_since_last_fi_reply: z.boolean(),
  fi_issued_final_response: z.boolean(),
  message: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  const supabase = await createUserClient();

  // Ownership probe + snapshot read in one round trip (RLS filters to owned cases).
  const { data: snapshot, error: snapshotErr } = await supabase
    .from('cases')
    .select(`
      id,
      institution_name,
      claim_amount,
      latest_extract:case_extract_runs(extract_json, created_at)
    `)
    .eq('id', body.case_id)
    .order('created_at', { referencedTable: 'case_extract_runs', ascending: false })
    .limit(1, { referencedTable: 'case_extract_runs' })
    .maybeSingle();

  if (snapshotErr) return NextResponse.json({ error: snapshotErr.message }, { status: 500 });
  if (!snapshot) return NextResponse.json({ error: 'case_not_found' }, { status: 404 });

  const extract = snapshot.latest_extract?.[0]?.extract_json as any | undefined;
  const amount_lost_sgd =
    extract?.losses?.reported_loss?.amount ??
    snapshot.claim_amount ??
    null;
  const financial_institution =
    extract?.case_meta?.institution_name ??
    snapshot.institution_name ??
    null;

  const { data: row, error: insertErr } = await supabase
    .from('escalation_waitlist')
    .upsert(
      {
        case_id: body.case_id,
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
        phone: body.phone,
        age: body.age,
        employment_status: body.employment_status,
        thirty_days_since_last_fi_reply: body.thirty_days_since_last_fi_reply,
        fi_issued_final_response: body.fi_issued_final_response,
        message: body.message ?? null,
        amount_lost_sgd,
        financial_institution,
      },
      { onConflict: 'user_id,case_id' }
    )
    .select('id')
    .single();

  if (insertErr) {
    const status = insertErr.code === '42501' ? 403 : 500;
    return NextResponse.json({ error: insertErr.message }, { status });
  }

  // Email failures are logged but don't fail the request.
  sendContactRequestEmail({
    id: row!.id,
    case_id: body.case_id,
    name: `${body.first_name} ${body.last_name}`,
    email: body.email,
    phone: body.phone,
    age: body.age,
    employment_status: body.employment_status,
    thirty_days_since_last_fi_reply: body.thirty_days_since_last_fi_reply,
    fi_issued_final_response: body.fi_issued_final_response,
    amount_lost_sgd,
    financial_institution,
    message: body.message,
  }).catch(err => console.error('[contact-requests] email send failed', err));

  return NextResponse.json({ ok: true, id: row!.id }, { status: 201 });
}
```

Key route-level guarantees:
- `user_id` is never in the request body. The `DEFAULT auth.uid()` column default fills it, and RLS rejects forgeries.
- `amount_lost_sgd` / `financial_institution` are **never trusted from the client** — both are pulled server-side via the user-scoped Supabase client from the case the user owns. This is what makes the column values reliable as Dance's single source of truth at triage time.
- The `UNIQUE (user_id, case_id)` + `upsert` means re-submits overwrite rather than creating duplicates. That's intentional — if the user wants to amend their answers (e.g. flip `fi_issued_final_response` to `true` after a letter arrives), the new submission replaces the old one.
- Email failure does not cascade to the HTTP response. The DB row is the source of truth; Dance can re-check the storage table if email delivery fails.

**Notification.** `lib/email/contact-request.ts` wraps a Resend (or equivalent) call that emails `dance@guidebuoy.com` (or whatever inbox Dance chooses) with the full payload in a human-readable template. Out of scope of this doc; spec lives alongside the route in the Refactor Plan Slice 5.

**State Machine impact.** None on the diagram. The `L3-Submitting` state's write target is this table; see SM Diagram 4.

---

### 10.6 ✅ Layer 3 = Tier 2 commerce and WhatsApp (locked 2026-04-26)

**Decision.** Layer 3 and Tier 2 are the same post-Tier-1 surface. The FIDReC handoff form remains the human-in-the-loop path from §9.9. On the same screen, the product also shows specialist recommendation copy and, after Slice 8, two paid add-ons:

| Add-on | Price | Notes |
|---|---:|---|
| Specialist consult | SGD 99 | 30-minute Scam and Fraud / marketplace specialist consult or Q&A. |
| Case pack prep | SGD 800 | Case pack preparation for the FIDReC path. |

**Frontend / backend wiring.**

- Keep the existing persistent WhatsApp `wa.me/6590727915` entry point in the root layout so it is available on public and authenticated routes. Do not add a second global widget.
- WhatsApp is a third-party link only. It is allowed on public pages because it does not instantiate a Supabase client or write anonymous rows.
- The Layer 3 / Tier 2 page should include on-page copy recommending the Scam and Fraud Specialist for consult or Q&A.
- The FIDReC contact form continues to submit to `/api/contact-requests`; it does not call `/api/edge/*` or any Supabase edge function.
- Paid add-ons reuse the existing Stripe checkout + webhook pattern with product metadata distinguishing the SGD 99 consult and SGD 800 case-pack flows. The webhook branch for these add-ons must not call the Layer 2 decision/report worker.
- LinkedIn CTAs and generic "coming soon" waitlist framing remain out of scope.

---

## 11. Glossary (function name → folder name)

| Wiki / informal name | Deployed folder under `supabase/functions/` | Status |
|---|---|---|
| `run_case_extract_v4` | `run_case_extract_v4` | **Active.** Internal version string reads `v3.2555…` — ignore it; the folder name is the contract. |
| `run_case_decision_v1` | `run_case_decision_v1` | **Active — Layer 2 (Tier 1) only** (Masha-confirmed 2026-04-21 PM). Runs on the Render worker after Stripe webhook, before `run_report_selfserve_v1`. |
| `run_report_selfserve_v1` | `run_report_selfserve_v1` | **Active.** Layer 2 only. |
| Tier-0 narrative generator / `run_tier0_summary_v1` | **`bright-function`** | **Active.** Dashboard labels it "tier-0 narrative generator"; folder slug is still `bright-function`. |
| `evidence_processed_v2` | `evidence_processed_v2` | **Active.** Only evidence-processing function. |
| candidate-transactions | `candidate-transactions` | **Masha-internal fallback only** (confirmed 2026-04-21 PM). Not called from the frontend — Masha triggers it from the Supabase Dashboard when `run_case_extract_v4` can't compute the loss correctly. Feeds `compute-loss`. |
| compute-loss | `compute-loss` | **Masha-internal fallback only** (confirmed 2026-04-21 PM). Not called from the frontend — fires from the Supabase Dashboard after `candidate-transactions` when the v4 loss math fails. |
| `run_case_extract_v1` / `_v2` / `_v3` | (archived) | **Archived** 2026-04-21 from Supabase. Repo folders pending deletion. Do not call. |
| `gemini-task` | `gemini-task` | **Archived** 2026-04-21 PM. Do not call. |
| `backfill_embeddings_v1` | `backfill_embeddings_v1` | Admin only; never called from frontend. |
| `decision_url_inbox` | **`url_catalogue`** | Admin only; never called from frontend. |

---

## 12. Source documents consulted

- `docs/.wiki-import/Home.md`
- `docs/.wiki-import/GuideBuoy-Backend-Overview.md`
- `docs/.wiki-import/GuideBuoy-Data-Schema-Reference.md`
- `docs/.wiki-import/Frontend-Integration-Handover.md`
- `docs/.wiki-import/Data-Model-Overview.md`
- `docs/.wiki-import/run_case_extract_v4.md`
- `docs/.wiki-import/run_case_decision_v1.md`
- `docs/.wiki-import/run_report_selfserve_v1.md`
- `docs/.wiki-import/tier‐0-narrative-generator.md`
- `docs/.wiki-import/evidence_processed_v2.md`
- `docs/.wiki-import/backfill_embeddings_v1.md`
- `docs/.wiki-import/decision_url_inbox.md`
- All `*-table.md` and `*-view.md` files under `docs/.wiki-import/` (cases, case_intake, case_narratives, case_extract_runs, case_validation_runs, case_decision_runs, case_documents, case_document_extractions, case_documents_enriched, case_entitlements, user_entitlements, reports, v_latest_validation, v_latest_validation_run).
- Deployed function folders under `supabase/functions/` of this repo (cross-checked names).
- `docs/Project Documentation` (merged offline mirror).
