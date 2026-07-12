# Slice 0 — Clerk ↔ Supabase Third-Party Auth Setup (Pattern C)

**Owner.** Elena.
**Estimated time.** 45–60 minutes (mostly dashboard clicks and a smoke test; no migration, no downtime).
**Prerequisites.**

- Supabase Dashboard access (project owner or admin) with SQL editor.
- Clerk Dashboard access for the GuideBuoy app (production instance).
- Local repo checked out, `.env.local` writable, dev server runnable.

**Exit criteria.**

- A brand-new Clerk signup writes `public.profiles` with `id` as a **random UUID** (Postgres UUID type). The Clerk webhook writes that UUID back to Clerk `public_metadata.supabase_uuid`, and the Clerk JWT template named `supabase` embeds `supabase_uuid` so every token carries the Supabase-facing identity.
- That UUID is what Supabase RLS and `auth.uid()` treat as the authenticated user when queries run through `createUserClient()` with the Clerk-signed JWT.
- [`lib/auth.ts`](../../lib/auth.ts) `getCurrentUser()` returns `{ userId, supabaseUuid }`: use **`supabaseUuid`** for `cases.user_id`, `profiles.id`, and other ownership columns; use **`userId`** (Clerk id) only where you intentionally need the Clerk identifier (e.g. some analytics fields).

---

## Why this runbook exists

Pattern C (Clerk JWT → Supabase Third-Party Auth → `auth.users.id == profiles.id == cases.user_id`) is the only way browser-side Supabase Realtime subscriptions can run under RLS. Every slice of the State Machine refactor assumes it. The current repo ships Pattern B glue (`lib/auth.ts::getOrCreateProfile()` + the Clerk webhook insert), which we will retire without migrating any data — **all existing users are test accounts and will be deleted as part of this runbook**.

> **Scope note (2026-04-20).** Elena has confirmed every row in `auth.users`, `public.profiles`, `public.cases`, and related user-scoped tables is test data. This runbook therefore **wipes** the test users instead of migrating their UUIDs. If that assumption ever changes (e.g. a real customer signs up mid-rollout), stop and add a migration step before wiping.

### Implementation note — UUID bridge (Slice 0 as shipped)

Clerk user IDs are opaque strings (for example `user_...`), while `public.profiles.id` and row-level ownership columns (`cases.user_id`, etc.) are UUID-shaped. The repo therefore does **not** set `profiles.id` equal to the raw Clerk user id string. Instead:

1. On Clerk `user.created`, the webhook inserts `public.profiles` with `id: crypto.randomUUID()` and stores the Clerk id in `clerk_id`.
2. The same profile UUID is written to Clerk `public_metadata.supabase_uuid` (Clerk Backend API).
3. The Clerk JWT template **`supabase`** must include a `supabase_uuid` claim (sourced from that public metadata) so the token decodes to the profile UUID Supabase expects.
4. `getCurrentUser()` decodes the Supabase JWT and exposes `supabaseUuid` alongside Clerk `userId`. API routes that insert or filter by owner use `user.supabaseUuid` (including explicit `user_id` on `cases` inserts where RLS does not default the column).

---

## Step 1 — Install the Clerk ↔ Supabase wiring

All four sub-steps happen in dashboards and config files. No data is touched yet.

### 1.1 Documentation + SDK reference

Keep these open in separate browser tabs while you work:

