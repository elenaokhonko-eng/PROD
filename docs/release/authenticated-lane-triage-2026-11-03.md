# Authenticated lane: first live run, triage (2026-11-03)

Run: `tests/e2e/playwright.authenticated.config.ts` against staging (`guidebuoy-staging-web.onrender.com`, release head
`8420d8c`), fixtures from `scripts/seed-harbor-staging-fixtures.ts` (synthetic cases for user-a, user-b and
deletion-user only). 40 tests × 4 browser projects = 160.

**Result:** 25 passed, 87 failed, 39 skipped by design (mutating tests run once, on `chromium-1440`), 9 did not run
(serial suites stopped after an earlier failure).

Nothing has been fixed yet. Each failure below is classified with one line of evidence and the patch it needs.
Rerun after fixes: rebuild fixtures (runbook "Rebuild staging test data"), then run the lane.

## App defects (block G3b)

| # | Defect | Evidence | Tests affected | Patch |
|---|---|---|---|---|
| D1 | Every case dashboard requests a column that doesn't exist | `hooks/state-machine/layer1/use-case-documents-realtime.ts:28` selects `case_documents.created_at`; PostgREST returns 400 `42703 column case_documents.created_at does not exist` (the table has `upload_date`). Seen on every seeded dashboard. | state families layer1Intake, layer1Gap, layer1Evidence, layer2Ready, layer2Failed, layer3Unavailable, layer3Tier2 (correct state text renders; they fail only on this console error) | Remove `created_at` from the select (order/compare by `upload_date`). Users: the document list query fails, so documents may not load or refresh on the dashboard. |
| D2 | Tier 2 pack can't load for the case owner | `hooks/state-machine/layer3/use-tier2-pack.ts:29` sends the Supabase-template JWT as `Authorization: Bearer`; `app/api/fidrec/tier2/case-pack-json/route.ts` authenticates with Clerk (`getCurrentUser`), which rejects that header: 401 `Unauthorized` for a signed-in owner. Same pattern in `use-case-pack-export.ts`. | layer3Tier2 (401 console error); the Tier 2 panel on any escalation-pack case | Send no Authorization header to Clerk-authenticated routes (cookies), or make these routes accept the bearer like `job-status` does. Note the inconsistency: `create-checkout-session` and `job-status` require the bearer (cookie-only gets 401 "Missing bearer token"), while the Tier 2 routes reject it. Pick one convention. |

Checked and working: checkout with the app's own bearer header returns 200 and a Stripe test URL.

## Test harness defects (hide real results; fix first)

| # | Defect | Evidence | Tests affected | Patch |
|---|---|---|---|---|
| H1 | API calls reuse a Clerk session token older than about 60 s | `context.request.*` sends the stored `__session` cookie; staging returns 401 `Unauthorized`. A browser page refreshes the session, a request context doesn't (same fix already applied in `scripts/verify-harbor-preview-release.ts`). | ownership-claims:27 (and :40, :62 not run, serial), privacy:20, privacy:63, expired-collaborator:20 (got 401, expects 403/404), external-handshakes:8 (SMTP) | Before API calls, open a page in that context and wait for `window.Clerk.session` (a shared fixture helper), or call the API through `page.request` after that. |
| H2 | Token read before Clerk is ready | `clerk?.session?.getToken(...)` returns null: ownership-claims:16 on webkit-mobile-390 (claim null), checkout-provider S$188 ("Clerk Supabase token must be available"). | 2 | Wait for `window.Clerk?.session` before `getToken`. |
| H3 | Stripe Checkout text read before it renders | checkout-provider S$18: on `checkout.stripe.com`, `body.innerText()` is `""`. | 1 | Wait for the amount element or `toContainText` with a timeout instead of a one-off read. |

## Stale tests (app copy or contract changed; expected behaviour is clear)

| # | Test | Expects | App now | Patch |
|---|---|---|---|---|
| S1 | state transitionBuyReport | "Buy the full report" | "Get your Bank Pack" (`components/state-machine/transition/buy-report-cta.tsx`) | Update `expectedStateText` |
| S2 | state layer2Running | "Analysing your case" | "Checking your case information" (`layer2/decision-progress.tsx`) | Update `expectedStateText` |
| S3 | state layer2Drafting | "Drafting your complaint report" | "Preparing your automated report" (`layer2/report-drafting.tsx`) | Update `expectedStateText` |
| S4 | checkout-failures:8 | button `/buy.*report\|continue.*report/i` | "Get Bank Pack" | Update locator |
| S5 | checkout-failures:26 | `/confirming your payment\|payment received/i` | "Confirming payment" (`transition/payment-success-landing.tsx`) | Update matcher |
| S6 | preservation:67 | "Invalid or expired invitation" | "This invitation is invalid, expired, or unavailable to this account." (`app/(auth)/invite/[token]/page.tsx:59`) | Update text; URL assertion is still right |
| S7 | preservation:78 | `/case was not found/i` | "Case not found. We couldn't find this case, or the signed-in account does not have access." Behaviour is correct (no data, no redirect). | Update matcher |
| S8 | preservation:36 | a "Delete Account" button and confirmation | Settings shows "Data deletion … not currently available" by design (`app/(case)/app/settings/_components/settings-client.tsx:129-137`) | Assert the export flow and the disabled deletion state |
| S9 | slice5:117 | `getByText('A few more details')` | Matches the card title and its description (strict-mode violation) | `{ exact: true }` |
| S10 | slice5:59 | "Upload supporting evidence" on a fresh disposable case | Intake (6 answers, `lib/intake-completion.ts`) now comes first; a bare case shows "Tell us about your complaint" | Seed the six intake responses in the test's disposable case |

Predicted but not reached (blocked by H1): privacy:83 expects deletion status `queued`; the RPC writes `pending` and the
table CHECK has no `queued`. ownership-claims:40 expects 403/404 on a cross-user PUT; `app/api/cases/[caseId]/details/route.ts:53-59`
may return 400 on zero rows. Both need checking after H1.

## Needs a product decision

| # | Test | Question |
|---|---|---|
| Q1 | preservation:7 (anonymous narrative handoff) | The test stores the pending narrative and opens `/`, expecting a redirect to the new case. The app now consumes `gb_pending_narrative` on `/onboarding` (`app/(auth)/onboarding/page.tsx`) and `/` stays put. Is `/onboarding` the contract (update the test) or should a signed-in `/` with a pending narrative continue the handoff (app change)? |

## Seed data (agent's own; will be corrected in the seed script)

| Fixture | Renders | Should render |
|---|---|---|
| layer1DraftPending | "Upload supporting evidence" | "Preparing your free draft" |
| layer1FreeDraft | "Preparing your free draft" | "Your free triage draft" |

## Passing

authenticated-preflight (4/4), state "completed intake remains at evidence after refresh…" (4/4), slice5 "missing-questions
fallback notice" (4/4), slice7 "keeps unapproved human support inactive" (4/4), ownership-claims "supabase_uuid claim"
(3/4), and on chromium-1440: checkout-provider disabled/unknown keys, blocked second checkout (paid, partially refunded,
refunded, disputed), concurrent reservation; evidence-validation (all 3 rejection cases).
