# State Machine Refactor — Execution Plan

> ✅ **2026-04-21 PM — Masha feedback reconciliation complete.** The canonical call graph is now **3 Tier-0 functions** (`evidence_processed_v2` → `run_case_extract_v4` with gap loop → `bright-function`) and **2 Tier-1 functions** on the Render worker (`run_case_decision_v1` → `run_report_selfserve_v1`). `candidate-transactions` and `compute-loss` are **Masha-internal fallback functions** fired manually from the Supabase Dashboard only when `run_case_extract_v4` fails to compute the loss amount — **the frontend does not call them, and no hooks / routes / UI wire them in this plan**. `gemini-task` is **archived**. "Validation" is a **Postgres trigger** on `case_extract_runs`, not a separate function call. Pre-login landing-page narrative capture is **client-side only** (`sessionStorage` / Clerk `unsafeMetadata`) — no anonymous Supabase rows, so Slice 0 Pattern C is unchanged. Layer 3 is a **human-in-the-loop FIDReC handoff form** shown right after the Tier-1 report — identity auto-filled from Clerk (editable) + user-entered `age`, `employment_status`, two FIDReC-qualification booleans (`thirty_days_since_last_fi_reply`, `fi_issued_final_response`), optional message; server-side snapshots `amount_lost_sgd` + `financial_institution` from the latest `case_extract_runs.extract_json` row so Dance's triage view matches the user's report. One `upsert` (UNIQUE on `user_id + case_id`) into the contact-requests storage table (currently `escalation_waitlist` per IS §10.5; follow-up migration may rename to `contact_requests`) **and** a notification email to Dance — no specialist *card* (legacy), no LinkedIn CTAs, no "coming soon" waitlist. **2026-04-26 (schema):** **Layer 3 = Tier 2** — the **post–Tier-1** surface (same place: FIDReC handoff + case-pack + paid consult/SKUs per **§10.6**). **WhatsApp is required:** a **persistent** widget in the **root layout** so it appears on **every URL**, **including pre-login marketing and landing** **and** authed app routes. On the **Layer 3 / Tier 2** screen, a **recommendation** to reach the **Scam and Fraud Specialist** for **consult or Q&A** (copy with legal). **R13 safe:** the WhatsApp control is a **third-party** `wa.me` deep link only — **no** Supabase client on pre-login paths (unchanged). **No login** to contact the team on WhatsApp (already: **[app/layout.tsx](../app/layout.tsx)** — site-wide fixed FAB + footer to `wa.me/6590727915`). Refactor: **retain** this; add L3 on-page Scam and Fraud **copy** only. Slice 2 and Slice 4A are rewritten below to reflect the final 5-route / 5-hook shape; Slice 4D is rewritten as the contact-form hook; Slice 5 adds the pre-login bootstrap route; Slice 7 adds audit guards for the fallback / archived names. Binding contract: [`2026-04-21-Masha-Feedback-Reconciliation.md`](./2026-04-21-Masha-Feedback-Reconciliation.md) §0 and §6.

