# Test Plan

Last updated: 2026-06-02

This document consolidates the project test plan. The canonical workflow contract still lives in [State-Machine-Workflow.md](./State-Machine-Workflow.md), and implementation gates still live in [State-Machine-Refactor-Plan.md](./State-Machine-Refactor-Plan.md). This file is the quick execution checklist for local QA.

## 1. Validation Gap Items

Run after a case produces validation gaps from `run_validation_v1`.

- Confirm the frontend reads `case_validation_runs` through `get_case_eligibility.resolved_ids.validation_run_id`, then selects the parent row by primary key.
- Confirm `v_case_validation_gap_items` is queried by `validation_run_id` and rendered in `sort_order`.
- Confirm rendered answers are keyed by real field keys such as `incident_date` and `reported_loss.amount`; there must be no `undefined` answer key in the request body.
- Confirm typed controls render from `expected_answer_type`: date/date-time, money/number, boolean yes/no, single choice, multi choice, textarea, text, and file-upload prompt.
- Confirm saved responses use `response_type` from normalized `field_type`, not always `text`.
- Confirm fallback: for an older validation run with no rows in `v_case_validation_gap_items`, `questions_to_user` JSON still renders after normalization.
- Confirm error path: when `case_validation_runs.status = 'error'`, the gap area shows `error_message` and Tier-0 auto-fire does not run.
- Confirm cache invalidation after extract includes parent validation and validation gap-items query keys.

### 1.1 Controlled-error gap UI (missing questions)

**Status: backend + logic validated; browser QA pending.**

Validated on linked Supabase (2026-06-02):

- `run_validation_v1` long smoke (`scripts/sql/run_validation_v1-smoke-long.sql`) — dual-write to `case_validation_gap_items` passes.
- Controlled-error seed (`scripts/sql/controlled-error-seed.sql`) — parent `case_validation_runs` with `status = needs_user`, non-empty `missing_fields`, empty `questions_to_user`, zero gap rows.
- Frontend wiring logic — `deriveInGapPhase`, `validationIndicatesMissingData`, and `GAP_QUESTIONS_FALLBACK_NOTICE` resolve to **S1-GapLoop** with the fallback notice (not the normal gap form).

**Browser QA pending** (requires `.env.local` with Supabase + Clerk, signed-in case owner):

- Case ID: `9eafdc9e-9431-4ba1-ae28-b62fd4da9098`
- Dashboard: `/app/case/9eafdc9e-9431-4ba1-ae28-b62fd4da9098/dashboard`
- Expected: card *We need a bit more* with copy *We found missing information, but couldn't generate follow-up questions. Please try again.* and **Try again**.
- Note: `get_case_eligibility` does not return `latest_validation_run_id` until a decision exists; Layer 1 uses a fallback in `use-validation-run.ts` to load the latest validation by `case_id` when resolved ids are empty.

## 2. Layer 1 Smoke

- Fresh signup creates user-owned `cases` and `case_intake` rows through the user-scoped Supabase client.
- Upload a PDF/PNG/JPEG/DOCX. Confirm `POST /api/evidence/upload` creates exactly one `case_documents` row after Storage upload.
- Confirm unsupported file types are rejected client-side before upload.
- Confirm `case_documents.processing_status` progresses through Realtime, not polling.
- Answer a gap question. Confirm a new extract run is appended and validation refreshes.
- Reach Tier-0 draft. Confirm `case_narratives` renders whichever of `tier0_summary`, `tier0_evidence_checklist`, and `tier0_srf_signal` exists.

## 3. Layer 2 Smoke

- Stripe test checkout upgrades `case_entitlements.plan` to `self_serve_report`.
- Webhook inserts a queued `jobs` row and returns quickly; it must not call decision/report edge routes directly.
- Render worker progresses job status and calls decision/report through `/api/edge/*`.
- Realtime advances the UI from decision running to report drafting to report ready.

## 4. Layer 3 Smoke

- Submit the FIDReC handoff form with identity, age, employment status, both qualification booleans, and optional message.
- Confirm the request body does not include `user_id`, `amount_lost_sgd`, or `financial_institution`.
- Confirm the server snapshots amount and financial institution from the latest extract and upserts one contact-request row per `(user_id, case_id)`.
- Confirm re-submit updates the existing row.
- Confirm the contact form path does not call `/api/edge/*`.
- Confirm the persistent WhatsApp link remains available on public and authenticated routes without requiring login, and that there is no duplicate global widget.
- On the Layer 3 / Tier 2 screen, confirm Scam and Fraud Specialist consult / Q&A recommendation copy is visible.
- After Slice 8, run SGD 99 specialist consult and SGD 800 case-pack Stripe test checkouts; confirm the webhook branches do not enqueue the Layer 2 decision/report worker.

## 5. Slice 5 Retest Scenarios

Run these before calling Slice 5 done.

- Evidence upload direct insert: upload one supported document and confirm exactly one `case_documents` row is created by `POST /api/evidence/upload`.
- Evidence processing handoff: confirm the returned `caseDocumentId` is sent to `/api/edge/evidence`, then the document progresses from `pending` to `ready`.
- Trigger safety: confirm there is no duplicate `case_documents` row from the disabled Supabase storage auto-insert trigger.
- Validation gaps with new table: run a case with rows in `v_case_validation_gap_items`; confirm questions render in `sort_order`.
- Validation gap answer keys: save answers and confirm the request body uses concrete keys such as `incident_date` or `reported_loss.amount`, never `undefined`.
- Validation fallback: use or simulate an older validation run with zero gap-item rows and confirm normalized `questions_to_user` JSON still renders.
- Validation error path: set or encounter `case_validation_runs.status = 'error'` and confirm `error_message` is shown instead of a normal gap panel.
- Controlled-error path: see **§1.1** — browser QA still pending.
- State gates: confirm non-empty `missing_fields` still blocks Tier-0 auto-fire, and empty gaps plus fresh ready evidence allows the Tier-0 path.

## 6. Static Checks

- `rg "v_latest_validation" app lib` should have no production hits.
- `rg "candidate-transactions|compute-loss|gemini-task|run_case_extract_v1|run_case_extract_v2|run_case_extract_v3" app components hooks lib services worker` should have no production call-path hits.
- `rg "force:\\s*true" app lib` should have no production hits.
- `pnpm.cmd exec tsc --noEmit --incremental false` should pass once the existing repo-wide TypeScript issues are cleared.
