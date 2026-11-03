# Release environment and recovery

This contract applies to the Next.js app, Render worker, Supabase project, Clerk instance, Stripe account, and SMTP provider used by one environment. Preview and production must use separate credentials and data.

## Environment contract

### Next.js app

| Variable | Requirement |
| --- | --- |
| `HARBOR_DEPLOYMENT_ENVIRONMENT` | Explicit deployment class: `preview` or `production`. Checkout creation fails closed when absent or invalid. |
| `CHECKOUT_REDIRECT_ORIGIN` | Server-only HTTPS origin for Stripe success/cancel redirects, with no path, query, credentials, or fragment. It must exactly match `NEXT_PUBLIC_APP_URL`. Preview must not equal the production origin. |
| `HARBOR_PRODUCTION_APP_ORIGIN` | Server-only canonical production HTTPS origin. Preview checkout is rejected if it targets this origin; production checkout must match it exactly. |
| `NEXT_PUBLIC_APP_URL` | Canonical app origin for public links, app/worker communication, and comparison with the server-controlled checkout redirect origin. |
| `NEXT_PUBLIC_SITE_URL` | Public site origin and allowed redirect origin. |
| `RENDER_GIT_COMMIT` | Immutable full deployed Git SHA injected by Render. The app and worker fail closed when it is absent, empty, or malformed; no configurable fallback may attest a release. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same environment's Supabase project and public key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Never expose through a `NEXT_PUBLIC_` variable or browser bundle. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Same environment's Clerk instance. The Clerk `supabase` JWT template must sign a stable UUID as `supabase_uuid`. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Server-only Svix signing secret for the environment's `/api/webhooks/clerk` endpoint. Never reuse a Clerk API key. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Same Stripe mode and endpoint. Preview uses test-mode keys only. |
| `STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD` | One-time S$18 price. Currency and unit amount must match the catalogue. |
| `STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD` | One-time S$188 price. Currency and unit amount must match the catalogue. |
| `STRIPE_PRICE_ID_HUMAN_CONSULT_30M_SGD` | Optional legacy reference only. Consultation checkout and fulfilment are disabled; historic verified events are recorded without allocating a consultation. |
| `WORKER_SECRET` | High-entropy shared secret present only in the app and worker. Rotate both deployments together. |
| `EDGE_PROXY_HMAC_SECRET` | Server-only secret containing at least 32 random bytes. Supply the identical value to the app, worker, and Supabase Edge Functions. Never name it `NEXT_PUBLIC_*`, log it, place it in a request body, expose it to a browser, or substitute/forward a service-role key. |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_GENERATIVE_AI_MODEL` | Router, transcription, and legacy pack generation. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Server-side Tier 2 helpers. |
| `SIMULATION_KEY` | App-to-report-function secret; must match the Supabase function secret. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP transport. Use TLS and environment-specific credentials. |
| `SMTP_SECURE`, `SMTP_REQUIRE_TLS` | Use implicit TLS only when required by the provider; otherwise require STARTTLS. |
| `EMAIL_FROM`, `EMAIL_FROM_NAME`, `ADMIN_EMAIL` | `EMAIL_FROM` must belong to a provider-verified sender domain. |

Optional SMTP pool, timeout, and retry variables are documented in `.env.example`.

### Render worker

The worker requires `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `WORKER_SECRET`, and `EDGE_PROXY_HMAC_SECRET` with values matching the app environment. The HMAC secret must also exactly match the Supabase Edge secret; worker startup rejects values shorter than 32 bytes. Render must inject a valid `RENDER_GIT_COMMIT` for SHA-bound evidence; worker startup rejects a missing or malformed value. `WORKER_RUN_ONCE=1` is for controlled diagnostics only.

`WORKER_SECRET` authenticates worker-to-app requests but does not authorize arbitrary work. Every worker request must also identify a running durable job, its case, its optional document binding, type, and exact immutable `locked_at` claim token. The app and database re-check the DB-time lease before signing or accepting any mutation. The worker never forwards `EDGE_PROXY_HMAC_SECRET` or `SUPABASE_SERVICE_ROLE_KEY`; the app uses the former only to sign the canonical request envelope.

### Supabase

Apply migrations in filename order. Deploy Edge Functions from the same Git SHA. Required function secrets are:

- Platform-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- `GuideBuoy_EdgeFunction` and optional model selectors for OpenAI-backed functions.
- `GEMINI_API_KEY` and optional `EVIDENCE_GEMINI_MODEL` for evidence processing.
- `SIMULATION_KEY` matching the app for report generation.
- `EDGE_PROXY_HMAC_SECRET` matching the app and worker exactly, with at least 32 random bytes. Rotate all three environments together; in-flight signatures stop validating and consumed-request replay records remain harmless.

