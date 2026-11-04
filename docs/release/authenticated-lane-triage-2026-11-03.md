# Authenticated lane triage (from 2026-11-03)

Lane: `tests/e2e/playwright.authenticated.config.ts` against staging (`guidebuoy-staging-web.onrender.com`), fixtures from
`scripts/seed-harbor-staging-fixtures.ts` (synthetic cases for user-a, user-b and deletion-user only). Each run: staging
web and worker on the run's commit, fresh seed, version variables in sync.

## Runs

| Run | Commit | Tests | Passed | Failed | Skipped by design | Not run |
|---|---|---|---|---|---|---|
| 1 | `8420d8c` | 160 | 25 | 87 | 39 | 9 |
| 2 | `bbce218` | 172 | 110 | 10 | 48 | 4 |
| 3 | `ab1e25b` | 172 | 114 | 10 | 48 | 0 |
| 4 | `99d6e4c` | 172 | 122 | 2 | 48 | 0 |
| 5 | `83dc9a3` | 172 | 123 | 1 | 48 | 0 |

"Skipped by design": tests that change data or call providers run once, on `chromium-1440`. Run 2 onwards includes the
new Tier 2 access tests (3 tests × 4 projects).

## Open

| # | Test | Status | Question |
|---|---|---|---|
| Q2 | slice5 "upload uses evidence row -> process route -> case document" | Failing. Decision (2026-11-04): option (a), keep the evidence list with per-file statuses visible beside "Preparing your free draft", with an option to add files. Held until Elena's walkthrough section 4 confirms it | The upload, process route, case document and worker job all succeed (document `ready`, job `completed`). The test then waits for the per-file "Ready" badge, but as soon as one document is ready and intake is complete the state machine moves the case to "Preparing your free draft" and the upload panel (with the badge) is gone. The screen spec lists per-file "ready" among dashboard evidence states but doesn't say whether the user must see it before the case moves on. Either keep the evidence list (with statuses) visible after the first ready document (app change), or accept the move to draft-pending as the confirmation (test change). |

Watch item: `use-auto-refire-extract` and `use-tier0-auto-fire` also call cookie-authenticated routes on page load and
could hit the same expired-cookie race as D5. Not seen in any run.

## Follow-ups from the run 5 review (2026-11-04)

**AI model health check.** `lib/server/ai/model-health.ts` and Edge function `ai_model_health_v1` check every configured
model at startup, hourly and on `/api/health/release` (503 `AI model unavailable: …`, `ai_model_unavailable` log line,
email to `ADMIN_EMAIL`). Staging, all 10 models answered 200: app `gemini-3.8-flash`, `gpt-4.1-mini`,
`text-embedding-3-small`; Edge `gemini-3.8-flash` (evidence), `gpt-4.1-mini` (extract, decision, self-serve report),
`text-embedding-3-small` (decision, backfill), `gpt-4o-mini` (Tier 0). A forced retired ID returned 404 and failed the
check. `tests/contracts/ai-models.test.ts` fails if an Edge function uses a model the check doesn't cover.

**Column references the checker can't resolve** (now listed by `scripts/check-supabase-columns.ts`), checked by hand
against the staging schema:

| Reference | Why it isn't checked automatically | Columns | Result |
|---|---|---|---|
| `app/api/contact-requests/route.ts:59` embedded `latest_extract:case_extract_runs(extract_json, created_at)` | Embedded relation | `case_extract_runs.extract_json`, `created_at`; one foreign key `case_id → cases.id`, so the embed is unambiguous | Valid |
| `app/api/contact-requests/route.ts:59` `.order('created_at', { referencedTable: 'case_extract_runs' })` | Ordering on the embedded table | `case_extract_runs.created_at` | Valid |
| `app/api/router/session/handlers.ts:108`, `:122`, `:227` `.select(PUBLIC_SESSION_COLUMNS)` | Column list in a constant | 15 `router_sessions` columns, `id` … `status` | Valid |
| `app/api/router/session/handlers.ts:169`, `:185` `.select(INTERNAL_SESSION_COLUMNS)` | Column list in a constant | The 15 above plus `converted_to_user_id` | Valid |
| `hooks/state-machine/layer1/use-case-documents-realtime.ts:25` `.select(CASE_DOCUMENT_SELECT)` | Column list in a constant | 22 `case_documents` columns | Valid; also pinned by `tests/database/client-columns.test.sql` and `tests/contracts/case-document-columns.test.ts` |

