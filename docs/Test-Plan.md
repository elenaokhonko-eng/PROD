# Test Plan

Last updated: 2026-07-12

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

**Status: Browser QA passed locally on 2026-07-11 after Clerk `supabase` JWT template added `aud: authenticated`, `role: authenticated`, and `supabase_uuid`, and hosted RLS allowed `supabase_uuid` ownership reads.**

Validated on linked Supabase (2026-06-02):

- `run_validation_v1` long smoke (`scripts/sql/run_validation_v1-smoke-long.sql`) — dual-write to `case_validation_gap_items` passes.
- Controlled-error seed (`scripts/sql/controlled-error-seed.sql`) — parent `case_validation_runs` with `status = needs_user`, non-empty `missing_fields`, empty `questions_to_user`, zero gap rows.
- Frontend wiring logic — `deriveInGapPhase`, `validationIndicatesMissingData`, and `GAP_QUESTIONS_FALLBACK_NOTICE` resolve to **S1-GapLoop** with the fallback notice (not the normal gap form).

**Browser QA result** (requires `.env.local` with Supabase + Clerk, signed-in case owner):

- Case ID: `9eafdc9e-9431-4ba1-ae28-b62fd4da9098`
- Dashboard: `/app/case/9eafdc9e-9431-4ba1-ae28-b62fd4da9098/dashboard`
- Passed 2026-07-11: card *We need a bit more* with copy *We found missing information, but couldn't generate follow-up questions. Please try again.* and **Try again**.
- Note: `get_case_eligibility` does not return `latest_validation_run_id` until a decision exists; Layer 1 uses a fallback in `use-validation-run.ts` to load the latest validation by `case_id` when resolved ids are empty.

## 2. Layer 1 Smoke

- Fresh signup creates user-owned `cases` and `case_intake` rows through the user-scoped Supabase client.
- Upload a PDF/PNG/JPEG/DOCX. Confirm `POST /api/evidence/upload` creates an `evidence` row, then `POST /api/cases/:caseId/evidence/process` registers exactly one `case_documents` row and queues processing.
- Confirm unsupported file types are rejected client-side before upload.
- Confirm `case_documents.processing_status` progresses through Realtime, not polling.
- Answer a gap question. Confirm a new extract run is appended and validation refreshes.
- Reach Tier-0 draft. Confirm `case_narratives` renders whichever of `tier0_summary`, `tier0_evidence_checklist`, and `tier0_srf_signal` exists.

## 3. Layer 2 Smoke

**Status: live hosted Supabase E2E passed locally on 2026-07-12** using Masha-seeded case `01eb9245-0bb2-4b08-9469-412850d656a0`.

- Stripe webhook idempotency passed with session `cs_test_slice6_20260712155646`: two signed deliveries returned `200`, exactly one `jobs` row was created.
- `case_entitlements` was upgraded to `plan = self_serve_report`, `source = stripe`, `purchase_ref = cs_test_slice6_20260712155646`.
- `get_case_eligibility` flipped to `eligible_actions.run_report_selfserve = true` after entitlement upgrade.
- `WORKER_RUN_ONCE=1 pnpm.cmd worker` completed job `fd43a04a-7f04-4f97-a5cb-80bffe847421`.
- Worker produced report row `0550ef5b-752d-4648-b428-4ee9e205a469` with `status = COMPLETED`, `report_type = self_serve_v1`.
- Worker report calls intentionally omit `user_id` for now because `reports.user_id` still references `auth.users(id)` while Clerk Pattern C case ownership uses `cases.user_id = public_metadata.supabase_uuid`; the report function supports null `user_id` and report ownership is case-scoped.

- Stripe test checkout upgrades `case_entitlements.plan` to `self_serve_report`.
- Tier 1 checkout must use the new **Basic Case Pack** Stripe price at SGD 18 via `STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD=price_1TsLZdFp6sSKMUXXz5xEbxrA`; the old SGD 99 price `price_1SLOYUFp6sSKMUXXsTXlLdcT` is now reserved for `human_consult_30m`.
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
- After Slice 8, run the SGD 188 `fidrec_tier2_pack` checkout and the separate SGD 99 `human_consult_30m` checkout; confirm neither branch enqueues the Layer 2 decision/report worker.

## 4.1 Slice 8 - Tier 2 Pack QA

Use Tier 2 case `688154e7-9cda-47ef-9cff-a27581766c3a` once Masha confirms the hosted DB has the required FIDReC helper artefacts.

