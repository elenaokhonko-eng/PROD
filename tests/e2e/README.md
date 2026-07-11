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

If `SLICE5_BASE_URL` points to localhost, Playwright starts `pnpm.cmd dev` automatically when auth state exists. For a deployed/staging URL, set:

```powershell
$env:SLICE5_SKIP_WEB_SERVER = "1"
```

The upload test optionally verifies the "exactly one `case_documents` row" invariant when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available in `.env.local`.

Before running Supabase-backed assertions, ensure `.env.local` contains exactly one `NEXT_PUBLIC_SUPABASE_URL`, and that `SUPABASE_SERVICE_ROLE_KEY` belongs to the same Supabase project.