Clerk is the identity provider. Application ownership is `public.profiles.id`, carried only in the signed `supabase_uuid` claim and resolved by `public.current_app_user_id()`. Do not introduce `auth.uid()` or `auth.users` ownership dependencies.

Configure the environment's signed Clerk webhook to send `user.created` to `/api/webhooks/clerk` only after the profile-provisioning and Pattern C entitlement migrations are applied. The handler atomically obtains one stable profile UUID and the profile trigger creates one default entitlement before Clerk is patched with `public_metadata.supabase_uuid`; retries reuse that UUID and cannot duplicate the entitlement. For the three approved disposable staging identities only, set `CLERK_RECONCILIATION_USER_ALLOWLIST_JSON` to the exact `userA`, `userB`, and `deletionUser` Clerk IDs and run `pnpm reconcile:staging-clerk-profiles` as a dry run. The allowlist may also name `userGolden`, the manual-walkthrough identity that owns the imported golden case; CI never signs in as it and its session is never saved. Use `--apply` only after reviewing every disposition. Never write only the Clerk or database side manually.

Operational admin calls must use the server-only `signAdminEdgeRequest` helper with a non-empty audited actor ID. Both the signer and database accept admin envelopes only for `backfill_embeddings_v1` and `url_catalogue`; do not generalize this allowlist or use admin signing for case-scoped user/worker work.

Consumed Edge request IDs remain replay-protected for 24 hours. Schedule a daily service-role call to `select public.purge_edge_request_nonces_v1(10000);`, repeat in bounded batches only while the result equals 10,000, and record deleted counts. Alert if expired rows grow across two runs. Never truncate the table or delete rows before `retain_until`.

### Release-candidate migrations

These six files are preview-only release-candidate material. The explicit staging migration ledger determines which are still missing. Apply only the missing subset in this exact order and never apply any file to production during this pass.

| Order | Migration | Final SHA-256 |
| --- | --- | --- |
| 1 | `20260829000000_release_security_and_fulfilment_hardening.sql` | `855a64117d8189415fcbb816e69834fe066bf9d861a849cec7c10b2fa3d55576` |
| 2 | `20260830000000_privileged_edge_and_evidence_jobs.sql` | `3eca73d64e98834cef92080654f8f832b80997b3411804cd7a183a20a00e47f7` |
| 3 | `20260909120000_harden_clerk_profile_provisioning.sql` | `8a42315c24eaa5e14a7680e9b519e3d034b90e3d8d831b917c929d3900b65a26` |
| 4 | `20260914120000_align_user_entitlements_pattern_c.sql` | `a631f459d5b86d5d696cbf5fb4615e4ff0f2bc7e832e7c3b385b7b5f133d6732` |
| 5 | `20261102120000_secure_case_analysis_tables_and_anon_writes.sql` | `1e4129c40b29c1f0847d67c73088f02beff3e0a3ef734e54157fe21762b0fdc4` |
| 6 | `20261102130000_advisor_warning_fixes.sql` | `26ba055624ac69dd5dc6a427d2e18223b63541b0f3dd8ec89b6de3a39425f33b` |

Verify all six hashes from the clean review SHA immediately before applying. `20260829` must finish before `20260830`; the latter supplies the nonce, durable evidence dispatch, lease-fencing, and settlement protocol required by the worker and privileged Edge Functions. Apply `20260909` next to add the fail-closed Clerk identity preflight and atomic provisioning RPC. Apply `20260914` next so `public.user_entitlements.user_id` uses the canonical `public.profiles.id` application UUID, one profile trigger provisions defaults, and entitlement RLS resolves the signed `supabase_uuid` claim. Apply `20261102120000` next: it enables RLS with case-scoped SELECT on the seven tier-2 case-analysis tables, runs `consultation_reviews_claimant` with caller rights, and removes every anon write privilege in `public`; `tests/database/security-baseline.test.sql` must pass and the security advisor must report no errors afterwards. Apply `20261102130000` last: it creates the service-role-only `fidrec_eligible` table read by `bright-function`, pins function `search_path`, closes Data API access to the analytics materialized views and to the legacy always-true or `auth.uid()` policies, and indexes every foreign key; afterwards the advisors may report only `extension_in_public` (vector), `rls_enabled_no_policy` and `unused_index`. Do not mark a migration applied manually, apply an already-ledgered migration again, or deploy code against a partial sequence.

