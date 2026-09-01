# Harbor release test handoff

## Status and guardrails

- Preparation only. No item in this packet is release-candidate evidence.
- Current preparation head is `28a155ec9113f06a6b0ff7cc72a0ee1d89687855`; this is a draft readiness checkpoint, not a promotion candidate.
- Draft test updates are preserved in this test worktree and remain pending formal execution assignment.
- No preview deployment, live-provider evidence collection, or non-local migration execution has occurred.
- On formal assignment, bind to one exact integrated SHA, set `HARBOR_RELEASE_SHA`, run the matrix below, and route product failures back to owning agents instead of changing product/backend behavior in the test branch.

## Draft inventory

| Area | Files | Intended coverage | Evidence class |
|---|---|---|---|
| Lane configuration | `playwright.config.ts`, `tests/e2e/config.ts`, `tests/e2e/playwright.*.config.ts`, `tests/e2e/fixtures/harbor-test.ts` | Public, synthetic, authenticated and preview lanes; 390/768/1440; Chromium and mobile WebKit; exact-SHA checks; automatic production-origin blocking in every authenticated browser context | Configuration |
| Run identity and reporting | `tests/e2e/evidence/run-context.ts`, `tests/e2e/reporters/harbor-evidence-reporter.ts`, `tests/release/harness-guards.test.ts` | SHA/environment/worker identity, fail-closed preview guards, evidence classification, project identity, redaction and artifacts | All lanes |
| Public UI | `tests/e2e/public/*.spec.ts`, `tests/e2e/fixtures/public-routes.ts` | Public/auth/canonical routes, exact auth-copy assertions in configured and credential-withheld modes, FAQ/contact contract checks, resources unavailable/ready states, disabled-service surfaces, reviewed Windows visual baselines, overflow, console/hydration errors, keyboard, dialog, focus, reduced motion and contrast | Local/static |
| Router | `tests/e2e/router/router-flow.spec.ts` | Type/voice story, local-draft restore, sign-up handoff, expired-session replacement, offline handoff denial, and catch-up/start-fresh recovery | Synthetic-provider |
| Authenticated contract | `tests/e2e/authenticated/*.spec.ts`, `tests/e2e/slice5.spec.ts`, `tests/e2e/slice7.spec.ts` | Claims/RLS, ownership, states, checkout, collaboration, evidence, privacy, contact and external handshakes | Mixed; annotations distinguish synthetic cases |
| Preview | `tests/e2e/preview/live-preview.spec.ts` | Public deploy and canonical-route checks; no production redirect; Supabase miss contract | Preview-provider-delivered |
| Contract vectors | `tests/contracts/backend-blocker-cases.ts`, `tests/contracts/backend-blocker-cases.test.ts` | Worker leases, atomic enqueue, mixed evidence outcomes, payment concurrency, all 24 lifecycle orders, 480 duplicate-boundary replays and migration conflicts | Local/static prepared vectors |
| Product authority | `tests/contracts/commercial-authority.test.ts` | S$0; enabled S$18/S$188; disabled consultation/subscription/S$8/S$12 regeneration | Local/static |
| State authority | `tests/contracts/state-machine-families.test.ts`, authenticated state-family spec | Resolver priority and persistent UI states | Local/static + preview-provider-delivered |
| Fixture authority | `tests/release/release-fixtures.ts`, template and fixture tests | Versioned, provider-independent release seed contract; runtime placeholder rejection; UUID/test-session and distinct controlled-user validation; seeded expired-collaborator evidence | Local/static |
| Database | `tests/database/pattern-c-rls.test.sql` | Two-user `supabase_uuid` select/update isolation | Local local-Supabase |
| CI | `.github/workflows/harbor-release-gates.yml` | Frozen install, static/build/contracts, migrations/RLS, public/synthetic/preview/auth lanes, artifacts | CI |
| Traceability and manifest | `docs/release/harbor-contract-traceability.md`, this packet, manifest template | Frozen-contract mapping, execution inputs and promotion record | Documentation |

