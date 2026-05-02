# Test Plan

Last updated: 2026-05-02

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

## 5. Static Checks

- `rg "v_latest_validation" app lib` should have no production hits.
- `rg "candidate-transactions|compute-loss|gemini-task|run_case_extract_v1|run_case_extract_v2|run_case_extract_v3" app components hooks lib services worker` should have no production call-path hits.
- `rg "force:\\s*true" app lib` should have no production hits.
- `pnpm.cmd exec tsc --noEmit --incremental false` should pass once the existing repo-wide TypeScript issues are cleared.