- Confirm a completed Tier 1 report case shows the Layer 3 / Tier 2 surface, not the Layer 1 -> Layer 2 buy-report prompt.
- Confirm `case_entitlements.plan = escalation_pack` or `features.allow_escalation_pack = true` is treated as Tier 2 ready.
- Confirm `POST /api/payments/create-checkout-session` accepts product key `self_serve_report`, uses the SGD 18 Basic Case Pack price, and writes Stripe metadata containing `case_id`, `user_id`, and `product_key`.
- Confirm `POST /api/payments/create-checkout-session` accepts product key `fidrec_tier2_pack`, uses the SGD 188 FIDREC Case Pack price, and writes Stripe metadata containing `case_id`, `user_id`, and `product_key`.
- Confirm the Stripe webhook for `fidrec_tier2_pack` upgrades entitlement to `escalation_pack` / `allow_escalation_pack`, returns quickly, and does not insert a `jobs` row.
- Confirm `GET /api/fidrec/tier2/case-pack-json?caseId=...` requires ownership and Tier 2 entitlement, then returns `submission_pack.executive_summary.narrative` and non-empty `submission_pack.chronology_of_events`.
- Confirm the UI renders the executive summary and chronology/timeline with status and evidence references.
- Confirm PDF download returns `application/pdf` and Markdown download returns `text/markdown`; both must contain the executive summary and chronology.
- Confirm cross-user or unauthenticated requests to JSON/export routes fail.
- Confirm product key `human_consult_30m` uses the SGD 99 consult price and persists the consult purchase/request separately from the Tier 2 pack. Full consult call recording, transcription, and case-narrative insertion remain pending Masha's backend workflow.

## 5. Slice 5 Retest Scenarios

Run these before calling Slice 5 done.

**Status: route-level retest passed locally on 2026-07-11** with corrected Clerk `supabase` JWT claims and hosted Supabase RLS:

- Upload/process contract passed on fresh case `93ef50df-1850-455a-b56e-41daa99b950a`: `POST /api/evidence/upload` returned `{ evidence }`, `POST /api/cases/:caseId/evidence/process` accepted `{ evidenceIds: [evidence.id] }`, returned `results[].document_id`, and service-role verification found exactly one `case_documents` row for the uploaded storage path.
- Gap-answer save passed on controlled case `9eafdc9e-9431-4ba1-ae28-b62fd4da9098`: `PUT /api/cases/:caseId/responses` saved `question_key = incident_date`, `response_type = date`, and service-role verification found no `undefined` / null question key.
- Controlled-error path passed in browser; see **§1.1**.

- Evidence upload record: upload one supported document and confirm `POST /api/evidence/upload` returns `{ evidence }` with an `evidence.id`.
- Evidence processing handoff: confirm the returned `evidence.id` is sent to `POST /api/cases/:caseId/evidence/process` as `{ evidenceIds: [id] }`, the response includes `results[].document_id`, and the document progresses from `uploaded`/`queued` to `ready`.
- Trigger safety: confirm there is no duplicate `case_documents` row from the disabled Supabase storage auto-insert trigger.
- Validation gaps with new table: run a case with rows in `v_case_validation_gap_items`; confirm questions render in `sort_order`.
- Validation gap answer keys: save answers and confirm the request body uses concrete keys such as `incident_date` or `reported_loss.amount`, never `undefined`.
- Validation fallback: use or simulate an older validation run with zero gap-item rows and confirm normalized `questions_to_user` JSON still renders.
- Validation error path: set or encounter `case_validation_runs.status = 'error'` and confirm `error_message` is shown instead of a normal gap panel.
- Controlled-error path: see **§1.1** — browser QA passed locally on 2026-07-11.
- State gates: confirm non-empty `missing_fields` still blocks Tier-0 auto-fire, and empty gaps plus fresh ready evidence allows the Tier-0 path.

## 6. Static Checks

- `rg "v_latest_validation" app lib` should have no production hits.
- `rg "candidate-transactions|compute-loss|gemini-task|run_case_extract_v1|run_case_extract_v2|run_case_extract_v3" app components hooks lib services worker` should have no production call-path hits.
- `rg "force:\\s*true" app lib` should have no production hits.
- `pnpm.cmd exec tsc --noEmit --incremental false` should pass once the existing repo-wide TypeScript issues are cleared.