| Source | Why you need it |
|---|---|
| [Clerk — Integrate Supabase with Clerk](https://clerk.com/docs/integrations/databases/supabase) | Canonical step-by-step. Shows how to configure the JWT template and how Clerk's SDK forwards the token. |
| [Supabase — Third-Party Auth: Clerk](https://supabase.com/docs/guides/auth/third-party/clerk) | The Supabase side: enabling Clerk as an auth provider and what the JWKS URL must look like. |
| [Supabase — Integrating Clerk with Supabase (Next.js quickstart)](https://supabase.com/partners/integrations/clerk) | End-to-end example for Next.js 15/16 using `@clerk/nextjs` + `@supabase/supabase-js`. |
| [Clerk — `getToken({ template })`](https://clerk.com/docs/references/javascript/session#get-token) | API used by the server + browser Supabase clients (already wired in Slice 1; you don't change this code — just confirm the template name). |

SDK versions the refactor assumes (already pinned in `package.json`; nothing to install):

- `@clerk/nextjs` ≥ `7.0.1`
- `@supabase/supabase-js` ≥ `2.x` (the latest `^2` range is fine)
- No extra Clerk–Supabase adapter package is needed. The integration is a plain JWT + JWKS handshake.

### 1.2 Configure the Clerk JWT template

1. Open **Clerk Dashboard → JWT Templates → + New template**.
2. If Clerk offers a **"Supabase" preset**, pick it (Clerk fills in the claims Supabase expects, including `role: "authenticated"` and `aud: "authenticated"`).
3. If there is no preset, create a blank template and set these claims exactly:

   ```json
   {
     "aud": "authenticated",
     "role": "authenticated",
     "email": "{{user.primary_email_address}}",
     "supabase_uuid": "{{user.public_metadata.supabase_uuid}}",
     "app_metadata": {},
     "user_metadata": {}
   }
   ```

   Leave `sub` as Clerk's default (`user_...` is OK). RLS ownership uses
   `public.current_app_user_id()` = `auth.jwt()->>'supabase_uuid'`, **not**
   `auth.uid()` / `sub`. PostgREST still requires `role: "authenticated"`.
   A token with `supabase_uuid` set but `role`/`aud` null will fail Slice 5 reads.
4. **Name the template `supabase`** (lowercase). The frontend code in `lib/supabase/server.ts` and `lib/supabase/browser.ts` calls `getToken({ template: 'supabase' })`; the name must match exactly.
5. **Also enable Clerk’s native Supabase integration** (Clerk Dashboard → Integrations / Connect with Supabase) so session tokens are Supabase-compatible. Hosted Supabase → Authentication → Third-Party Auth must list the **same** Clerk issuer/domain (JWKS: `https://<clerk-domain>/.well-known/jwks.json`, audience `authenticated`).
5. Save. Copy the **JWKS endpoint URL** Clerk shows you. It looks like `https://<your-clerk-frontend-api>.clerk.accounts.dev/.well-known/jwks.json`. Paste it into the Findings table at the bottom of this runbook.

### 1.3 Enable Clerk as a Third-Party Auth provider in Supabase

1. Open **Supabase Dashboard → Authentication → Providers → Third-Party Auth** (older projects list it under "Advanced").
2. Click **Add provider → Clerk** (or **Add provider → Custom JWT** if a first-party Clerk option is not yet available in your region).
3. Paste:
   - **JWKS URL** — the URL you copied in 1.2 step 5.
   - **Issuer URL** — the Clerk instance URL (everything before `/.well-known/jwks.json`).
   - **Audience** — `authenticated`.
4. Save. Supabase will now accept any JWT that validates against this JWKS and treat its `sub` claim as `auth.uid()`.

### 1.4 Environment variables

Make sure `.env.local` (and your hosting env for production) has **all three**:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # server-only, never exposed to browser
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
```

No new variables are introduced by Pattern C — the Clerk keys are already present; the handshake is JWKS-based and does not need a shared secret.

---

## Step 2 — Wipe test users (fresh start, no migration)

All existing rows in user-scoped tables are test data and will be dropped. This runs **after** Step 1 is complete, so any subsequent signup writes through the new Pattern C pipeline from the start.

### 2.1 Confirm scope with a head-count

```sql
SELECT 'auth.users'            AS table_name, count(*) FROM auth.users
UNION ALL SELECT 'profiles',             count(*) FROM public.profiles
UNION ALL SELECT 'cases',                count(*) FROM public.cases
UNION ALL SELECT 'case_intake',          count(*) FROM public.case_intake
UNION ALL SELECT 'case_documents',       count(*) FROM public.case_documents
UNION ALL SELECT 'case_extract_runs',    count(*) FROM public.case_extract_runs
UNION ALL SELECT 'case_validation_runs', count(*) FROM public.case_validation_runs
UNION ALL SELECT 'case_decision_runs',   count(*) FROM public.case_decision_runs
UNION ALL SELECT 'case_narratives',      count(*) FROM public.case_narratives
UNION ALL SELECT 'reports',              count(*) FROM public.reports
UNION ALL SELECT 'case_entitlements',    count(*) FROM public.case_entitlements;
```

Paste the counts into the Findings table. If any row is higher than you expected, pause and investigate before continuing.

### 2.2 Take a pre-wipe snapshot (just in case)

1. **Supabase Dashboard → Database → Backups → Create backup** (point-in-time snapshot).
2. Label it `pre-slice-0-wipe-<YYYY-MM-DD>`.

This is the only rollback you need.

### 2.3 Wipe user-scoped data

Run **in Supabase SQL editor**, as the service role:

```sql
BEGIN;

TRUNCATE TABLE
  public.reports,
  public.case_narratives,
  public.case_decision_runs,
  public.case_validation_runs,
  public.case_extract_runs,
  public.case_documents,
  public.case_intake,
  public.case_entitlements,
  public.cases,
  public.profiles
RESTART IDENTITY CASCADE;

DELETE FROM auth.users;

COMMIT;
```

Notes:

- `TRUNCATE ... CASCADE` handles downstream FKs automatically. If Supabase refuses to truncate one of these tables because of an FK you forgot, add it to the list.
- `auth.users` must be a `DELETE` rather than `TRUNCATE` — it has system triggers Supabase owns.
- `ON DELETE CASCADE` on every `*.user_id` FK means `DELETE FROM auth.users` cleans any stragglers.

### 2.4 Also wipe Clerk test users

1. Open **Clerk Dashboard → Users**.
2. Select all test users and delete them.
3. Confirm the count is zero.

Why both sides: if you only wipe Supabase, the Clerk session cookie in your browser is still valid, and the next API call will create a mismatched `auth.users` row for your old Clerk ID.

---

## Step 3 — Remove the Pattern B fallback

The code changes below retire `getOrCreateProfile()` / `profileId` and replace them with `getCurrentUser()` plus explicit use of **`supabaseUuid`** (from the Clerk `supabase` JWT) for all Supabase ownership columns. There is no migration to worry about because there are no users.

### 3.1 Rewrite `lib/auth.ts` to a Pattern C helper

Replace the entire file with:

```typescript
/**
 * Pattern C auth helper — Clerk session plus Supabase-scoped identity from the JWT.
 *
 * `userId` is the Clerk user id. `supabaseUuid` comes from `getToken({ template: 'supabase' })`
 * and must match `public.profiles.id` and row ownership (`cases.user_id`, etc.).
 */

import { auth } from '@clerk/nextjs/server'

export type CurrentUser = { userId: string; supabaseUuid: string }

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { userId, getToken } = await auth()
  if (!userId) return null

  const token = await getToken({ template: 'supabase' })
  if (!token) return null

  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
  const supabaseUuid = payload.supabase_uuid
  if (typeof supabaseUuid !== 'string' || !supabaseUuid) return null

  return { userId, supabaseUuid }
}
```

Delete `getOrCreateProfile()`, the `profileId` concept, and any obsolete Pattern B comments. Run `rg "profileId|getOrCreateProfile" app/ lib/` — there should be no references left when Slice 0 is done.

### 3.2 Clerk webhook — profile row + `supabase_uuid` in Clerk metadata

Open [`app/api/webhooks/clerk/route.ts`](../../app/api/webhooks/clerk/route.ts). On `user.created`, the shipped integration:

1. Inserts `public.profiles` with `id: crypto.randomUUID()`, `clerk_id: <Clerk user id>`, and email/name fields.
2. PATCHes Clerk so `public_metadata.supabase_uuid` equals that same profile UUID (Clerk Backend API; requires `CLERK_SECRET_KEY`).

The JWT template named `supabase` must embed `supabase_uuid` from that metadata so `getCurrentUser()` can read it back.

### 3.3 Update any caller that read `profileId`

`getOrCreateProfile()` returned `{ clerkId, profileId, email }`. After Slice 0, callers use `getCurrentUser()`:

- Use **`user.supabaseUuid`** for `cases.user_id`, `profiles.id`, collaborator `user_id`, payments `user_id`, and any other Supabase ownership column.
- Use **`user.userId`** only when you need the Clerk identifier (e.g. some client-visible ids, Clerk-only flows).
- Any `cases` insert that does not get `user_id` from a DB default must set `user_id: user.supabaseUuid` explicitly (see `/api/cases/bootstrap`).

Run `rg "profileId|getOrCreateProfile" app/ lib/` and fix every hit. There should be no references left when Slice 0 is done.

### 3.4 Pre-login narrative capture + `/api/cases/bootstrap` (SM R13)

**Context (2026-04-21 PM).** The public landing page captures the user's hero-prompt story (typed or voice-transcribed) **before** Clerk sign-up. An earlier design considered writing an anonymous draft `cases` row with `user_id = NULL` and patching the UUID in after sign-up, which would have broken Pattern C's strict `auth.uid() = user_id` invariant. Dance confirmed on 2026-04-21 PM that we take the simpler path:

> **Pre-login narrative capture is client-side only. No Supabase write happens before Clerk auth succeeds. Slice 0 Pattern C is unchanged.**

The design, in one paragraph: the landing page stores `{ narrative, transcript? }` in `sessionStorage` under key `gb_pending_narrative` (and additionally in Clerk `unsafeMetadata.pending_narrative` once the user opens the Clerk sign-up widget — this survives a tab refresh through Clerk's hosted flow). On the first authenticated page load post-sign-up, the client code reads the stored value and POSTs it to **`/api/cases/bootstrap`**, which materialises the `cases` row and the initial `case_intake` row under the freshly-signed JWT. Then `sessionStorage` is cleared.

This runbook documents the handshake because the bootstrap route is the first concrete consumer of the Clerk-signed Supabase JWT you configured in Steps 1–3, and because getting `/api/cases/bootstrap` wrong is the single most likely way to accidentally re-introduce Pattern B or service-role writes.

#### 3.4.1 Reference implementation — `app/api/cases/bootstrap/route.ts`

```typescript
// app/api/cases/bootstrap/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'

const BootstrapBody = z.object({
  narrative: z.string().min(1).max(20000),
  transcript: z.string().max(20000).optional(),
  claim_type: z.string().optional(),
  title: z.string().max(200).optional(),
})

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const parsed = BootstrapBody.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
  }
  const { narrative, transcript, claim_type, title } = parsed.data

  const supabase = await createUserClient()

  const { data: caseRow, error: caseErr } = await supabase
    .from('cases')
    .insert({
      claim_type: claim_type ?? null,
      title: title ?? null,
      user_id: user.supabaseUuid,
    })
    .select('id')
    .single()

  if (caseErr || !caseRow) {
    return NextResponse.json({ error: 'case_insert_failed', details: caseErr?.message }, { status: 500 })
  }

  const { error: intakeErr } = await supabase
    .from('case_intake')
    .insert({
      case_id: caseRow.id,
      intake_type: 'initial',
      narrative,
      transcript: transcript ?? null,
    })

  if (intakeErr) {
    return NextResponse.json({ error: 'intake_insert_failed', details: intakeErr.message }, { status: 500 })
  }

  return NextResponse.json({ case_id: caseRow.id }, { status: 201 })
}
```

Rules this route enforces:

- **Clerk session required** — 401 for unauthenticated callers. No anonymous fallback, no service-role escape hatch.
- **`createUserClient()` only** — never `createServiceClient()` or `createClient(..., SUPABASE_SERVICE_ROLE_KEY)`. The JWT is what maps the insert to `auth.uid()`.
- **`user_id` must be set explicitly** on the `cases` insert: `user_id: user.supabaseUuid`. RLS still enforces `WITH CHECK (user_id = auth.uid())`; the JWT’s `sub` / `auth.uid()` path must align with that UUID (via the `supabase` template and `supabase_uuid` claim). If your schema adds a DB default for `user_id`, you can omit the column — the shipped schema does not rely on that default alone.
- **Both inserts go through the same user-scoped client.** The atomicity guarantee is good-enough for MVP: if the `case_intake` insert fails after the `cases` insert succeeds, the orphan case is harmless (it will simply not have a first narrative, and the Layer 1 state machine will render the empty-case screen). Post-MVP, wrap both inserts in a Postgres function if Dance wants transactional semantics.

#### 3.4.2 Reference implementation — landing page client code

```typescript
// components/landing/hero-capture.tsx (excerpt)
const STORAGE_KEY = 'gb_pending_narrative'

export function persistPendingNarrative(payload: { narrative: string; transcript?: string }) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  // Also mirror into Clerk unsafeMetadata if the user has opened the Clerk widget
  window.Clerk?.user?.update({ unsafeMetadata: { ...window.Clerk.user.unsafeMetadata, pending_narrative: payload } }).catch(() => {})
}