The first four migrations stop with actionable counts and sampled non-sensitive keys before their new historical-data constraints are created. The entitlement migration specifically stops with SQLSTATE `23503`, an orphan count, and up to ten unmatched UUIDs. A preflight failure is a release stop: compare the identified rows to provider records or existing job outputs, record the decision, and rerun the unchanged migration. Do not auto-delete, auto-cancel, synthesize `auth.users` rows, or guess which purchase, job, Clerk mapping, or profile is canonical. Record the preview project ref, database output, migration hashes, and deployed commit SHA. Local fixtures and migration parsing are not live Supabase SQL evidence.

#### Entitlement preflight and preservation evidence

Immediately before the staging dry run, execute and retain these read-only results. The orphan query must return zero rows. Record `profile_count`, `entitlement_count`, and `profiles_missing_entitlement`; after migration, the expected entitlement count is the original `entitlement_count + profiles_missing_entitlement`. Export the ordered entitlement rows as restricted release evidence so every pre-existing `user_id`, plan, feature document, and timestamp can be compared after migration.

```sql
select ue.user_id
from public.user_entitlements ue
left join public.profiles p on p.id = ue.user_id
where p.id is null;

select
  (select count(*) from public.profiles) as profile_count,
  (select count(*) from public.user_entitlements) as entitlement_count,
  (
    select count(*)
    from public.profiles p
    left join public.user_entitlements ue on ue.user_id = p.id
    where ue.user_id is null
  ) as profiles_missing_entitlement;

select user_id, plan, features, created_at, updated_at
from public.user_entitlements
order by user_id;

select trigger_schema.nspname as table_schema,
       trigger_table.relname as table_name,
       trigger_object.tgname as trigger_name,
       function_schema.nspname || '.' || trigger_function.proname as function_name
from pg_catalog.pg_trigger trigger_object
join pg_catalog.pg_class trigger_table on trigger_table.oid = trigger_object.tgrelid
join pg_catalog.pg_namespace trigger_schema on trigger_schema.oid = trigger_table.relnamespace
join pg_catalog.pg_proc trigger_function on trigger_function.oid = trigger_object.tgfoid
join pg_catalog.pg_namespace function_schema on function_schema.oid = trigger_function.pronamespace
where not trigger_object.tgisinternal
  and (
    (trigger_schema.nspname = 'auth' and trigger_table.relname = 'users')
    or (trigger_schema.nspname = 'public' and trigger_table.relname = 'profiles')
  )
order by 1, 2, 3;
```

A successful migration emits no orphan exception, preserves every existing entitlement row unchanged, adds one free row only for each profile that was missing one, removes obsolete `handle_new_user_entitlement()` triggers from `auth.users`, preserves any separate `handle_new_user()` legacy profile trigger, and installs exactly one entitlement trigger on `public.profiles`. After the final ledger check, retain these post-migration inspections:

```sql
select c.conname,
       c.convalidated,
       pg_catalog.pg_get_constraintdef(c.oid) as definition
from pg_catalog.pg_constraint c
where c.conrelid = 'public.user_entitlements'::regclass
  and c.contype = 'f';

select policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'user_entitlements';

select trigger_schema.nspname as table_schema,
       trigger_table.relname as table_name,
       trigger_object.tgname as trigger_name,
       trigger_function.proname as function_name
from pg_catalog.pg_trigger trigger_object
join pg_catalog.pg_class trigger_table on trigger_table.oid = trigger_object.tgrelid
join pg_catalog.pg_namespace trigger_schema on trigger_schema.oid = trigger_table.relnamespace
join pg_catalog.pg_proc trigger_function on trigger_function.oid = trigger_object.tgfoid
where not trigger_object.tgisinternal
  and trigger_function.proname in ('handle_new_user', 'handle_new_user_entitlement')
order by 1, 2, 3;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'user_entitlements'
order by grantee, privilege_type;

select
  has_function_privilege('anon', 'public.get_effective_entitlement(uuid)', 'execute') as anon_effective,
  has_function_privilege('authenticated', 'public.get_effective_entitlement(uuid)', 'execute') as authenticated_effective,
  has_function_privilege('service_role', 'public.get_effective_entitlement(uuid)', 'execute') as service_effective;

select user_id, plan, features, created_at, updated_at
from public.user_entitlements
order by user_id;

select count(*) as orphan_count
from public.user_entitlements ue
left join public.profiles p on p.id = ue.user_id
where p.id is null;
```