## Evidence classification

- `local/static`: deterministic local code, fixture, browser or database evidence with no provider claim.
- `synthetic-provider`: provider response is intercepted or mocked. It proves client behavior only.
- `preview-provider-delivered`: request reached the guarded preview and the named provider/backend contract was observed.
- `skipped`: not evidence. Skips are listed explicitly in the JSON report.

Mocked tests carry an `evidence-class: synthetic-provider` annotation even when they live in an authenticated file. A live lane fails during configuration if its SHA, preview identity, credentials, or required fixtures are absent.

## Environment and credential matrix

| Variable / material | Lane | Secret | Source and prerequisite |
|---|---|---:|---|
| `HARBOR_RELEASE_SHA` | Preview/auth; recommended all | No | Exact 40-character integrated SHA; must equal checked-out HEAD |
| `HARBOR_PREVIEW_BASE_URL` | Preview/auth | No | HTTPS preview origin |
| `HARBOR_PREVIEW_EXPECTED_HOST` | Preview/auth | No | Exact preview hostname |
| `HARBOR_PRODUCTION_HOSTS` | Preview/auth | No | Comma-separated app-host denylist; defaults to public production hosts |
| `HARBOR_SUPABASE_EXPECTED_HOST` | Auth | No | Exact preview Supabase hostname; must match `NEXT_PUBLIC_SUPABASE_URL` |
| `HARBOR_PRODUCTION_SUPABASE_HOSTS` | Auth | Sensitive config | Required comma-separated denylist of every production Supabase hostname |
| `HARBOR_ENVIRONMENT_REVISION` | Preview/auth | No | Immutable deployment/environment revision for the same SHA |
| `HARBOR_WORKER_VERSION` | Preview/auth | No | Deployed worker image/version aligned to the candidate |
| `HARBOR_AUTH_STORAGE_STATE_USER_A` | Auth local | Yes | Path to controlled Clerk A storage state |
| `HARBOR_AUTH_STORAGE_STATE_USER_B` | Auth local | Yes | Path to controlled Clerk B storage state |
| `HARBOR_AUTH_STORAGE_STATE_DELETION_USER` | Auth local | Yes | Path to disposable deletion-user storage state |
| `*_BASE64` equivalents in GitHub | Auth CI | Yes | Base64 storage-state secrets materialized only for the job |
| `HARBOR_RELEASE_FIXTURES_JSON` | Auth | Sensitive | JSON conforming to the versioned template; seeded IDs/tokens only |
| `HARBOR_STATE_CASES_JSON` | Auth | Sensitive | Persistent state-family case map used by the UI suite |
| `NEXT_PUBLIC_SUPABASE_URL` | Auth | No | Same preview Supabase project as the deployment |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auth | Sensitive | Preview project anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Auth verification only | Secret | Preview project service key; never sent to the browser |
| `HARBOR_SMTP_TEST_RECIPIENT` | Auth handshake | Sensitive | Controlled test inbox; no real customer address |
| `HARBOR_ARTIFACT_KEY` | Auth CI | Secret | Strong passphrase for encrypted traces/screenshots |
| `HARBOR_UPLOAD_READY_TIMEOUT_MS` | Auth | No | Optional evidence-worker timeout; default 120000 |
| `HARBOR_SUPABASE_CLI_VERSION` | Migration CI | No | Exact reviewed Supabase CLI version; the job rejects an unset value and records `supabase --version` |
| Stripe secret and S$18/S$188 Price IDs | Preview app | Secret/config | Must already be installed in test mode in the preview service; not passed to Playwright |
| Clerk `supabase` JWT template | Preview service | Config | Must emit `supabase_uuid` for all three controlled users |
| Worker/LLM and SMTP credentials | Preview services | Secret | Installed server-side; never exposed to the runner |

Fixture invariants:

1. Users A and B own different cases and cannot share active access to the protected ownership rows.
2. The expired collaborator is user B, its grant is expired before the run starts, and `expiredEvidenceId` identifies a seeded evidence row in that case so process authorization is checked before input validation.
3. Checkout cases begin in documented clean/reserved states; reruns require fixture reset, not improvised IDs.
4. The deletion user is disposable and isolated. Never substitute user A, user B, a staff account or a production account.
5. Price mode is Stripe test mode; a live-mode checkout URL is an immediate stop.
6. Runtime fixtures contain no `<placeholder>` values. UUID fields are UUID-shaped, and delayed-entitlement sessions use the `cs_test_` prefix.

## Preparation-only harness validation

These checks validate draft syntax and collection on preparation head `28a155ec9113f06a6b0ff7cc72a0ee1d89687855`. They are not candidate evidence and did not execute a release-acceptance browser matrix, apply non-local migrations, or contact live providers.

- `pnpm typecheck`: passed after the latest checkout-provider and contract changes.
- Latest pre-integration deterministic contract/release validation: 32/34 passed. The two failures were expected baseline drift (consultation catalogue mismatch) and were explicitly recorded as preparation-only, not candidate evidence.
- `git diff --check`: passed.
- Public Playwright collection: 204 tests across 6 files.
- Synthetic Playwright collection: 24 tests across 1 file.
- Authenticated collection with generated non-secret UUID-shaped fixtures and all 14 state families: 164 tests across 12 files.
- Preview and authenticated configs without live inputs: both failed closed at `HARBOR_RELEASE_SHA` as intended; deterministic guard tests also cover missing revision/worker identity plus non-HTTPS, wrong-host and production-host app/Supabase inputs.
- Workflow YAML parsing remains unvalidated because no YAML/actionlint parser is installed; no tool was added.
- The pgTAP file has not been parsed or run because the Supabase CLI is unavailable in this worktree environment.

## Commands for the exact integrated SHA

Run only after formal assignment. PowerShell examples assume the integrated SHA is supplied out of band.

```powershell
$env:HARBOR_RELEASE_SHA = '<40-character-integrated-sha>'
git rev-parse HEAD
if ((git rev-parse HEAD) -ne $env:HARBOR_RELEASE_SHA) { throw 'Wrong candidate SHA' }
pnpm.cmd install --frozen-lockfile
```

Static gates:

```powershell
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd check:sm
pnpm.cmd exec tsx --test tests/contracts/*.test.ts tests/release/*.test.ts
pnpm.cmd test:document-readiness
pnpm.cmd test:validation-recon
pnpm.cmd test:slice8-payments
```

Migration and RLS gates, using local Supabase only:

```powershell
supabase start
supabase db reset --local
supabase db lint --local --level error
supabase test db tests\database\pattern-c-rls.test.sql
```

Browser lanes:

```powershell
pnpm.cmd build
$env:HARBOR_E2E_WEB_SERVER_COMMAND = "pnpm.cmd start"
pnpm.cmd exec playwright test --config=playwright.config.ts
Remove-Item Env:HARBOR_E2E_WEB_SERVER_COMMAND
pnpm.cmd exec playwright test --config=tests\e2e\playwright.synthetic.config.ts
pnpm.cmd exec playwright test --config=tests\e2e\playwright.preview.config.ts
pnpm.cmd exec playwright test --config=tests\e2e\playwright.authenticated.config.ts
```

The preview and authenticated commands must be separate. Do not combine results or relabel synthetic output as provider-delivered.

## Visual baseline review

Reviewed public snapshots are Windows-specific, so the CI public lane runs on Windows against a production build. Auth-provider snapshots run only with configured nonproduction Clerk credentials; credential-withheld runs still validate the Harbor auth shell and skip those provider-owned images.

1. Generate candidates only at the approved integrated SHA in a dedicated review run.
2. Inspect every new/different image at 390, 768 and 1440 and the WebKit/mobile project.
3. Reject clipping, horizontal scroll, hidden focus, unstable data, fallback fonts and accidental provider content.
4. Have Design/Architect record approval.
5. Add only approved snapshots. CI never runs `--update-snapshots`.