**Status.** Ready to execute. Slices 0–3D are ready or done. Slices 4A–7 are fully specified (2026-04-21 PM). **Slice 8** (L3 / Tier 2 **commerce** — SGD 99/800) added 2026-04-26 — see **§10.6**; after **Stripe Tier-1** (5–6), ideally after **7**.
**Binding contracts.** [docs/Front-to-Back-End-Integration-Summary.md](./Front-to-Back-End-Integration-Summary.md) and [docs/State-Machine-Workflow.md](./State-Machine-Workflow.md). This plan cites specific sections (IS §, SM §, SM R#) — never re-derive a decision, always read the contract.
**Plan owner.** Elena. **Last updated.** 2026-04-21 PM; §12.1 + §10.6 + **L3=T2** + **`app/layout.tsx` wa.me (no login) + L3 copy** 2026-04-26.

---

## 1. Locked decisions

1. **Auth pattern** — Pattern C (Clerk JWT to Supabase Third-Party Auth, `auth.users.id == profiles.id == cases.user_id`). All existing users are test data and are wiped in Slice 0. No migration step. See [docs/State-Machine-Workflow.md Appendix D](./State-Machine-Workflow.md) and [docs/runbooks/slice-0-auth-reconciliation.md](./runbooks/slice-0-auth-reconciliation.md).
2. **Canonical edge-function sequence** (2026-04-21 PM, Masha-confirmed):
   - **Tier-0 (free, frontend-invoked via `/api/edge/*`):** `evidence_processed_v2` → `run_case_extract_v4` (may fire multiple times through the gap loop; validation is a Postgres trigger) → `bright-function`.
   - **Tier-1 (paid, invoked only from the Render worker after Stripe):** `run_case_decision_v1` → `run_report_selfserve_v1`.
   - **Fallback-only (Masha-internal, Supabase Dashboard):** `candidate-transactions`, `compute-loss`. Not wired in any hook, route, or UI.
   - **Archived:** `gemini-task`, `run_case_extract_v{1,2,3}`. Do not call anywhere.
3. **Pre-login narrative capture** — client-side only: `sessionStorage` + Clerk `unsafeMetadata`. No anonymous Supabase rows. First authenticated request `POST /api/cases/bootstrap` materialises `cases` + `case_intake` via `createUserClient()` (RLS fills `user_id`). Keeps Slice 0 Pattern C fully intact (no nullable `user_id`, no new RLS policies, no claim-flow cron). SM R13.
4. **Post-payment job mechanism** — Stripe webhook writes a row to `public.jobs`. A Render Cron worker polls every ~5 seconds, picks one row via `FOR UPDATE SKIP LOCKED`, (a) **conditionally re-runs `evidence_processed_v2` and `run_case_extract_v4`** per SM R14 if new documents or new `case_intake` rows exist since the last decision run, then (b) calls `/api/edge/decision`, then (c) calls `/api/edge/report`, updating job status throughout. Full audit trail; survives worker restarts. Decision does **not** run in Tier-0 (SM R9).
5. **Layer 3 = Tier 2 (post–Tier-1) — one surface, two concerns: form + hero + commerce + WhatsApp.** In this app’s schema, **“Layer 3” and “Tier 2” refer to the same post–Tier-1 stage** (after the self-serve **report** exists). The route/shell **includes** the **human-in-the-loop** FIDReC handoff: `POST /api/contact-requests` → `upsert` (UNIQUE on `user_id + case_id`) into the contact-requests table **plus** email to Dance. **User-entered fields** and **server-captured** fields are unchanged (see IS §9.9). **No edge function** on the `contact-requests` path — **R12 in §10.2** = no `functions/v1` or `/api/edge/*` *inside* the contact route. **2026-04-26 — WhatsApp (required):** add a **persistent** WhatsApp entry point in the **root layout** so it appears on **every URL**, **including pre-login marketing, landing, and the authed app**. On **this same Layer 3 / Tier 2 view**, add **on-page** copy recommending the user **reach out to our Scam and Fraud Specialist** for **consult or Q&A** (and **book** consult if unsure on FIDReC), in addition to the always-visible widget. **R13:** WhatsApp on public pages is **third-party** (`wa.me` link) only — **no** Supabase browser client on pre-login. **No Clerk session required** to open WhatsApp — same as current **[app/layout.tsx](../app/layout.tsx)** (fixed bottom-right + footer; number `6590727915`). **Do not** add a second duplicate site-wide widget; **reuse/keep** that implementation. Optional Layer 3-only deep links: reuse **[components/state-machine/layer3/specialist-card.tsx](../components/state-machine/layer3/specialist-card.tsx)** patterns (`buildWhatsAppUrl`, prefill) where product wants richer CTAs. **LinkedIn** and generic “coming soon” waitlist framing **remain** out of scope. Storage table name per IS §10.5. **Slice 8** (§10.6) adds the **SGD 99** + **SGD 800** Stripe checkouts *onto this surface*; same `checkout.session.completed` webhook **branching** as self-serve.
6. **Post–Tier-1 FIDReC / case-pack hero + Tier-2 SKUs (Slice 8).** *Elaboration of the same surface as locked decision 5.* Funnel copy targets users who **tried the bank, were rejected,** and may take the **FIDReC** path (to **adjudication** as last stage of mediation). **SGD 99** — 30 min with **Scam and Fraud** / **marketplace specialist** (Singapore); **SGD 800** — **case pack** prep. **Engineering** — **reuse** Tier-0→1 Stripe pattern: `create-checkout-session` + `metadata` discriminator; **`/api/webhooks/stripe`** additional branches. **R9** preserved (webhook does not call decision/report for jobs).

---

## 2. Slice map and status

| Slice | Scope | Status |
|---|---|---|
| 0 | Clerk + Supabase Third-Party Auth setup, wipe test users, retire Pattern B glue | Ready |
| 1 | Foundations: `lib/edge-functions.ts` (5 active + audit-only guards), Supabase client factory, types, TanStack Query, error/loading components | Done |
| 2 | Server-route wrapper template + **5** `/api/edge/*` routes (`evidence`, `extract`, `tier0`, `decision`, `report`) — no `candidate-transactions`, no `compute-loss`, no `gemini-task` | Done |
| 3A | Layer 1 UI components | Done |
| 3B | Transition UI components | Done |
| 3C | Layer 2 UI components | Done |
| 3D | Layer 3 UI components (rewritten 2026-04-21 PM late-afternoon to a human-in-the-loop form — identity + age + employment + two FIDReC-qualification booleans + optional message; amount lost + FI shown read-only. See Slice 4D for the hook) | Done |
| 4A | Layer 1 data hooks (**8** hooks — see §4 below; no CT/CL hooks) | Pending |
| 4B | Transition hooks (2 hooks) | Pending |
| 4C | Layer 2 hooks (4 hooks, includes `useJobStatus`) | Pending |
| 4D | Layer 3 hook (`useSubmitContactRequest` — was `useSubmitWaitlist`) | Pending |
| 5 | Wiring: driver hook, `dashboard-client.tsx` rewrite, new server routes (including **`/api/cases/bootstrap`** for R13 and **`/api/contact-requests`** for L3), Realtime provider, error boundaries | Pending |
| 6 | Background infra: `jobs` table migration, Stripe webhook rewrite, Render Cron worker (implements **SM R14** conditional upstream re-runs) | Pending |
| 7 | Cleanup: delete obsolete routes + Pattern B remnants, delete repo copies of archived / fallback edge-function folders if present, CI grep script (5-function allowlist + CT/CL/gemini-task blocklist), Appendix B.10 E2E smoke | Pending |
| 8 | **Layer 3 / Tier 2 — commerce:** FIDReC case-pack **hero**, **SGD 99** + **SGD 800** (reused checkout + webhook). **WhatsApp:** keep `app/layout.tsx`; L3 **copy** (see locked decision 5) | Pending (depends: Slices 5–6 Stripe) |

---

## 3. Slice 0 — Clerk + Supabase Third-Party Auth (Pattern C)

Full procedure in [docs/runbooks/slice-0-auth-reconciliation.md](./runbooks/slice-0-auth-reconciliation.md) and [docs/State-Machine-Workflow.md Appendix D](./State-Machine-Workflow.md). Summary:

1. Create Clerk JWT template `supabase` (claims in runbook §1.2). Copy the JWKS URL.
2. Enable Clerk as a Third-Party Auth provider in Supabase with that JWKS URL, issuer URL, audience `authenticated`.
3. Back up Supabase, `TRUNCATE ... CASCADE` user-scoped tables + `DELETE FROM auth.users`. Delete all Clerk test users.
4. Rewrite [lib/auth.ts](../lib/auth.ts) to the two-line `getCurrentUser()` helper (runbook §3.1). Delete `getOrCreateProfile()` and the TODO block.
5. Delete the `public.profiles` insert branch in [app/api/webhooks/clerk/route.ts](../app/api/webhooks/clerk/route.ts).
6. `rg "profileId|getOrCreateProfile" app/ lib/` → 0 hits.
7. Run the three smoke tests in runbook §4. All three must pass.

**Done condition.** TODO block gone, three smoke tests green, Findings table filled in.

---

## 4. Slice 4A — Layer 1 data hooks

New files under `hooks/state-machine/layer1/`, all client hooks using TanStack Query + [hooks/state-machine/use-supabase-browser.ts](../hooks/state-machine/use-supabase-browser.ts) + the [hooks/state-machine/query-keys.ts](../hooks/state-machine/query-keys.ts) namespace.

**Scope reminder (2026-04-21 PM).** These hooks cover the **3-function Tier-0 sequence** (`evidence_processed_v2` → `run_case_extract_v4` → `bright-function`). There are **no** hooks for `candidate-transactions` or `compute-loss` — those are Masha-internal fallbacks fired from the Supabase Dashboard (Locked decision 2). There is **no** "validation function" hook — validation rows are populated by a Postgres trigger on `case_extract_runs` (SM R5). There is **no** Layer 1 decision hook — decision runs in Layer 2 only, on the Render worker (SM R9).

- `use-submit-intake.ts` — `useMutation` POST `/api/edge/extract` (IS §4.1). Fires on the first extract call after bootstrap (SM R11 clause a) and on every gap-question answer (SM R11 clause b). On success invalidate `qk.case.extract`, `qk.case.validation`, `qk.case.eligibility`, `qk.case.narratives`.
- `use-case-eligibility.ts` — `useQuery` calling RPC `get_case_eligibility(p_case_id)` (IS §10.4, SM R5). Returns `CaseEligibilityResponse`. `staleTime: 5000`.
- `use-validation-run.ts` — two-step read per SM R5: `eligibility.resolved_ids.validation_run_id`, then `SELECT * FROM case_validation_runs WHERE id = :validation_run_id`. Never calls a "validation edge function" — validation is a Postgres trigger.
- `use-upload-evidence.ts` — `useMutation`: upload to Storage, insert `case_documents` row, POST `/api/edge/evidence` (IS §4.3, SM R11 clause c). MIME whitelist already in the UI component (PDF / PNG / JPEG / DOCX per SM R7).
- `use-case-documents-realtime.ts` — `postgres_changes` on `case_documents` filtered by `case_id` (SM R8). Updates `qk.case.documents(caseId)` cache directly. Auto-reconnect on `CHANNEL_ERROR`.
- `use-tier0-draft.ts` — `useQuery` reading all rows from `case_narratives` where `case_id = :caseId`. Renders whichever rows exist (SM R6). No dependency on a decision run (SM R9 — `bright-function` is *not* gated on decision).
- `use-auto-refire-extract.ts` — `useEffect` that re-POSTs `/api/edge/extract` on every successful `evidence_processed_v2` response that flips at least one `case_documents.processing_status` to `'ready'` (SM R11 clause c). Ref-guarded.
- `use-tier0-auto-fire.ts` — `useEffect` that POSTs `/api/edge/tier0` **exactly once** per case, iff **all three** conditions hold (SM R10): `missing_fields.length === 0`, at least one `case_documents.processing_status === 'ready'`, and the freshness-check extract pass has completed (latest `case_extract_runs.created_at > latest ready case_documents.updated_at`). Ref-guarded via a `case_narratives` exists-check so re-mounts never re-fire.

**Acceptance criteria.**

- No hook in `hooks/state-machine/layer1/` references `candidate-transactions`, `compute-loss`, `gemini-task`, or `run_case_extract_v{1,2,3}`.
- Every edge-function call goes through `/api/edge/*` (SM R1); every function name comes from `lib/edge-functions.ts` (SM R2).
- `use-tier0-auto-fire.ts` never sets `force: true` (SM R4) and never fires twice (idempotent via the `case_narratives` exists-check).
- No Layer 1 hook subscribes to `case_decision_runs` or `reports` — those belong to Slice 4C.

---

## 5. Slice 4B — Transition hooks

Under `hooks/state-machine/transition/`:

- `use-create-checkout-session.ts` — `useMutation` POST `/api/stripe/create-checkout-session`. Redirects to returned Stripe URL.
- `use-payment-status.ts` — polls `case_entitlements` every 2s via `refetchInterval`. Stops once `plan === 'self_serve_report'`.

---

## 6. Slice 4C — Layer 2 hooks

Under `hooks/state-machine/layer2/`:

- `use-decision-run-realtime.ts` — Realtime on `case_decision_runs` filtered by `case_id`. Updates `qk.case.decision(caseId)`.
- `use-report-realtime.ts` — Realtime on `reports` filtered by `case_id`. Updates `qk.case.report(caseId)`.
- `use-latest-report.ts` — `useQuery` reading `reports` ordered `created_at DESC LIMIT 1` (SM R3). Never `force: true`.
- `use-job-status.ts` — polls `/api/cases/[id]/job-status` every 2s while Layer 2 is mounted. Returns `{ status, error? }`. Drives the Layer 2 progress copy.

---

## 7. Slice 4D — Layer 3 hook

**Scope reminder (2026-04-21 PM late-afternoon; updated 2026-04-26).** **Layer 3 = Tier 2** — the **post–Tier-1** handoff and marketplace surface. The **form** is the human-in-the-loop FIDReC path: **User-entered fields:** first name, last name, email, phone (auto-filled from Clerk, editable), `age` (int 13–120), `employment_status` (`professional` / `retiree` / `student` / `other`), `thirty_days_since_last_fi_reply` (boolean), `fi_issued_final_response` (boolean), optional `message` (≤ 500 chars). **Server-captured, never on the wire:** `user_id`, `case_id`, `amount_lost_sgd`, `financial_institution`. Submit upserts one row and emails Dance. No edge function on this route (SM R12 = no `functions/v1` in route). **WhatsApp (required, 2026-04-26):** **persistent** shell widget + on-page **Scam and Fraud Specialist** consult/Q&A **recommendation** on this view (see **locked decision 5**). No LinkedIn CTAs, no "coming soon" waitlist. **Slice 8** adds SGD 99/800 to this **same** surface.

- `hooks/state-machine/layer3/use-submit-contact-request.ts` — `useMutation` POST `/api/contact-requests`. Body schema (mirrors route Zod in Slice 5 §8.4): `{ case_id, first_name, last_name, email, phone, age, employment_status, thirty_days_since_last_fi_reply, fi_issued_final_response, message? }`. **Does NOT include `user_id`, `amount_lost_sgd`, or `financial_institution`** — those are server-side guardrails. Invalidates `qk.case.contactRequest(caseId)` on success. Exposes `isPending` / `isError` / `data` for UI state. The route (Slice 5 §8.4) handles auth, Zod validation, RLS ownership probe, snapshot read from latest `case_extract_runs`, the `upsert`, and the email; the hook is just a thin client wrapper.

**Acceptance criteria (Slice 4D).**
- Hook calls `/api/contact-requests` with the exact field set above — no extras.
- On 201, `onSuccess` resolves with `{ ok: true, id }` and invalidates `qk.case.contactRequest(caseId)`.
- On 4xx/5xx, surfaces a typed error the `waitlist-form.tsx` component can branch on (Zod failure → per-field inline error; 403 → "please sign in again"; 500 → retry toast).
- Unit test (vitest + msw) — POST body equals expected shape; re-submit on the same `(user_id, case_id)` works because the route upserts.

**Naming note.** The previously planned file was `use-submit-waitlist.ts` calling `/api/waitlist`. Renamed to `use-submit-contact-request.ts` calling `/api/contact-requests` to match the 2026-04-21 PM design (IS §9.9 rewrite, SM R12). The underlying storage table stays `escalation_waitlist` short-term per IS §10.5; follow-up migration renames it to `contact_requests`. Neither the hook nor the route should assume the post-rename name until that migration lands.

**Acceptance criteria.**

- Hook does not import anything from `lib/edge-functions.ts` (Layer 3 is edge-function-free — SM R12).
- Route-level email side effect is implemented in Slice 5; the hook only observes the mutation result.

---

## 8. Slice 5 — Wiring

### 8.1 Driver hook

`hooks/state-machine/use-state-machine.ts`: pure function that given `{ case, eligibility, validation, narratives, entitlement, documents, decision, report, job, waitlist }` returns the current node name (one of ~20 nodes from SM §3–§6). The shell components consume `node` and render accordingly.

### 8.2 Rewrite [app/app/case/[id]/dashboard/_components/dashboard-client.tsx](../app/app/case/[id]/dashboard/_components/dashboard-client.tsx)

Strip imperative fetching. Call every Slice 4 hook relevant to the current layer, feed outputs into `useStateMachine()`, render exactly one of `<Layer1Shell>` / `<Layer2Shell>` / `<Layer3Shell>` / transition components based on `node`. Wrap in error boundary.

### 8.3 Rewrite [app/app/case/new/page.tsx](../app/app/case/new/page.tsx) → bootstrap from pre-login narrative

Per **SM R13 + Locked decision 3**, the public landing page stores the hero-prompt narrative + transcript in `sessionStorage` (and in Clerk `unsafeMetadata` once the user opens the Clerk sign-up widget). No Supabase write happens before Clerk auth succeeds.

After Clerk returns, the post-login landing code:

1. Reads `sessionStorage.getItem('gb_pending_narrative')` (or Clerk `unsafeMetadata.pending_narrative` as fallback).
2. If present, POSTs to `/api/cases/bootstrap` with `{ narrative, transcript?, claim_type?, title? }`.
3. Clears `sessionStorage` on 201; navigates to `/app/case/[id]/dashboard`.
4. If no pending narrative exists (e.g. returning user navigating straight to the app), renders the existing "new case" form which also POSTs to `/api/cases/bootstrap` with the form body.

`app/app/case/new/page.tsx` becomes a thin client component that wraps the shared `useBootstrapCase()` mutation — there's no standalone `/api/cases/create` route; bootstrap handles both paths.

### 8.4 New server routes

- `app/api/cases/bootstrap/route.ts` — Clerk session required. Uses `createUserClient()` to `INSERT INTO cases (claim_type, title) VALUES (...) RETURNING id` (RLS `WITH CHECK` fills `user_id` from `auth.uid()`), then `INSERT INTO case_intake (case_id, intake_type, narrative, transcript) VALUES (:id, 'initial', ..., ...)` in the same user-scoped client. Returns `{ case_id }`. **No service-role fallback** — unauthenticated callers get 401, never an anonymous row (SM R13). See [runbooks/slice-0-auth-reconciliation.md](./runbooks/slice-0-auth-reconciliation.md) §3.4 for the reference implementation.
- `app/api/cases/[id]/job-status/route.ts` — Clerk-authenticated, RLS-scoped read of the latest `jobs` row for this case.
- `app/api/contact-requests/route.ts` — human-in-the-loop FIDReC handoff endpoint. Full spec in IS §9.9 + §10.5 (reference implementation sketch included). Behavior:
  1. **Clerk session check** — 401 if no user.
  2. **Zod body validation** — body is `{ case_id: uuid, first_name, last_name, email, phone, age (13–120 int), employment_status (enum), thirty_days_since_last_fi_reply (bool), fi_issued_final_response (bool), message? (≤500 chars) }`. 400 on parse failure with `{ error: 'invalid_body', details }`. **Reject bodies that include `user_id`, `amount_lost_sgd`, or `financial_institution`** — those are server-side guardrails (R12 audit guard).
  3. **RLS-scoped ownership probe + snapshot read in one round trip** — `createUserClient()`, then `select` from `cases` joined to `case_extract_runs` (`order created_at desc limit 1`). RLS filters to `auth.uid() = cases.user_id`; `maybeSingle()` returning null → 404. Pull `amount_lost_sgd` from `extract.losses.reported_loss.amount` (fallback `cases.claim_amount`) and `financial_institution` from `extract.case_meta.institution_name` (fallback `cases.institution_name`). Both may be `null` — that's OK, the columns are nullable.
  4. **`upsert` into the contact-requests storage table** — currently `escalation_waitlist` per IS §10.5 (schema includes the new columns + CHECK constraints; post-migration: `contact_requests`). `onConflict: 'user_id,case_id'` so re-submits overwrite. `user_id` is NOT in the insert payload — it's filled by the `DEFAULT auth.uid()` column. `amount_lost_sgd` and `financial_institution` come from the snapshot, NOT from the request body.
  5. **Send notification email to Dance** via Resend (or equivalent) containing `{ id, case_id, name, email, phone, age, employment_status, thirty_days_since_last_fi_reply, fi_issued_final_response, amount_lost_sgd, financial_institution, message?, submitted_at }`. Email failures are `.catch(console.error)` — they do NOT fail the request (the row is the source of truth; Dance can re-check the storage table if email delivery fails).
  6. Returns `201` with `{ ok: true, id }`. Returns `403` on RLS `42501` violations, `500` on any other Supabase error.
- `app/api/stripe/create-checkout-session/route.ts` — creates a checkout session with `case_id` and `user_id` in `metadata` (consumed by the webhook in Slice 6).

### 8.5 Realtime provider

`components/providers/realtime-provider.tsx` opens one Supabase Realtime WebSocket via `useSupabaseBrowser()` and exposes it via context so every hook reuses the same connection. Wire into [app/layout.tsx](../app/layout.tsx) inside `<QueryProvider>`.

### 8.6 Error boundaries

`components/providers/error-boundary.tsx` — React class boundary that renders `<StateMachineErrorCard kind="internal" />` on uncaught exceptions. Wrap the app shell in `app/layout.tsx`.

---

## 9. Slice 6 — Background infra

### 9.1 `jobs` table migration

New file `supabase/migrations/<timestamp>_add_jobs_table.sql`:

```sql
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null check (kind in ('report_generate')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  payload jsonb not null default '{}'::jsonb,
  error text,
  retry_count int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index jobs_queued_created_at_idx on public.jobs (created_at) where status = 'queued';
create index jobs_case_id_idx on public.jobs (case_id);

alter table public.jobs enable row level security;

create policy "jobs_select_own" on public.jobs
  for select using (
    exists (select 1 from public.cases c where c.id = jobs.case_id and c.user_id = auth.uid())
  );
-- No insert/update policies → service-role only for writes (webhook + worker).
```

### 9.2 Stripe webhook rewrite

[app/api/webhooks/stripe/route.ts](../app/api/webhooks/stripe/route.ts) on `checkout.session.completed`:

1. Verify Stripe signature.
2. Read `case_id` from `metadata`.
3. Service-role client: `UPDATE case_entitlements SET plan='self_serve_report' WHERE case_id=:id`, then `INSERT INTO jobs (case_id, kind, status) VALUES (:id, 'report_generate', 'queued')`.
4. Return 200 in under 1 second. No edge-function calls (SM R9).

### 9.3 Render background worker

New directory `worker/` with `worker/index.ts`. Deployed as a Render background worker that loops every ~5 seconds:

```sql
begin;
select * from public.jobs
where status = 'queued'
order by created_at asc
for update skip locked
limit 1;
-- if no row: commit and sleep 5s
update public.jobs set status='running', started_at=now() where id=$1;
commit;
```

Then executes the **canonical Tier-1 sequence** per Locked decision 4 / SM R14:

1. **Conditional evidence re-run (SM R14 clause a).** Query `SELECT 1 FROM case_documents WHERE case_id = :id AND (last_decision_run_at IS NULL OR updated_at > last_decision_run_at) LIMIT 1`. If any row exists, POST `/api/edge/evidence`. Otherwise skip.
2. **Conditional extract freshness re-run (SM R14 clause b).** Query `SELECT 1 FROM case_intake WHERE case_id = :id AND (last_decision_run_at IS NULL OR created_at > last_decision_run_at) LIMIT 1` OR fall through from step 1. If either is true, POST `/api/edge/extract` (one final freshness pass). Otherwise skip.
3. **Decision (always runs).** POST `/api/edge/decision`. Blocks until `case_decision_runs` has a row with `case_id = :id` created after the job's `started_at`.
4. **Report (always runs).** POST `/api/edge/report`. Blocks until `reports` has a `status='COMPLETED'` row for this case.

All four HTTP calls go through `/api/edge/*` (SM R1) — the worker never hits Supabase edge functions directly. On success: `UPDATE jobs SET status='completed', completed_at=now()`. On failure at any step: `UPDATE jobs SET status='failed', error=…, retry_count=retry_count+1`.

**Implementation note (SM R14 tracking).** The worker needs a "last decision run" cutoff per case to decide whether steps 1–2 should fire. Two acceptable implementations:
- **Option A (simplest):** `SELECT MAX(created_at) FROM case_decision_runs WHERE case_id = :id` once at job start, then compare against `case_documents.updated_at` and `case_intake.created_at`. No schema change. First Tier-1 run has `NULL` cutoff → both upstream re-runs fire once (by design — this is the first freshness pass).
- **Option B:** Add `last_decision_run_at timestamptz` columns to `case_documents` and `case_intake` that the decision edge function stamps when it runs. Slightly more writes, cleaner queries. Defer to post-MVP.

Start with **Option A** in Slice 6. No migration required.

Add a `render.yaml` entry for a new `type: worker` service. Auth mechanism for the worker's calls into `/api/edge/*` is finalised at the start of Slice 6 (parked sub-decision — likely a service-role Supabase token plus an admin Clerk machine-to-machine token).

---

## 10. Slice 7 — Cleanup

### 10.1 Delete obsolete routes and Pattern B remnants

- Any route whose only purpose was the old `getOrCreateProfile()` flow.
- Any `/api/*` route that directly calls a Supabase edge function (SM R1 says none should remain outside `/api/edge/*`).
- `app/api/webhooks/clerk/route.ts` profile-insert branch (redundant since Slice 0 — verify it's gone).
- **`/api/waitlist` route**, if it was created ahead of the 2026-04-21 PM rename. Replace fully with `/api/contact-requests` (Slice 5 §8.4).

### 10.2 CI grep script

New `scripts/check-state-machine-rules.sh` enforcing the [State Machine §9](./State-Machine-Workflow.md) verification checklist as `rg` assertions:

- **R1** — `functions/v1` only appears inside `app/api/edge/*/route.ts`.
- **R2 allowlist** — the five active function names (`evidence_processed_v2`, `run_case_extract_v4`, `bright-function`, `run_case_decision_v1`, `run_report_selfserve_v1`) only appear in `lib/edge-functions.ts`, `app/api/edge/*/route.ts`, docs, and test files.
- **R2 blocklist (2026-04-21 PM)** — `candidate-transactions`, `compute-loss`, `gemini-task`, `run_case_extract_v1`, `run_case_extract_v2`, `run_case_extract_v3` only appear in `lib/edge-functions.ts` as audit-only guard constants or in `docs/`. **Zero hits** in `app/`, `components/`, `hooks/`, `services/`, `worker/`, or anywhere else under application source.
- **R4** — no `force:\s*true` anywhere under `app/` or `lib/`.
- **R5** — no `v_latest_validation` hits under `app/` or `lib/`; no reference to a "validation edge function" (validation is a Postgres trigger).
- **R6** — Tier-0 draft component renders each narrative panel independently (manual check).
- **R8** — no `setInterval.*case_documents` hits.
- **R9** — Stripe webhook does not reference `/api/edge/decision` or `/api/edge/report` (must be worker-only).
- **R12** — no `/api/edge/*` (and no `functions/v1`) **inside** Layer 3 / Tier 2 **UI components** that only render the handoff, **or** inside **`app/api/contact-requests/route.ts`**. (Supersedes 2026-04-21 PM *wording* that implied “no WhatsApp on L3” — product **2026-04-26** requires **WhatsApp**; verify via **E2E**, not `rg`.) **R12a (manual):** [app/layout.tsx](../app/layout.tsx) `wa.me` **unchanged** (no second FAB); **Layer 3 / Tier 2** has Scam and Fraud **recommendation** copy; **anonymous** can use WhatsApp.
- **R13** — landing-page hero component has zero Supabase client imports on any pre-login code path; `/api/cases/bootstrap` has zero `SUPABASE_SERVICE_ROLE_KEY` references. **2026-04-26 — WhatsApp** on **pre-login** is **allowed** when implemented as a **non-Supabase** embed/link/script only; **does not** relax the **no Supabase** rule on public paths.

Wire as `pnpm check:sm` and into the pre-deploy pipeline.

### 10.3 Repo cleanup tickets

- **Delete `supabase/functions/run_case_extract_v{1,2,3}` folders from the repo.** Masha archived them from the Supabase project on 2026-04-21 (see `docs/2026-04-21-Masha-Feedback-Reconciliation.md` §4); this ticket is now a repo-only cleanup.
- **Delete `supabase/functions/gemini-task`** from the repo, if present. Archived function (Locked decision 2).
- **Delete `supabase/functions/candidate-transactions`** and `supabase/functions/compute-loss` from the repo **only if** they're frontend-repo copies. If Masha's canonical source lives in a separate repo or directly in the Supabase Dashboard, leave the frontend repo clean and do nothing (these are Masha-internal fallbacks, not frontend-invoked).
- **Rename storage table `escalation_waitlist` → `contact_requests`** (IS §10.5 + Locked decision 5). Write a Supabase migration that renames the table + RLS policies and updates the insert path in `/api/contact-requests/route.ts`. Migration must also cover the 2026-04-21 PM late-afternoon columns added in IS §10.5 (`age`, `employment_status`, `thirty_days_since_last_fi_reply`, `fi_issued_final_response`, `amount_lost_sgd`, `financial_institution`, `message`) and their `CHECK` constraints — confirm the rename preserves them. Post-MVP if rename risk outweighs naming benefit.

### 10.4 Masha backlog tickets

- Add `.txt` support to `run_case_extract_v4` (SM §7 upload node).
- Extend `evidence_processed_v2` to handle DOCX natively (IS §10.2).
- Add audit trail for `run_case_decision_v1` re-runs (SM R4 note; IS §9.8).
- Post-MVP: switch Render worker from Option A to Option B for R14 cutoff tracking if the `MAX(created_at)` query becomes a hot path (Slice 6 §9.3).

### 10.5 Appendix B.10 E2E smoke

Execute the 9-step reviewer walkthrough in [docs/State-Machine-Workflow.md Appendix B](./State-Machine-Workflow.md). All nine steps must pass for Slice 7 to be done. **Add steps 10–11** below (2026-04-21 PM + 2026-04-26 L3 = Tier 2 + WhatsApp):

10. Submit a Layer 3 contact form with the full field set (first name, last name, email, phone, age, employment status, both FIDReC-qualification booleans, optional message). Confirm one row lands in the contact-requests storage table with `user_id = auth.uid()`, the correct `age` + `employment_status` + both booleans, and server-captured `amount_lost_sgd` + `financial_institution` matching what the latest `case_extract_runs.extract_json` holds. Confirm Dance receives the notification email with all those fields. Re-submit the form with `fi_issued_final_response` flipped from `false` to `true` and confirm the `UNIQUE (user_id, case_id)` constraint upserts the existing row (one row total per user per case). Confirm the UI shows the "Thanks — we'll be in touch within 1–2 business days" confirmation state.

11. **2026-04-26 — Layer 3 = Tier 2, WhatsApp.** Confirm **[app/layout.tsx](../app/layout.tsx)** **persistent** `wa.me/6590727915` on **every URL**; **as anonymous visitor**, open link (**no login**). **R13:** no **Supabase** on pre-login hero. On **Layer 3 / Tier 2**, confirm on-page **Scam and Fraud Specialist** consult/Q&A **recommendation**. After Slice 8, **SGD 99** / **SGD 800** on same surface if not in E2E #4.

### 10.6 FIDReC case pack and marketplace SKUs (Slice 8) — same surface as Layer 3 / Tier 2

**Schema.** This is **not** a second “Tier-2 only” URL distinct from “Layer 3” — **Layer 3 and Tier 2 are the same post–Tier-1 stage** (locked decision 5). Slice 8 adds the **hero + paid SKUs** on that surface; **WhatsApp** (persistent + page recommendation) is **Layer 3 / Tier 2** per locked decision 5, not a separate route rule.

**Problem.** After Tier-1, users who **tried the bank, were rejected,** and want the **FIDReC** path need a clear next step. **Solution (product).** A **post–Tier-1** **hero** on the **Layer 3 / Tier 2** view explains the **case pack** and **specialist** paths.

**Commerce (two SKUs, Stripe test + prod Price IDs in env).**

| Offer | Price (SGD) | Intent |
|--------|----------------|--------|
| Specialist consult | **99** | 30 minutes — **Scam and Fraud** / **marketplace specialist** (Singapore). |
| Case pack prep | **800** | Case pack **strong enough for FIDReC adjudication** (last stage of the FIDReC mediation process). |

**Engineering (reuse, do not re-invent).** Mirror **Slice 5–6** checkout + webhook: extend **`POST`** checkout-session route to accept a **known product key** (e.g. `specialist_consult_30m` | `case_pack_fidrec`) and pass **`case_id` + user + product** in **Stripe `metadata`**. In **`/api/webhooks/stripe`**, add **`checkout.session.completed` branches** that (a) verify signature, (b) route by `metadata` / price, (c) persist **purchase/entitlement** in Postgres (new table or columns — design in slice) and any **outbound** notification to operations/marketplace. **No** Tier-0/Tier-1 **edge** functions for these products unless a future contract says otherwise. Keep **R9** — **webhook** still must **not** call `/api/edge/decision` or `/api/edge/report` for *these* or **self-serve** rows.

**UX — WhatsApp (locked decision 5).** **Already live** in [app/layout.tsx](../app/layout.tsx): fixed `Link` to `https://wa.me/6590727915` (bottom-right) + footer — **all routes**, pre-login and authed; **anonymous users** can contact the specialist (no sign-in). **R13:** `wa.me` only, no Supabase on public paths. On **Layer 3 / Tier 2** (hero + form + SKUs), add **on-page** **Scam and Fraud Specialist** **consult** / **Q&A** copy (legal). Refactor: **no new** global WhatsApp — extend **copy/hero** and optionally [specialist-card.tsx](../components/state-machine/layer3/specialist-card.tsx) on L3.

**Visibility.** Gated on **self-serve report present / eligible** (e.g. `reports.status = 'COMPLETED'` and/or entitlement flag). Funnel copy may reference “bank did not accept your claim” user journey; **Masha/legal** to approve disclaimers.

**Order of work.** **Slice 8** after **Stripe for Tier-1** (5–6) and ideally after **7**; extend **`pnpm check:sm`** for new files (R12: still **no** `/api/edge/*` in L3 *component files* that are only the form shell **and** the `contact-requests` **route** — see §10.2; WhatsApp is **not** a grep check).

---

## 11. End-to-end data flow (2026-04-21 PM canonical)

```mermaid
sequenceDiagram
    participant User
    participant Landing as Public Landing (client-only)
    participant UI as Next.js UI (authed)
    participant Route as /api/edge/*
    participant Bootstrap as /api/cases/bootstrap
    participant Supabase
    participant Stripe
    participant Webhook as /api/webhooks/stripe
    participant Jobs as public.jobs
    participant Worker as Render Cron Worker
    participant Contact as /api/contact-requests

    Note over User,Landing: Pre-login (CLIENT-SIDE ONLY — SM R13)
    User->>Landing: Type / voice-record story
    Landing->>Landing: Persist to sessionStorage + Clerk unsafeMetadata
    User->>Landing: Clerk sign-up / sign-in

    Note over UI,Bootstrap: First authed request (materialises case)
    UI->>Bootstrap: POST { narrative, transcript? }
    Bootstrap->>Supabase: INSERT cases + case_intake (createUserClient)
    Bootstrap-->>UI: { case_id }

    Note over UI,Route: Tier-0 sequence (3 functions)
    UI->>Route: POST /api/edge/extract (first fire, R11a)
    Route->>Supabase: invoke run_case_extract_v4
    Supabase-->>UI: via Realtime on case_extract_runs
    loop Gap loop (R11b)
        User->>UI: Answer gap question
        UI->>Route: POST /api/edge/extract
    end
    User->>UI: Upload evidence
    UI->>Route: POST /api/edge/evidence
    Route->>Supabase: invoke evidence_processed_v2
    Supabase-->>UI: case_documents.processing_status='ready'
    UI->>Route: POST /api/edge/extract (auto re-fire, R11c)
    Note over UI: Freshness-check extract pass (R10)
    UI->>Route: POST /api/edge/tier0 (once, R10)
    Route->>Supabase: invoke bright-function
    Supabase-->>UI: case_narratives rows appear
    UI-->>User: Tier-0 draft ready

    Note over User,Stripe: Optional upgrade to Tier-1
    User->>UI: Click Buy Report
    UI->>Stripe: create-checkout-session (case_id + user_id in metadata)
    User->>Stripe: Pay
    Stripe->>Webhook: checkout.session.completed
    Webhook->>Supabase: UPDATE case_entitlements, INSERT jobs row (<1s)
    Webhook-->>Stripe: 200

    Note over Worker,Route: Tier-1 sequence (2 functions + conditional upstream)
    loop every 5 seconds
        Worker->>Jobs: SELECT queued FOR UPDATE SKIP LOCKED
    end
    alt New documents since last decision (R14a)
        Worker->>Route: POST /api/edge/evidence
        Route->>Supabase: invoke evidence_processed_v2
    end
    alt New intake or evidence re-ran (R14b)
        Worker->>Route: POST /api/edge/extract (freshness)
        Route->>Supabase: invoke run_case_extract_v4
    end
    Worker->>Route: POST /api/edge/decision (Layer 2 only, R9)
    Route->>Supabase: invoke run_case_decision_v1
    Supabase-->>UI: via Realtime on case_decision_runs
    Worker->>Route: POST /api/edge/report
    Route->>Supabase: invoke run_report_selfserve_v1
    Supabase-->>UI: via Realtime on reports (status=COMPLETED)
    UI-->>User: Report ready

    Note over User,Contact: Optional FIDReC handoff (Layer 3 human-in-the-loop — SM R12)
    User->>UI: Click "Need help escalating to FIDReC? → Get help from a specialist"
    UI->>UI: Render form (identity auto-filled; user enters age, employment, 2 FIDReC booleans, optional message; amount lost + FI shown read-only)
    UI->>Contact: POST { case_id, first_name, last_name, email, phone, age, employment_status, thirty_days_since_last_fi_reply, fi_issued_final_response, message? }
    Note over Contact: NO user_id / amount / FI on wire
    Contact->>Supabase: RLS ownership probe on cases + snapshot read of latest case_extract_runs
    Contact->>Supabase: upsert contact-requests row (UNIQUE user_id+case_id; user_id from auth.uid(); amount + FI from snapshot)
    Contact->>Contact: Send email to Dance (failure non-fatal)
    Contact-->>UI: 201 { ok, id }
    UI-->>User: "Thanks — we'll be in touch within 1–2 business days to help you prepare your FIDReC submission"
```

**Legend.**
- `candidate-transactions` / `compute-loss` are not in this diagram — Masha fires them manually from the Supabase Dashboard only when `run_case_extract_v4` fails to compute the loss amount (Locked decision 2).
- `gemini-task` is archived.
- Validation is a Postgres trigger on `case_extract_runs` — not a separate arrow.

---

## 12. Execution playbook

1. Execute Slice 0 against the runbook. Fill in the Findings table.
2. For each remaining slice in order (4A → 4B → 4C → 4D → 5 → 6 → 7 → **8** optional for Tier-2 post–Tier-1 marketplace; see §10.6):
   - Open a fresh agent chat.
   - Paste that slice's section from this document.
   - Paste the relevant section of [State Machine Workflow](./State-Machine-Workflow.md) (e.g. for 4A: §3 Diagram 1 and §7 checklist rows 1–4).
   - Add this reminder verbatim: *"Canonical sequence (2026-04-21 PM): Tier-0 = `evidence_processed_v2` → `run_case_extract_v4` (gap loop) → `bright-function`. Tier-1 = `run_case_decision_v1` → `run_report_selfserve_v1` (Render worker only). `candidate-transactions` and `compute-loss` are Masha-internal fallbacks only — the frontend never calls them. `gemini-task` is archived. Validation is a Postgres trigger, not an edge-function call. Pre-login narrative capture is client-side only (sessionStorage / Clerk unsafeMetadata), materialised via `POST /api/cases/bootstrap` on the first authed request. Layer 3 is a human-in-the-loop form (identity auto-filled + user-entered age / employment status / two FIDReC-qualification booleans / optional message; server snapshots `amount_lost_sgd` + `financial_institution` from latest `case_extract_runs`) → `POST /api/contact-requests` (upsert on `UNIQUE (user_id, case_id)`) + email Dance. Every edge-function call goes through `/api/edge/*`. Every function name comes from `lib/edge-functions.ts`. Realtime for `case_documents`. Never `force: true`."*
   - **Also add (2026-04-26, does not replace the verbatim block):** *"Layer 3 = Tier 2. WhatsApp: **keep** `app/layout.tsx` `wa.me/6590727915` (no login; no duplicate FAB). L3: Scam and Fraud copy. R13: third-party on public. Slice 8: SGD 99/800. See **locked decision 5–6**, **§10.6**."*
   - Run the slice. **Hand off to Dance** for the **targeted smoke** in §12.1 before starting the next slice. After slices **5**, **6**, and **7**, also run the corresponding **full localhost E2E** in §12.1 (three milestone runs total).

### 12.1 Test gates — seven targeted smokes + three full E2E (localhost)

**Operating model.** The implementer completes one slice; **Dance** runs the matching **targeted smoke** below and reports pass/fail. The next slice only starts when that targeted smoke is green. After **Slice 5**, **Slice 6**, and **Slice 7**, Dance additionally runs a **full localhost E2E** (E2E #1, #2, #3) — these are broader than the slice smokes.

**Seven targeted smokes (one per slice).**

- **4A (Layer 1):** No `candidate-transactions`, `compute-loss`, `gemini-task`, or `run_case_extract_v1|v2|v3` in `hooks/state-machine/layer1/`. All edge from these hooks via `/api/edge/*` only. `use-tier0-auto-fire`: no `force: true`, idempotent. No Layer 1 subscription to `case_decision_runs` or `reports`. Eligibility + validation: R5 two-step (RPC + `case_validation_runs` row) — no validation edge function.
- **4B (Transition):** `use-create-checkout-session` and `use-payment-status` only; payment poll stops when `case_entitlements.plan === 'self_serve_report'`. No decision/report side effects in transition hooks.
- **4C (Layer 2):** Realtime updates TanStack `qk` for decision and report. `use-job-status` polls the job-status API only — browser never calls `/api/edge/decision` or `/api/edge/report`. `use-latest-report` never uses `force: true`.
- **4D (Layer 3 hook = Tier 2):** `use-submit-contact-request` sends only the client field set; body must not include `user_id`, `amount_lost_sgd`, or `financial_institution`. Hook does not import `lib/edge-functions.ts`. **Tier-2 labelling:** Layer 3 hook serves the **post–Tier-1** contact path (same schema stage as **Tier 2**).
- **5 (Wiring):** `useStateMachine` + `dashboard-client` render one shell from `node`. `POST /api/cases/bootstrap` authenticated, no service-role in route. Pre-login handoff materialises one case. Realtime provider pattern sane. `POST /api/contact-requests` implements Zod + RLS + snapshot + upsert. **WhatsApp:** keep **[app/layout.tsx](../app/layout.tsx)** (`wa.me/6590727915`); **no login** to chat; add L3 **copy** only. **R13** on public paths unchanged. **Stripe:** repurpose checkout + webhook for Tier-0 → Tier-1; `jobs` in Slice 6.
- **6 (Background):** `checkout.session.completed` → entitlements + `jobs` row; webhook does **not** call decision/report. Worker uses R14 conditionals, then `/api/edge/*` for Tier-1. Stripe `4242…` test path: job `queued` → `completed` with worker.
- **7 (Cleanup):** `pnpm check:sm` passes (§10.2). Obsolete routes removed. R1: `functions/v1` not used outside `app/api/edge/*/route.ts`.
- **8 (L3 / Tier 2 commerce, §10.6):** With self-serve report completed, **case-pack hero** + **SGD 99** and **SGD 800** test checkouts; **`checkout.session.completed`** branches correct; **WhatsApp** = shell **(persistent)** + **L3 page** specialist line (R12: still no `/api/edge` in handoff **route**; see §10.2).

**Three full E2E smokes (milestones).**

- **E2E #1 — after Slice 5:** [Appendix B.10](./State-Machine-Workflow.md#b10-what-to-look-for-when-qa-tests-this-flow) **steps 1–7** (adds **Stripe test payment** and **`case_entitlements.plan = 'self_serve_report'`**). **Stripe is required** for the Tier-0 → Tier-1 upgrade; the repo’s existing checkout and webhook routes are **repurposed** in this slice (entitlement update). Also **R13** (landing → sign-in → `POST /api/cases/bootstrap` → one case). **2026-04-26:** **WhatsApp** from **root layout** on **pre-login** (visible on marketing); still **R13**-safe (no Supabase on public paths). If **`jobs` inserts** are introduced only in Slice 6, step 7 is satisfied when **entitlements + webhook 200** are proven; full **`jobs` lifecycle** is then **E2E #2**.
- **E2E #2 — after Slice 6:** Appendix B.10 **steps 1–9** including payment (`4242…`), `jobs` lifecycle, Layer 2 completion via **worker** (R9: no decision/report in webhook), and cross-user `case_id` probe **returns not success**.
- **E2E #3 — after Slice 7:** §10.5 — B.10 **1–9** plus **10–11** (L3 form; **11** = persistent WhatsApp + L3 Scam and Fraud specialist recommendation). Then **`pnpm check:sm`**. Declares Slice 4A–7 complete.
- **E2E #4 (after Slice 8, if in scope):** On **Layer 3 / Tier 2**, run **SGD 99** and **SGD 800** test checkouts; **webhook** + **DB**; **WhatsApp** link/chat + **Scam and Fraud Specialist** copy visible; **`pnpm check:sm`** if script changed in Slice 8.

## 13. Model recommendation

- **Claude Sonnet 4.5 (or Opus 4.5)** — primary recommendation for Slices 4A through 7. The slices require holding the Integration Summary, State Machine doc, and relevant code files in context simultaneously; 200k-token context is the single biggest predictor of first-pass correctness.
- **Codex / GPT-5** — acceptable for Slices 4A–4D, 6, and 7. For Slice 5's `useStateMachine()` driver, paste the specific SM diagrams into the prompt even though they live in the doc.
- **Do not swap models mid-refactor.** Consistency of idiom (how `qk` keys are spelled, how errors are thrown, how Realtime handlers update the cache) matters more than a marginal capability difference per slice.