The foreign-key inspection must show one validated `user_entitlements_user_id_fkey` referencing `public.profiles(id) ON DELETE CASCADE`. The policy inspection must show authenticated `SELECT` using `user_id = current_app_user_id()` and no `auth.uid()`. The trigger inspection must show exactly one `handle_new_user_entitlement` trigger on `public.profiles`, none on `auth.users`, and must preserve any separate legacy `handle_new_user` trigger. Authenticated receives table `SELECT` only, anon receives none, service role retains writes, and the function check must return `false`, `false`, `true`. `orphan_count` must be zero. Compare the post-migration ordered rows to the retained pre-migration export and stop if any original row changed or disappeared. Profile deletion intentionally cascades to the profile's entitlement; deleting an entitlement never deletes a profile. Any different retention requirement needs a separately approved additive migration.

Stop without applying or enabling traffic if the backup/restore marker is absent, the worker is not suspended, checkout traffic is not frozen, the confirmed project ref or database identity differs, any hash differs, the ledger/dry-run plan differs, the orphan query returns a row, an original entitlement changes or disappears, the expected count equation fails, an obsolete auth entitlement trigger remains, more than one profile entitlement trigger exists, or any post-migration foreign-key, RLS, grant, or function inspection differs from this contract.

#### Staging-only migration procedure

Keep checkout traffic frozen and the worker suspended for this entire procedure. Start from the clean reviewed SHA. Supply the staging database URL through the process environment, never in shell history, and never print it. Every remote command below uses `--db-url`; do not rely on, change, or infer a linked Supabase project.

First, fail closed unless both the explicit operator confirmation and the database connection identity bind to the approved staging project ref. Then calculate and record all six hashes:

```powershell
$approvedStagingRef = "yqqkkftfddxuxmpxwbcj"
if ($env:HARBOR_PREVIEW_CONFIRM_SUPABASE_REF -cne $approvedStagingRef) {
  throw "Staging project confirmation does not match the approved project"
}
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_STAGING_DB_URL)) {
  throw "SUPABASE_STAGING_DB_URL is required"
}

$databaseUri = [Uri]$env:SUPABASE_STAGING_DB_URL
$databaseUser = [Uri]::UnescapeDataString(($databaseUri.UserInfo -split ":", 2)[0])
$refPattern = "(^|\.)$([Regex]::Escape($approvedStagingRef))(\.|$)"
if (($databaseUri.Scheme -notin @("postgres", "postgresql")) -or
    (($databaseUri.Host -notmatch $refPattern) -and ($databaseUser -notmatch $refPattern))) {
  throw "Database connection is not bound to the approved staging project"
}

$migrations = @(
  [pscustomobject]@{
    Version = "20260829000000"
    File = "20260829000000_release_security_and_fulfilment_hardening.sql"
    Expected = "855a64117d8189415fcbb816e69834fe066bf9d861a849cec7c10b2fa3d55576"
  },
  [pscustomobject]@{
    Version = "20260830000000"
    File = "20260830000000_privileged_edge_and_evidence_jobs.sql"
    Expected = "3eca73d64e98834cef92080654f8f832b80997b3411804cd7a183a20a00e47f7"
  },
  [pscustomobject]@{
    Version = "20260909120000"
    File = "20260909120000_harden_clerk_profile_provisioning.sql"
    Expected = "8a42315c24eaa5e14a7680e9b519e3d034b90e3d8d831b917c929d3900b65a26"
  },
  [pscustomobject]@{
    Version = "20260914120000"
    File = "20260914120000_align_user_entitlements_pattern_c.sql"
    Expected = "a631f459d5b86d5d696cbf5fb4615e4ff0f2bc7e832e7c3b385b7b5f133d6732"
  },
  [pscustomobject]@{
    Version = "20261102120000"
    File = "20261102120000_secure_case_analysis_tables_and_anon_writes.sql"
    Expected = "1e4129c40b29c1f0847d67c73088f02beff3e0a3ef734e54157fe21762b0fdc4"
  },
  [pscustomobject]@{
    Version = "20261102130000"
    File = "20261102130000_advisor_warning_fixes.sql"
    Expected = "26ba055624ac69dd5dc6a427d2e18223b63541b0f3dd8ec89b6de3a39425f33b"
  }
)

$recordedHashes = foreach ($migration in $migrations) {
  $path = Join-Path "supabase\migrations" $migration.File
  $actual = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant()
  if ($actual -cne $migration.Expected) {
    throw "Migration hash mismatch: $($migration.File)"
  }
  [pscustomobject]@{ Version = $migration.Version; File = $migration.File; SHA256 = $actual }
}
$recordedHashes | Format-Table -AutoSize
```

Next, record the remote ledger using the explicit URL and identify which of the six versions are absent:

```powershell
supabase migration list --db-url $env:SUPABASE_STAGING_DB_URL
if ($LASTEXITCODE -ne 0) { throw "Unable to read the staging migration ledger" }
```

