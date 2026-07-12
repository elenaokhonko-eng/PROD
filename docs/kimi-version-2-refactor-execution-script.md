# Kimi Execution Script - Version 2.0 Refactor

Use this script for Kimi Code on branch `Version-2.0-Refactor`.

## Operating Rules

1. Read these files before coding:
   - `docs/State-Machine-Refactor-Plan.md`
   - `docs/State-Machine-Workflow.md`
   - `docs/Front-to-Back-End-Integration-Summary.md`
   - `docs/Test-Plan.md`
2. Do not start the next slice until Codex/Dance confirms the current slice tests are green.
3. Keep all active edge function names in `lib/edge-functions.ts`.
4. Do not call Supabase edge functions directly from browser code. Browser code must use app routes.
5. Do not wire `candidate-transactions`, `compute-loss`, `gemini-task`, or `run_case_extract_v1/v2/v3` into any app route, hook, component, or UI.
6. Do not use `force: true` in the MVP UI.
7. Preserve user work. Do not revert unrelated files.
8. Before each handoff, report changed files, migrations, env vars, commands run, and remaining risks.

## Current Slice 5 Contract

The current evidence upload contract is no longer `caseDocumentId` from `/api/evidence/upload`.

Use this flow:

1. `POST /api/evidence/upload` with multipart form data.
2. Expect response `{ evidence }` with `evidence.id`.
3. `POST /api/cases/:caseId/evidence/process` with:

```json
{ "evidenceIds": ["<evidence.id>"] }
```

4. Expect response with `results[].document_id`.
5. Realtime on `case_documents` drives the UI from `uploaded`/`queued` to `ready`.

Do not restore the old `caseDocumentId` contract.

## Slice 5 - Verify And Finish Wiring

Goal: make Slice 5 green after Masha's Supabase validation-gap/error-state fix.

Tasks:

1. Verify `hooks/state-machine/layer1/use-upload-evidence.ts` uses the new `evidence -> process` contract.
2. Verify docs match that contract:
   - `docs/Test-Plan.md`
   - `docs/State-Machine-Refactor-Plan.md`
   - `docs/State-Machine-Workflow.md`
   - `docs/Front-to-Back-End-Integration-Summary.md`
3. Verify `useValidationRun` still:
   - reads `get_case_eligibility.resolved_ids.validation_run_id`
   - falls back to latest `case_validation_runs` by `case_id` when resolved ids are empty
   - queries `v_case_validation_gap_items` by `validation_run_id`
   - falls back to normalized `questions_to_user`
   - surfaces `case_validation_runs.error_message`
4. Verify gap answer saves send real question keys and typed `response_type`.
5. Verify Tier-0 auto-fire remains blocked when validation has errors or missing fields.

Run before handoff:

```powershell
pnpm.cmd --version
pnpm.cmd exec tsc --noEmit --incremental false
rg "v_latest_validation" app lib
rg "candidate-transactions|compute-loss|gemini-task|run_case_extract_v1|run_case_extract_v2|run_case_extract_v3" app components hooks lib
rg "force:\s*true" app lib
rg "caseDocumentId" hooks/state-machine app/api/evidence app/app/case docs/Test-Plan.md docs/State-Machine-Refactor-Plan.md docs/State-Machine-Workflow.md docs/Front-to-Back-End-Integration-Summary.md
```

Manual/browser QA to request from Codex/Dance:

1. Controlled missing-questions case:
   - Case ID: `9eafdc9e-9431-4ba1-ae28-b62fd4da9098`
   - URL: `/app/case/9eafdc9e-9431-4ba1-ae28-b62fd4da9098/dashboard`
   - Expected card: `We need a bit more`
   - Expected copy: `We found missing information, but couldn't generate follow-up questions. Please try again.`
   - Expected button: `Try again`
2. Upload one supported PDF/PNG/JPEG/DOCX:
   - upload route returns `{ evidence }`
   - process route returns `results[].document_id`
   - exactly one `case_documents` row exists for the storage path
   - Realtime advances document status to `ready`
3. Save one gap answer and confirm the request body never uses `undefined` as `question_key`.

Stop after Slice 5 and hand off to Codex/Dance.

## Slice 6 - Background Jobs And Stripe Tier-1 Worker