## Evidence schema and handling

Each `test-results/evidence/<lane>-<sha>.json` contains:

- `schemaVersion`;
- run lane, evidence class, exact SHA, environment revision, worker version, CI run/attempt, timing and overall status;
- counts for passed, failed, timed out, skipped and interrupted;
- every test's source SHA, ID, project, source location, status, retry, duration, evidence class, redacted errors, artifacts and annotations.

Rules:

- JSON indexes are redacted and retained for 14 days in CI.
- Public/synthetic artifacts retain screenshots, traces and failure logs for 14 days.
- Authenticated traces/screenshots can contain session or seeded case data. CI encrypts them with AES-256/PBKDF2 before upload and retains them for three days.
- Authenticated browser contexts automatically abort configured production origins; direct API probes disable redirects and inspect `Location` explicitly.
- Mutating Slice 5, Slice 7 and deletion checks run only in `chromium-1440`; responsive projects retain read-only assertions.
- Evidence lanes use zero retries, so an initial browser or external-handshake failure cannot be converted into a green required check.
- Never paste a trace, storage state, bearer token, service key, webhook secret or raw fixture JSON into a PR.
- A missing artifact, skipped handshake, wrong SHA, production redirect, external-provider failure or non-test Stripe session blocks promotion.

## Coverage gaps before candidate execution

1. Backend symbols/RPCs are not final, so deterministic worker lease, atomic enqueue, completion, all 24 lifecycle orders, 480 duplicate-boundary replays and migration-conflict vectors do not yet call the real adapters.
2. Invalid upload type/size/magic-byte and expired-collaborator storage/row denial gates are prepared. Collaborator processing now targets a seeded evidence ID; job-table no-mutation still needs Backend's final durable-enqueue adapter.
3. Live anonymous-to-Clerk bootstrap, live invitation acceptance/share, report download/share and checkout cancel/resume remain open.
4. Provider action-required payment, SMTP delivery receipt (beyond acceptance), worker crash/retry and live realtime offline/reconnect remain open.
5. Synthetic router coverage now validates typed/voice handoff, draft restore, offline denial, expired-session replacement and catch-up/start-fresh recovery; authenticated new-case/signup and live bootstrap/report flows remain open.
6. No visual snapshot is accepted until human review.
7. Branch-protection settings must mark every workflow job as required; workflow YAML alone cannot prevent an administrator bypass.
8. Workflow schema parsing, full migration apply and pgTAP execution must wait for available tooling and the integrated migration set.

## Mandatory reruns after each Backend fix

| Backend change | Minimum rerun |
|---|---|
| Ownership/RLS/claims | Migration apply/lint, pgTAP Pattern C, authenticated preflight, ownership-claims, cross-user URL |
| Evidence registration/enqueue/worker lease | Backend deterministic adapter tests, Slice 5 upload/gap, expired collaborator, state-family evidence/report cases |
| Validation or `documents_not_ready` | Document readiness, validation reconciliation, mixed-outcome invariant, state-machine suites |
| Checkout/reservation/webhook/refund/dispute | Commercial authority, payment branching, provider checkout, duplicate/permutation adapter tests, delayed entitlement |
| Report/job worker | State-machine unit/UI, job-status poll, evidence-to-Ready handshake, report download/share |
| Clerk onboarding/bootstrap | Public auth routing, Pattern C claims, anonymous handoff, two-user RLS |
| Invitations/email/privacy | Invitation/share, SMTP handshake, export, disposable deletion request |
| Migration/preflight | Reset from zero, lint, conflict fixtures, pgTAP RLS, all Backend DB adapters |
| Public routes/CTA | Public route matrix, canonical routes, visual/mobile/accessibility suite |

After the final Backend fix, run the complete matrix again at one newly recorded exact SHA. Earlier partial passes cannot be promoted as evidence for a later SHA.