Run a dry push before any write. `--include-all` permits an older missing candidate to be applied even when a later unrelated migration is already ledgered; it does not waive review of the plan:

```powershell
supabase db push --db-url $env:SUPABASE_STAGING_DB_URL --include-all --dry-run
if ($LASTEXITCODE -ne 0) { throw "Staging migration dry run failed" }
```

The dry-run plan must be a filename-ordered subset of exactly the six table entries above, must include every table entry absent from the recorded ledger, and must include no already-ledgered or unrelated migration. Stop on any discrepancy. If all six are already ledgered, do not run a write. Otherwise, apply the reviewed missing subset:

```powershell
supabase db push --db-url $env:SUPABASE_STAGING_DB_URL --include-all
if ($LASTEXITCODE -ne 0) { throw "Staging migration push failed" }

supabase migration list --db-url $env:SUPABASE_STAGING_DB_URL
if ($LASTEXITCODE -ne 0) { throw "Unable to verify the final staging migration ledger" }
```

Record the final ledger and verify that all six versions appear exactly once in the documented order. Do not enable the Clerk webhook until `20260909120000` and `20260914120000` are present and the profile RPC, entitlement trigger, foreign key, RLS, and privileges have been verified. Keep the worker suspended after migration verification; worker enablement remains a later release gate.

### Type-safety gate

`next.config.mjs` currently sets `typescript.ignoreBuildErrors: true`, so a passing `npm run build` is not a type-safety gate. Record a separate passing `npm run typecheck`. Removing that bypass or enforcing type errors in the Next build is a Frontend/Test-owned release gate and is not concealed by this backend release candidate.

### Preview evidence runner

Run `pnpm test:e2e:preview-handshakes` only against disposable preview infrastructure. It requires the `HARBOR_PREVIEW_*` variables declared by `tests/e2e/harbor-preview-handshakes.spec.ts`, including:

- `HARBOR_PREVIEW_EXPECTED_COMMIT_SHA`: full 40-character SHA served by both app and worker.
- `HARBOR_PREVIEW_CONFIRM_MUTATIONS=RUN_MUTATING_PREVIEW_HANDSHAKES`.
- `HARBOR_PREVIEW_CONFIRM_SUPABASE_REF`: exact preview project ref.
- `HARBOR_PREVIEW_RELEASE_STORAGE_STATE`: an authenticated Clerk storage-state file used for the release-health request; the endpoint must reject the runner's anonymous preflight.
- `HARBOR_PREVIEW_DATABASE_URL` with `sslmode=verify-full`, and `HARBOR_PREVIEW_DB_CA` holding the Supabase Root 2021 CA in PEM form (Supabase → project → Database → Settings → SSL Configuration → Download certificate). The connection verifies the certificate chain and hostname; `sslmode=require` is refused.
- Test Stripe webhook secret, controlled worker case, and email sink.

The runner refuses known production hosts, verifies `/api/health/release`, and writes timestamped JSONL evidence to `test-results/harbor-preview-handshake-evidence.jsonl` by default. Retain that artifact with deployment logs; it contains no credentials.

### Refresh test sessions

The preview and authenticated CI jobs sign in with saved Clerk Development sessions for the three disposable identities (`userA`, `userB`, `deletionUser`), stored in the `harbor-preview` environment as `HARBOR_AUTH_STORAGE_STATE_USER_A_BASE64`, `HARBOR_AUTH_STORAGE_STATE_USER_B_BASE64` and `HARBOR_AUTH_STORAGE_STATE_DELETION_USER_BASE64`. Clerk Development sessions last about seven days. When one has expired, the job's "Check Clerk test sessions" step (or the release verification step) fails and names the secret. To refresh:

1. In the clone, with `.env.staging.local` holding the Clerk Development secret key and `NEXT_PUBLIC_APP_URL` set to the staging origin, set `CLERK_RECONCILIATION_USER_ALLOWLIST_JSON` to the labelled Clerk IDs (as for reconciliation).
2. Run `pnpm exec tsx --env-file=.env.staging.local scripts/refresh-harbor-auth-states.ts`. It signs each identity in with a one-time Clerk sign-in token, checks the session against staging, and writes the git-ignored files under `tests/e2e/.auth/`. It refuses `userGolden`.
3. Upload them without displaying them (PowerShell):

   ```powershell
   $states = @{ USER_A = 'harbor-user-a'; USER_B = 'harbor-user-b'; DELETION_USER = 'harbor-deletion-user' }
   foreach ($name in $states.Keys) {
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("tests/e2e/.auth/$($states[$name]).json")) |
       gh secret set "HARBOR_AUTH_STORAGE_STATE_${name}_BASE64" --env harbor-preview
   }
   ```