Goal: implement the post-payment job system. The webhook must enqueue work; the worker performs decision/report.

Tasks:

1. Add a Supabase migration for `public.jobs`.
   - Include `id`, `case_id`, `user_id`, `job_type`, `status`, `payload`, `error`, retry/lock timestamps, `created_at`, `updated_at`.
   - Use `job_type = 'post_payment_report_generation'`.
   - Use statuses such as `queued`, `running`, `completed`, `failed`.
   - Add indexes for queued polling and case lookup.
   - Add RLS policies so users can read their own case jobs and service role can manage jobs.
2. Rewrite Stripe webhook completion handling:
   - verify signature
   - mark `payments.payment_status = 'completed'`
   - upsert `case_entitlements.plan = 'self_serve_report'`
   - insert one queued `jobs` row
   - return quickly
   - do not call decision/report from the webhook
3. Build the Render worker/cron path.
   - Poll `jobs where status = 'queued' order by created_at for update skip locked`.
   - Set `running`, `started_at`, and lock metadata.
   - R14a: if new documents exist since the last decision, call `/api/edge/evidence`.
   - R14b: if new intake or evidence reran, call `/api/edge/extract`.
   - Always call `/api/edge/decision`, then `/api/edge/report`.
   - Update `completed` or `failed` with error and retry count.
4. Keep browser Layer 2 hooks passive:
   - browser polls job status/read models only
   - browser never calls `/api/edge/decision` or `/api/edge/report`
5. Update docs and env var notes for any worker secret, base URL, cron command, and Render setup.

Run before handoff:

```powershell
pnpm.cmd exec tsc --noEmit --incremental false
rg "/api/edge/decision|/api/edge/report" hooks components app/app
rg "from\(['\"]jobs['\"]\)|public.jobs|post_payment_report_generation" app lib hooks scripts supabase
rg "checkout.session.completed" app/api
```

Manual/browser QA to request from Codex/Dance:

1. Stripe test card `4242 4242 4242 4242`.
2. Confirm `case_entitlements.plan = 'self_serve_report'`.
3. Confirm one queued `jobs` row appears.
4. Confirm webhook does not call decision/report directly.
5. Confirm worker moves job `queued -> running -> completed`.
6. Confirm report appears through Layer 2 UI via Realtime/read hooks.

Stop after Slice 6 and hand off to Codex/Dance.

## Slice 7 - Cleanup And Contract Guards

Goal: remove obsolete paths and add guardrails so the old call graph cannot return.

Tasks:

1. Remove or archive obsolete active repo folders:
   - `supabase/functions/gemini-task`
   - `supabase/functions/run_case_extract_v1`
   - `supabase/functions/run_case_extract_v2`
   - `supabase/functions/run_case_extract_v3`
   - Preserve `_archive` copies if the repo policy wants archived evidence.
2. Remove obsolete app routes, Pattern B remnants, and legacy waitlist remnants only after verifying current auth/contact flow still works.
3. Add `pnpm check:sm`.
   - Prefer a cross-platform Node script over shell-only grep.
   - Check no production app path uses `v_latest_validation`.
   - Check obsolete edge names are not called from `app`, `components`, `hooks`, `lib`.
   - Allow audit-only constants/comments in `lib/edge-functions.ts` only if the script explicitly documents that exception.
   - Check no `force: true` in `app` or `lib`.
   - Check no direct `functions/v1` calls outside `app/api/edge/*/route.ts` and documented server/worker exceptions.
4. Run Appendix B.10 E2E steps 1-11.

Run before handoff:

```powershell
pnpm.cmd check:sm
pnpm.cmd exec tsc --noEmit --incremental false
rg "gemini-task|run_case_extract_v1|run_case_extract_v2|run_case_extract_v3" supabase/functions app components hooks lib
rg "v_latest_validation" app lib
rg "force:\s*true" app lib
```

Stop after Slice 7 and hand off to Codex/Dance.

## Slice 8 - Layer 3 / Tier 2 Commerce

Goal: add the current Slice 8 Tier 2 path on the existing post-report Layer 3 surface.

Tasks:

1. Keep Layer 3 and Tier 2 as the same post-Tier-1 screen.
2. Keep the existing global WhatsApp link in `app/layout.tsx`; do not add a duplicate global widget.
3. Treat `case_entitlements.plan = 'escalation_pack'` and/or `features.allow_escalation_pack = true` as a valid Layer 3 / Tier 2 state. Do not route that case back to the old self-serve buy-report flow.
4. Add the SGD 188 FIDReC Tier 2 pack offer with product key `fidrec_tier2_pack`.
5. Keep the SGD 99 human consult as a separate offer with product key `human_consult_30m`. It is a human advice/direction call, not the automated pack. Do not implement call recording/transcription yet unless Masha provides the backend contract.
6. Extend checkout creation to accept known product keys and Stripe price env vars:
   - `self_serve_report` = Basic Case Pack, SGD 18, env `STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD`, price `price_1TsLZdFp6sSKMUXXz5xEbxrA`
   - `fidrec_tier2_pack` = FIDREC Case Pack, SGD 188, env `STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD`, price `price_1TsLY5Fp6sSKMUXXdHFwRsny`
   - `human_consult_30m` = Human in the Loop Consultation, SGD 99, env `STRIPE_PRICE_ID_HUMAN_CONSULT_30M_SGD`, price `price_1SLOYUFp6sSKMUXXsTXlLdcT`
   - Treat `STRIPE_PRICE_ID_SGD` as legacy/ambiguous. The old SGD 99 price ID has been repurposed for consultation and must not drive Tier 1.
7. Add Stripe metadata discriminator for `product_key`, `case_id`, and `user_id`.
8. Add webhook branches:
   - `self_serve_report`: Basic Case Pack, enqueue Layer 2 job.
   - `fidrec_tier2_pack`: persist purchase and set entitlement to `escalation_pack` / `allow_escalation_pack`; do not enqueue a Layer 2 job.
   - `human_consult_30m`: persist purchase/request for operations; do not enqueue a Layer 2 job.
9. Use the existing FIDReC Tier-2 helpers:
   - `app/api/fidrec/tier2/case-pack-json/route.ts`
   - `lib/server/fidrec/generate-case-pack-json.ts`
   - `lib/server/fidrec/build-fidrec-submission-pack.ts`
10. Harden `GET /api/fidrec/tier2/case-pack-json` so it checks ownership and `assertTier2Eligible(caseId)`.
11. Add `GET /api/fidrec/tier2/case-pack-export?caseId=...&format=pdf|md`.
    - PDF response: `application/pdf`, downloadable attachment.
    - Markdown response: `text/markdown`, downloadable attachment for AI compatibility.
    - Both exports must use the same generated pack as the JSON route.
12. Add Layer 3 UI for Tier 2 ready state:
    - executive summary preview
    - chronology/timeline preview
    - loading/error states
    - PDF and Markdown download buttons
13. Use Tier 2 test case `688154e7-9cda-47ef-9cff-a27581766c3a` for local/browser QA once Masha confirms hosted DB artefacts are present.

Run before handoff:

```powershell
pnpm.cmd check:sm
pnpm.cmd exec tsc --noEmit --incremental false
rg "fidrec_tier2_pack|human_consult_30m|escalation_pack|case-pack-export|tier2|fidrec" app components hooks lib supabase
```

Manual/browser QA to request from Codex/Dance:

1. With a completed self-serve report, Layer 3 shows the Tier 2 pack and consult surface.
2. `escalation_pack` entitlement shows Tier 2 ready, not buy-report.
3. SGD 18 `self_serve_report` checkout uses the new Basic Case Pack price and still enqueues the Layer 2 job.
4. SGD 188 `fidrec_tier2_pack` checkout succeeds in Stripe test mode and persists entitlement state.
5. SGD 99 `human_consult_30m` checkout succeeds in Stripe test mode and persists consult request/purchase state.
6. Neither add-on enqueues the Layer 2 decision/report worker.
7. Tier 2 JSON route returns executive summary and chronology.
8. PDF and Markdown downloads work and contain the same pack content.
9. WhatsApp remains visible globally and does not require login on public routes.

Stop after Slice 8 and hand off to Codex/Dance.

## Handoff Format

At the end of each slice, report:

```text
Slice:
Summary:
Changed files:
New migrations:
New/changed env vars:
Commands run:
Manual QA performed:
Known risks:
Ready for Codex/Dance test: yes/no
```