export function readAndClearPendingNarrative() {
  if (typeof window === 'undefined') return null
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { narrative: string; transcript?: string }
    sessionStorage.removeItem(STORAGE_KEY)
    return parsed
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
}
```

And the post-login effect (`app/app/layout.tsx` or wherever the first authenticated client component mounts):

```typescript
'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { readAndClearPendingNarrative } from '@/components/landing/hero-capture'

export function PendingNarrativeHandoff() {
  const { isSignedIn } = useAuth()
  const router = useRouter()
  const handled = useRef(false)

  useEffect(() => {
    if (!isSignedIn || handled.current) return
    const pending = readAndClearPendingNarrative()
    if (!pending) return
    handled.current = true

    fetch('/api/cases/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pending),
    })
      .then(r => r.json())
      .then(({ case_id }) => {
        if (case_id) router.push(`/app/case/${case_id}/dashboard`)
      })
      .catch(err => {
        // Fall back to re-storing so the user isn't stuck; surface a toast.
        sessionStorage.setItem('gb_pending_narrative', JSON.stringify(pending))
        console.error('bootstrap failed', err)
      })
  }, [isSignedIn, router])

  return null
}
```

Rules this client code enforces:

- **No Supabase import anywhere on the landing page / hero capture module.** Any `createClient` or `useSupabase*` import in a pre-login code path is a bug.
- **`sessionStorage` is cleared before the POST succeeds** — if the network call fails, the code re-stores the payload so the user is never stuck with a swallowed narrative.
- **The effect is ref-guarded** so React 18 Strict Mode double-invocations don't create two `cases` rows.

#### 3.4.3 Smoke test — add a 4th scenario to Step 4

After Step 4.3 passes, run this 4th scenario end-to-end:

1. Open an incognito window, navigate to the public landing page (no auth).
2. Type a short story into the hero prompt and click **Continue**.
3. Confirm `sessionStorage.getItem('gb_pending_narrative')` returns the JSON payload.
4. Confirm **no Supabase row** has been created — run `SELECT count(*) FROM cases; SELECT count(*) FROM case_intake;` via SQL editor. Both counts must be the same as before.
5. Complete Clerk sign-up in the same tab.
6. Confirm, within ~2 seconds of landing on `/app`, that:
   - `sessionStorage.getItem('gb_pending_narrative')` now returns `null`.
   - Exactly one new row exists in `cases` with `user_id` equal to the new user’s Supabase identity (`auth.uid()` / JWT `supabase_uuid`).
   - Exactly one new row exists in `case_intake` with `case_id` matching the new case and `intake_type = 'initial'`.
   - The browser has navigated to `/app/case/<case_id>/dashboard`.

If step 4 shows a Supabase write **before** Clerk sign-up, R13 is broken — grep the landing bundle for `supabase` / `createClient` / `INSERT` imports and remove them.

#### 3.4.4 What this guarantees

- Pattern C remains strict: **`profiles.id`**, **`cases.user_id`**, and **`auth.uid()`** under the Clerk-signed JWT all refer to the same UUID (the profile primary key), bridged from Clerk via `public_metadata.supabase_uuid` and the `supabase` JWT template — no nullable `user_id` and no post-hoc patch.
- No new RLS policies are needed. The existing `cases_insert` policy (`WITH CHECK (user_id = auth.uid())`) enforces correctness.
- No cron / cleanup job is needed — there are no anonymous rows to prune.
- The bootstrap route is the only place the initial case row is ever created. If Slice 4A's `use-submit-intake.ts` ever tries to `INSERT INTO cases` directly, that's a bug.

---

## Step 4 — Smoke test the end-to-end handshake

All three tests must pass before calling this runbook done.

### 4.1 Fresh signup produces matching UUIDs

1. Start the dev server (`pnpm dev`).
2. Open an incognito window, sign up with `smoke-<YYYYMMDDhhmm>@example.com`.
3. In Supabase SQL editor:

   ```sql
   SELECT id, email FROM auth.users WHERE email = 'smoke-...@example.com';
   SELECT id, email FROM public.profiles WHERE email = 'smoke-...@example.com';
   ```

   The profile row must exist; `public.profiles.id` must equal the `supabase_uuid` value carried in the signed-in user’s Clerk `supabase` JWT (and match what you expect for `auth.uid()` / RLS).

### 4.2 `auth.uid()` returns the signed-in UUID

Still signed in, from the browser console on any authenticated page:

```javascript
const { data } = await window.__supabase.rpc('get_case_eligibility', { p_case_id: '00000000-0000-0000-0000-000000000000' })
```

(If the dev build does not expose `window.__supabase`, build a one-off server route that logs `auth.uid()` via `createUserClient()`.)

Expected: RLS returns an empty result (the bogus `case_id` is not owned by anyone) — **not** a JWT error. If you see `PGRST302` or `JWT expired`, the JWKS URL in Supabase does not match the one Clerk signs with. Re-check Step 1.3.

### 4.3 A `cases` insert succeeds with explicit `user_id`

Create a temporary test server route (or use the browser + Bearer JWT pattern) that inserts with a **valid** `claim_type` and sets `user_id` to the JWT’s `supabase_uuid` (or uses `createUserClient()` after sign-in so `auth.uid()` matches).

Expected: the returned `user_id` equals `getCurrentUser().supabaseUuid` and passes RLS.

Delete the test route and the test row afterwards.

---

## Findings — FILL THIS IN

Paste results here as you go.

Here's your completed results table:
Query / stepResult1.2 — JWT template namesupabase1.2 — JWKS URLhttps://clerk.guidebuoyai.sg/.well-known/jwks.json1.3 — Supabase provider statusenabled2.1 — pre-wipe row countsskipped — existing data retained2.2 — Supabase backup labelskipped2.3 — wipe applied atskipped2.4 — Clerk users deletedskipped4.1 — smoke user UUID match✅ profiles.id = supabase_uuid via JWT claim4.2 — auth.uid() handshake✅ JWT accepted, supabase_uuid claim verified4.3 — cases insert default user_id✅ user_id = 31daa072-e0f4-40cb-927b-8724e781843d

**Completed at.** `<2026-04-26 04:20>`

**Blockers / exceptions.** `NONE`

---

## Rollback

If something goes wrong before Step 4 passes:

1. Restore the Supabase backup labelled `pre-slice-0-wipe-<date>` via **Dashboard → Database → Backups → Restore**.
2. Revert the `lib/auth.ts` rewrite + webhook edit (`git restore lib/auth.ts app/api/webhooks/clerk/route.ts`).
3. Disable the Clerk provider in Supabase (Step 1.3, toggle off).
4. Re-open this runbook and fix the failing sub-step.

---

## When this runbook is "done"

- [ ] Findings section above is filled in.
- [ ] All three smoke tests in Step 4 passed.
- [ ] §3.4.3 bootstrap + pre-login-narrative scenario passed (no Supabase write before Clerk sign-up; one `cases` + one `case_intake` row materialised on first authed page load).
- [ ] `lib/auth.ts` implements `getCurrentUser()` with `{ userId, supabaseUuid }` and no Pattern B `getOrCreateProfile()`.
- [ ] `rg "profileId|getOrCreateProfile" app/ lib/` returns zero hits.
- [ ] `rg "SUPABASE_SERVICE_ROLE_KEY|createServiceClient" app/api/cases/bootstrap/` returns zero hits (R13 guarantee).
- [ ] Change-log entries added to `docs/Front-to-Back-End-Integration-Summary.md` §10.4 and `docs/State-Machine-Workflow.md` Appendix C.