4. Re-run the failed workflow. A session made this way is a live sign-in for that identity until it expires, so never paste, attach, or commit the files.

### Rebuild staging test data

`scripts/seed-harbor-staging-fixtures.ts` is the standard way to rebuild the synthetic staging cases behind `HARBOR_STATE_CASES_JSON` and `HARBOR_RELEASE_FIXTURES_JSON`, after a staging reset or whenever the authenticated lane needs clean fixtures (several tests change their fixture cases, so reruns need a rebuild).

- It runs only against `yqqkkftfddxuxmpxwbcj`, over `sslmode=verify-full` with `HARBOR_PREVIEW_DB_CA`, and only for the three CI identities named in `CLERK_RECONCILIATION_USER_ALLOWLIST_JSON`. It refuses `userGolden` and never reads or writes a case it did not create.
- Case IDs are derived from fixture names, so each run deletes and recreates the same synthetic cases in one transaction. It also sets `userA`'s user-level plan to `self_serve_report` (needed for the free-draft and buy-report states).
- Without `--apply` it is a dry run that rolls back.

1. Set `HARBOR_PREVIEW_DATABASE_URL` (staging, `sslmode=verify-full`), `HARBOR_PREVIEW_DB_CA` and `CLERK_RECONCILIATION_USER_ALLOWLIST_JSON`.
2. Run `pnpm exec tsx scripts/seed-harbor-staging-fixtures.ts`, then again with `--apply`. It writes `harbor-state-cases.json` and `harbor-release-fixtures.json` to the git-ignored `test-results/seed/`.
3. Upload both without displaying them:

   ```powershell
   Get-Content -Raw test-results/seed/harbor-state-cases.json | gh secret set HARBOR_STATE_CASES_JSON --env harbor-preview
   Get-Content -Raw test-results/seed/harbor-release-fixtures.json | gh secret set HARBOR_RELEASE_FIXTURES_JSON --env harbor-preview
   ```

## Preview deployment order

1. Freeze preview checkout creation and pause the worker. Record the full clean Git SHA, its parent, all six migration hashes above, and all local gate results.
2. Use the staging-only procedure above to verify that the explicit database URL binds to the designated non-production project ref. Capture its migration ledger, row counts for affected payment/job tables, and a restorable database backup or provider point-in-time restore marker. Record the Storage bucket inventory separately; database backup does not back up object bytes.
3. Run the embedded migration preflights against a restored preview clone when available. Otherwise apply with stop-on-error and a transaction-capable migration runner while traffic remains paused. Any reported duplicate pending/established purchase, Stripe identity, fulfilment identity, legacy payment identity, malformed reservation, duplicate evidence job, unsupported job type, invalid document binding, Clerk mapping conflict, or entitlement UUID without a matching profile blocks deployment until provider-backed reconciliation is complete.
4. Follow the recorded ledger and reviewed dry-run plan to apply only missing files in this order: `20260829000000_release_security_and_fulfilment_hardening.sql`, `20260830000000_privileged_edge_and_evidence_jobs.sql`, `20260909120000_harden_clerk_profile_provisioning.sql`, `20260914120000_align_user_entitlements_pattern_c.sql`, `20261102120000_secure_case_analysis_tables_and_anon_writes.sql`, then `20261102130000_advisor_warning_fixes.sql`. Verify all six in the final ledger. Never reorder, squash, mark as applied, or run any migration on production.
5. Verify the Clerk provisioning RPC and service-role-only privileges from `20260909120000`, then verify the canonical entitlement foreign key, profile trigger, existing-row preservation, RLS, and service-role access from `20260914120000` before enabling the signed Clerk webhook. Keep the worker suspended.
6. Deploy every privileged Supabase Edge Function from the same SHA and set the matching `EDGE_PROXY_HMAC_SECRET`. Probe direct-anon, invalid-signature, stale-signature, replay, and valid signed paths before enabling the worker.
7. Verify the Clerk `supabase` JWT template, allowed origins, sign-up/sign-in/session-expiry behavior, and user webhook in preview.
8. Verify Stripe test prices, the test-mode webhook endpoint/signing secret, and sender-domain/SMTP configuration. Set `HARBOR_DEPLOYMENT_ENVIRONMENT=preview`, set `CHECKOUT_REDIRECT_ORIGIN` and `NEXT_PUBLIC_APP_URL` to the same preview origin, and set `HARBOR_PRODUCTION_APP_ORIGIN` to the distinct production origin. Reconcile existing preview Checkout Sessions and PaymentIntents before accepting new checkout traffic.
9. Deploy the Next.js app and confirm `/api/health/release` returns the expected immutable `RENDER_GIT_COMMIT`. Configure the same HMAC secret without a `NEXT_PUBLIC_*` prefix.
10. Deploy the Render worker from the same SHA. Confirm its release health/readiness, immutable Render identity, and HMAC minimum-length startup check while the queue remains paused.
11. Run database/payment/job reconciliation, then enable the worker and preview checkout traffic. Run the preview handshake suite and retain timestamped JSONL evidence plus Clerk, Supabase, Stripe, Render, Storage/Realtime, and SMTP provider logs tied to the SHA.