## Fixed

### App defects

| # | Defect | Fix | Commit | Regression test |
|---|---|---|---|---|
| D1 | Every dashboard's document query selected `case_documents.created_at` (no such column): 400, document list never loaded | Select real columns, order by `upload_date` (newest first) | `e58e449` | `tests/database/client-columns.test.sql`, `tests/contracts/case-document-columns.test.ts`; repo-wide `scripts/check-supabase-columns.ts` in CI (896 references, all valid) |
| D2 | Tier 2 pack/export: owners got 401 (routes rejected the Supabase bearer the app sends) | Accept the bearer only after Supabase verifies it (`current_app_user_id()`), or the cookie session | `bbce218` | `tier2-pack-access.spec.ts`: owner 200 (bearer and cookie), other user 403/404 with no pack, altered claim 401 |
| D3 | Retired AI models: evidence processing (`gemini-2.5-flash`) and transcription (`gemini-2.5-pro`) returned 404 for the new keys; staging `OPENAI_MODEL=GPT-4.1-mini` is a 404 | Default to `gemini-3.8-flash`; transcription uses `GOOGLE_GENERATIVE_AI_MODEL`; lower-case `OPENAI_MODEL` | `ab1e25b` (+ Edge function `evidence_processed_v2` deployed to staging) | `tests/contracts/ai-models.test.ts`; upload processed to `ready` in 15 s after the fix |
| D4 | Cross-user case update returned 400 with a database message | `maybeSingle()`, 404 without saying whether the case exists | `ab1e25b` | ownership-claims "cross-user zero-row write" |
| D5 | Capabilities call could send an expired session cookie on load: intermittent 401 | Wait for Clerk, refresh before the first call, retry once after a forced refresh | `99d6e4c`, `83dc9a3` | state-family tests (console must be clean); not seen in run 5 |

### Test harness

| # | Defect | Fix | Commit |
|---|---|---|---|
| H1 | API calls reused a Clerk session cookie older than its ~60 s lifetime | `refreshClerkSession()` before context API calls | `bbce218` |
| H2 | Token read before Clerk was ready | `waitForClerkSession()` | `bbce218` |
| H3 | Stripe Checkout text read before render | Wait for the amount text | `bbce218` |
| H4 | Upload test's 120 s processing wait exceeded the 60 s test limit | Per-test timeout | `ab1e25b` |
| H5 | Handoff mock missed Next's `?_rsc=` request; init script re-planted the story after the app cleared it | Match by path; plant once | `ab1e25b`, `99d6e4c` |

### Out-of-date tests (expected behaviour from the current app, spec or schema)

| # | Test | Change |
|---|---|---|
| S1–S3 | state families | Current headings: "Get your Bank Pack", "Checking your case information", "Preparing your automated report" |
| S4–S5 | checkout-failures | "Get Bank Pack" button; "Confirming payment" |
| S6–S7 | preservation | Current invitation and case-not-found messages |
| S8 | preservation (settings) | Self-service deletion is deliberately disabled: assert the disabled control, its reason, and no call to the delete endpoint |
| S9 | slice5 gap answer | Exact match (title text also starts the description) |
| S10 | slice5 upload | Answer the six intake questions first, as the app requires |
| S11 | privacy deletion request | Initial status is `pending` (schema CHECK has no `queued`); also assert nothing was deleted |
| S12 | ownership-claims worker paths | Worker-only functions refuse non-worker callers with 403 "This function is worker-only" (as the preview handshake suite pins) |
| Q1 | preservation handoff | Starts at `/onboarding`, the authenticated bootstrap in `docs/harbor-ui/route-and-cta-matrix.md` |

No test was deleted, skipped or quarantined.
