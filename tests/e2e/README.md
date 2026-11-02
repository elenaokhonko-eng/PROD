# E2E QA

This suite is for browser QA that needs a real Clerk session and a live Supabase-backed app.

## Slice 5

Spec: `tests/e2e/slice5.spec.ts`

Run:

```powershell
pnpm.cmd run test:e2e:slice5
```

Without an authenticated storage-state file, the Slice 5 tests skip. This is intentional so CI/static runs do not require secrets.

Create the storage state:

```powershell
New-Item -ItemType Directory -Force tests/e2e/.auth
pnpm.cmd run test:e2e:auth
```

In the browser opened by Playwright, sign in as the owner of the Slice 5 test cases, then close the browser. The auth state is saved to `tests/e2e/.auth/slice5.json`, which is ignored by git.

If Clerk CAPTCHA fails in Playwright Chromium, try the Chrome-channel capture:

```powershell
pnpm.cmd run test:e2e:auth:chrome
```

If CAPTCHA still fails, do not create a new random Clerk user for Slice 5 QA. The authenticated user must own the controlled Supabase case rows. For the Clerk test instance, temporarily disable Bot sign-up protection in Clerk Dashboard > Attack protection, create or sign in as the intended test-case owner, save the storage state, then re-enable bot protection.

Useful env vars:

```powershell
$env:SLICE5_BASE_URL = "http://localhost:3000"
$env:SLICE5_AUTH_STORAGE_STATE = "tests/e2e/.auth/slice5.json"
$env:SLICE5_CONTROLLED_CASE_ID = "9eafdc9e-9431-4ba1-ae28-b62fd4da9098"
$env:SLICE5_UPLOAD_CASE_ID = "<case currently showing evidence upload>"
$env:SLICE5_GAP_CASE_ID = "<case currently showing gap questions>"
$env:SLICE5_UPLOAD_READY_TIMEOUT_MS = "120000"
```

If `SLICE5_BASE_URL` points to localhost, Playwright starts `pnpm.cmd dev` automatically for public and authenticated tests. Authenticated tests still skip when their storage state is absent. For a deployed/staging URL, set:

```powershell
$env:SLICE5_SKIP_WEB_SERVER = "1"
```

The upload test optionally verifies the "exactly one `case_documents` row" invariant when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available in `.env.local`.

Before running Supabase-backed assertions, ensure `.env.local` contains exactly one `NEXT_PUBLIC_SUPABASE_URL`, and that `SUPABASE_SERVICE_ROLE_KEY` belongs to the same Supabase project.

## Harbor preview handshakes

`harbor-preview-handshakes.spec.ts` is the production-like release gate for Clerk → Supabase RLS, the deployed Pattern C migration and ACLs, protected analytics, Stripe test Checkout and signed-webhook idempotency, the Render worker, SMTP, and WhatsApp. It includes anonymous, forged-token, identity-mismatch, unsigned-webhook, and invalid-worker-secret failure paths.

Run it only against isolated preview infrastructure. The gate refuses the known production hosts, requires an explicit mutation confirmation, requires Stripe to return a `cs_test_` session, restores the sensory preference, and removes its disposable commerce rows. It sends one sink email and the worker test writes report output to a resettable controlled case.

Create a Clerk storage state for the preview user that owns the controlled worker case:

```powershell
$env:HARBOR_PREVIEW_BASE_URL = "https://<preview-app>"
$env:HARBOR_PREVIEW_AUTH_STORAGE_STATE = "tests/e2e/.auth/harbor-preview.json"
pnpm.cmd exec playwright codegen --save-storage=$env:HARBOR_PREVIEW_AUTH_STORAGE_STATE "$($env:HARBOR_PREVIEW_BASE_URL)/sign-in"
```

Set the preview-only values without copying them into source control:

```powershell
$env:HARBOR_PREVIEW_SUPABASE_URL = "https://<preview-ref>.supabase.co"
$env:HARBOR_PREVIEW_SUPABASE_ANON_KEY = "<preview anon key>"
$env:HARBOR_PREVIEW_SUPABASE_SERVICE_ROLE_KEY = "<preview service key>"
$env:HARBOR_PREVIEW_DATABASE_URL = "postgresql://<preview connection>?sslmode=require"
$env:HARBOR_PREVIEW_STRIPE_WEBHOOK_SECRET = "<preview whsec value>"
$env:HARBOR_PREVIEW_EMAIL_SINK = "<controlled inbox>"
$env:HARBOR_PREVIEW_WORKER_CASE_ID = "<owned, resettable, report-ready case UUID>"
$env:HARBOR_PREVIEW_CONFIRM_SUPABASE_REF = "<preview-ref>"
$env:HARBOR_PREVIEW_CONFIRM_MUTATIONS = "RUN_MUTATING_PREVIEW_HANDSHAKES"
pnpm.cmd run test:e2e:preview-handshakes
```

A passing run is evidence only when all six tests execute. Deployment rollback remains an operator-controlled canary exercise; this gate verifies database transaction rollback and cleanup of its synthetic commerce fixture.