Do not enable the proposed S$8/S$12 subscription or regeneration flow until product policy, Stripe price keys, entitlement statuses, proration, quotas, cancellation, grace periods, and refund behavior are approved. The current release supports case-scoped one-time purchases only. Human consultation checkout and allocation are disabled; a valid historic `human_consult_30m` webhook is retained as a verified payment record only and cannot create a consultation.

## Canonical wiring and retired paths

- Onboarding posts one stable idempotency key to `POST /api/cases/bootstrap`; the server-owned RPC returns the same case for an identical retry.
- The only enabled purchases are `self_serve_report` and `fidrec_tier2_pack`, both through `POST /api/payments/create-checkout-session`. A cancel return retries the same open pending reservation; an established-but-unfulfilled purchase is reconciled instead of charged again.
- `usePaymentStatus` refreshes the typed `GET /api/cases/[caseId]/capabilities` contract. The UI does not infer capability from redirect parameters or reconstruct billing state from database tables.
- Evidence uses `POST /api/evidence/upload` followed by atomic `POST /api/cases/[caseId]/evidence/process`; the latter registers the canonical document and durable processing job in one database transaction.
- Signed Stripe completion enqueues the idempotent `post_payment_report_generation` job. The worker owns extraction/decision/report execution, and the browser reads only Realtime outputs plus `GET /api/cases/[caseId]/job-status`.
- `/api/cases/[caseId]/generate-pack` is retired and must remain absent. A repository-wide caller check must return no production callers. Its canonical replacement is signed Stripe webhook fulfilment → durable report job → fenced worker → privileged Edge report function; there is no manual report-generation endpoint.
- Consultation checkout/allocation, subscriptions, portal management, and regeneration have no enabled CTA or API path. Their typed availability remains `policy_blocked`; the disabled consultation control performs no request.
- Render-check only the canonical route-group pages `app/(marketing)/pricing/page.tsx` and `app/(marketing)/how-it-works/page.tsx`. The duplicate top-level route files stay deleted.

## Reconciliation

Use provider dashboards as external evidence, but canonical ownership and capability come from the database. Never repair ownership from client metadata.

```sql
-- Pre-migration checks: any returned row blocks the preview apply.
select case_id, product_code, count(*), array_agg(id order by created_at)
from public.case_purchases
where payment_provider = 'stripe'
  and payment_status in ('pending', 'paid', 'partially_refunded', 'refunded', 'disputed')
group by case_id, product_code
having count(*) > 1;

select payment_provider, provider_payment_intent_id, count(*), array_agg(id)
from public.case_purchases
where provider_payment_intent_id is not null
group by payment_provider, provider_payment_intent_id
having count(*) > 1;

select stripe_payment_intent_id, count(*), array_agg(id)
from public.payments
where stripe_payment_intent_id is not null
group by stripe_payment_intent_id
having count(*) > 1;

select document_id, count(*), array_agg(id)
from public.jobs
where job_type = 'evidence_document_processing' and document_id is not null
group by document_id
having count(*) > 1;

select coalesce(job_type, '<null>') as job_type, count(*)
from public.jobs
where job_type is null or job_type not in (
  'post_payment_report_generation', 'evidence_document_processing',
  'consultation_recording_ingest', 'consultation_transcribe',
  'consultation_summarise', 'consultation_case_insert'
)
group by job_type;

select id, case_id, job_type, document_id
from public.jobs
where (job_type = 'evidence_document_processing' and document_id is null)
   or (job_type = 'post_payment_report_generation' and document_id is not null);

select d.id, d.case_id, d.processing_status, d.is_processed, d.content_latest_id
from public.case_documents d
where (
    d.is_processed = true
    or lower(coalesce(d.processing_status, '')) in ('ready', 'processed', 'completed')
  )
  and not (
    d.is_processed = true
    and lower(coalesce(d.processing_status, '')) in ('ready', 'processed', 'completed')
    and (
      d.content_latest_id is not null
      or exists (
        select 1
        from public.case_document_extractions extraction
        where extraction.document_id = d.id and extraction.case_id = d.case_id
      )
    )
  );

-- Webhooks that need investigation or safe redelivery.
select provider_event_id, event_type, processing_status, error, created_at
from public.payment_webhook_events
where processing_status in ('received', 'failed')
order by created_at;

-- Pending sessions and established purchases whose fulfilment may need reconciliation.
select cp.id, cp.case_id, cp.product_code, cp.payment_status,
       cp.provider_checkout_session_id, cp.provider_payment_intent_id,
       cp.fulfilment_provider_event_id, ce.case_id is not null as has_entitlement,
       cp.updated_at
from public.case_purchases cp
left join public.case_entitlements ce on ce.case_id = cp.case_id
where cp.payment_status in ('pending', 'paid', 'partially_refunded', 'refunded', 'disputed')
order by cp.updated_at;

-- Queued, failed, or abandoned worker jobs.
select id, case_id, user_id, status, retry_count, locked_at, error, updated_at
from public.jobs
where status <> 'completed'
order by created_at;

-- Storage objects whose metadata rollback could not remove the uploaded object.
select id, storage_bucket, storage_path, reason, attempts, last_error, created_at
from public.storage_cleanup_queue
where resolved_at is null
order by created_at;
```

Redeliver the original signed Stripe event where possible. The `(payment_provider, provider_event_id)` ledger, checkout-session uniqueness, PaymentIntent uniqueness, fulfilment-event uniqueness, and job idempotency key make duplicate delivery safe. Out-of-order refunds/disputes remain replayable until Checkout completion creates the canonical purchase; reconciliation never deletes generated reports or purchased outputs.

The worker refreshes `jobs.updated_at` every minute. Each Edge request has a two-minute abort deadline and the whole job has a ten-minute deadline, both below the 15-minute abandoned-lease recovery window. A timeout or uncertain heartbeat leaves the job `running`, records the error, and stops heartbeats so `claim_next_job()` can recover it only after the full stale-lease window; it is never immediately requeued beside an uncertain downstream request. The claim RPC then changes `locked_at`. Old workers can no longer call the proxy or complete the reclaimed job with the stale token. Investigate repeatedly failed jobs before deliberately setting them back to `queued`.

For each unresolved `storage_cleanup_queue` row, verify that no matching `evidence` metadata row exists, remove the exact object from the recorded bucket/path with an audited service-role operation, increment `attempts` and record `last_error` on failure, or set `resolved_at` and `updated_at` on success. Never bulk-delete by case prefix, and never mark a row resolved before Storage confirms deletion.

## Rollback and forward-fix recovery

1. Pause the worker and disable new checkout creation before changing data or code. Keep the Stripe webhook reachable so events remain durably recorded in the provider and can be redelivered.
2. If a migration preflight fails, stop. Preserve its output and the backup marker, reconcile the sampled keys against Stripe, existing job artefacts, or canonical profiles, and rerun the unchanged migration. Never bypass the preflight, fabricate `auth.users` rows, delete unmatched entitlements, or edit migration history.
3. If `20260829` succeeds but a later migration fails, leave application/worker traffic paused and the Clerk webhook disabled. Each file is transactional, so a failed `20260914` leaves that file unapplied while earlier ledgered files remain. Reconcile every orphan entitlement to an existing canonical profile and rerun the unchanged file, or restore the entire preview database backup before any release traffic is admitted. After a successful `20260914` but before traffic, restore the full backup if rollback is required; do not manually reverse only its foreign key, trigger, policy, grants, or backfill.
4. After any candidate migration has carried release traffic, use an additive forward corrective migration. Do not reverse applied RLS, grants, identity mapping, payment ledgers, durable jobs, entitlement ownership, default rows, or lease constraints in place.
5. Roll the app and worker together only to a schema-compatible known-good SHA. Do not run mixed worker/app revisions or point a previous worker at the new queue protocol without an explicit compatibility review.
6. If a webhook failed, correct configuration or code and redeliver the same signed provider event. Do not fabricate a replacement event, move a refund/dispute state backward, or create a second purchase.
7. If a job timed out or its lease is uncertain, leave it running for the 15-minute stale-lease window; do not manually requeue it while a downstream request could still be active. The original claim must remain denied after expiry or reclaim.
8. Verify capabilities through `/api/cases/[caseId]/capabilities`; do not reconstruct UI state from several tables.
9. Never delete reports, documents, or purchased outputs because of a refund, dispute, cancellation, subscription loss, or rollback. Any future revocation policy requires a separate approved migration.
10. Re-run reconciliation and every preview handshake, then attach new timestamped evidence to the exact forward-fix or rollback SHA.
