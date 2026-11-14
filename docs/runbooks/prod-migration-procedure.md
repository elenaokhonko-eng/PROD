# PROD migration procedure (Option A: new empty project)

Status: **used on 2026-11-11 to apply all 39 migrations to the empty PROD project (Gate P2a passed: empty ledger,
plan identical to the repo, pinned hashes); admin role seeded on 2026-11-12 (step 4).** Prepared 2026-11-05, updated
2026-11-09. Don't edit the staging-only procedure in `docs/release-operations.md`.

The PROD project's direct host `db.<ref>.supabase.co` has an IPv6 address only. From a machine or container without
IPv6, connect through the session pooler (`aws-0-ap-southeast-1.pooler.supabase.com:5432`, user `postgres.<ref>`) with
the same `sslmode=verify-full` and CA.

Bound to the confirmed PROD project only. Every remote command uses `--db-url` from the process environment; never
print the URL, never put it in shell history, never rely on a linked project. Nothing here runs against staging
(`yqqkkftfddxuxmpxwbcj`), the old development baseline (`ujilatkjweudsptpoqyr`) or the paused legacy projects.

## Before you start

- Gate P1 passed: `pnpm check:env-set … --production-ref <ref>` exits 0 for production.
- **Enforce SSL is on** for the PROD project and its CA certificate is saved outside the repo (for example
  `C:\dev\guidebuoy\certs\supabase-prod-ca.crt`; `certs/` is git-ignored). `SUPABASE_PRODUCTION_DB_URL` ends with
  `?sslmode=verify-full&sslrootcert=<absolute path to that CA>`.
- A non-TLS attempt **with a deliberately wrong password** is refused with `SSL connection is required`. Never test
  with the real password.
- Backup/PITR is enabled on the plan; record the restore marker. Record the (empty) Storage inventory.
- Work from the tagged `main` SHA in `C:\dev\guidebuoy` on Windows. The expected hashes below are of the Windows
  working-tree files (`core.autocrlf=true`, CRLF), the same form as the staging procedure; a checkout with other
  line endings gives different hashes and must stop, not be "fixed".

## 1. Bind to the PROD project and verify all 39 hashes

On an empty project every repo migration is applied, so all 39 files are hashed, not just the release six.
`20260828115900` (orphan cleanup) is excluded from the repo and was never in the staging ledger; it is not part of
this plan.

```powershell
$approvedProductionRef = "ottnvtqltxinxasedbjp"   # confirmed by Elena at Gate P0
if ($approvedProductionRef -notmatch '^[a-z]{20}$') { throw "Set the confirmed PROD ref first" }
if ($approvedProductionRef -in @("yqqkkftfddxuxmpxwbcj", "ujilatkjweudsptpoqyr", "iyinkfbarokqugsxggol", "ypifhfivvhvoiadytwem")) {
  throw "That is not the PROD project"
}
if ($env:HARBOR_PRODUCTION_CONFIRM_SUPABASE_REF -cne $approvedProductionRef) {
  throw "PROD project confirmation does not match the approved project"
}
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_PRODUCTION_DB_URL)) { throw "SUPABASE_PRODUCTION_DB_URL is required" }

$databaseUri = [Uri]$env:SUPABASE_PRODUCTION_DB_URL
$databaseUser = [Uri]::UnescapeDataString(($databaseUri.UserInfo -split ":", 2)[0])
$refPattern = "(^|\.)$([Regex]::Escape($approvedProductionRef))(\.|$)"
if (($databaseUri.Scheme -notin @("postgres", "postgresql")) -or
    (($databaseUri.Host -notmatch $refPattern) -and ($databaseUser -notmatch $refPattern))) {
  throw "Database connection is not bound to the approved PROD project"
}
if ($databaseUri.Query -notmatch '(^|[?&])sslmode=verify-full(&|$)' -or $databaseUri.Query -notmatch '(^|[?&])sslrootcert=') {
  throw "PROD database URL must use sslmode=verify-full with sslrootcert"
}

$migrations = @(
  [pscustomobject]@{ File = "20260314055326_remote_schema.sql"; Expected = "bdad98b36be632c51cb4537865967560bf7d1df68a77da52647b8831ecb9cc3f" },
  [pscustomobject]@{ File = "20260419140000_get_case_eligibility_self_serve.sql"; Expected = "047d46db8f6a5233dd297f649d9f35d5b010305b2928f95f135161dec2dda62b" },
  [pscustomobject]@{ File = "20260502120000_drop_trg_sync_case_document_from_storage.sql"; Expected = "e5f51374a20a6d5a3a451ab11034148230f393ff0f907221057f9b795c4f61fa" },
  [pscustomobject]@{ File = "20260502133000_case_validation_gap_items.sql"; Expected = "04fc5e1a0f07205af4912f3b13442c66af2e22a861eb505e3c9695dfcfb48cc4" },
  [pscustomobject]@{ File = "20260502150000_run_validation_v1_gap_items.sql"; Expected = "6b3fddce60be7060d383382ed921d3102207d5f0cda8ba4c5df42c5df92f9ecd" },
  [pscustomobject]@{ File = "20260502190000_case_validation_rls_select_policies.sql"; Expected = "de7c2fba90f4abcda2f04e46c7835b61cc7ef846a0d590e6f4f66a1820ab2cb5" },
  [pscustomobject]@{ File = "20260602194500_case_fidrec_tier2_foundation.sql"; Expected = "83da26601646531618e977181b1614dbdaa2e2f0d9607b463e2475a829cd836b" },
  [pscustomobject]@{ File = "20260605173000_case_investigation_questions.sql"; Expected = "b0141c18e2d0c7cbdae7e0d7539955eb908bb45b02cd7d3e7771ec4d48e7747a" },
  [pscustomobject]@{ File = "20260605180000_case_evidence_requests.sql"; Expected = "1888189687c9e7fa60763fff53dfcca0df702548de042ce737fdc6f8ab5883c5" },
  [pscustomobject]@{ File = "20260606120000_case_themes.sql"; Expected = "30c7b17290838f0ef7355feb56c38917a81b0dcd98da02da32ad914394343ea8" },
  [pscustomobject]@{ File = "20260711133000_clerk_supabase_uuid_rls_alignment.sql"; Expected = "a631784440c9dc1272b972ed123f670716215c79cd57fba2c5e8bf21472e2555" },
  [pscustomobject]@{ File = "20260711140000_add_jobs_table.sql"; Expected = "1e6b2a9f1b2402cdcdf40599b3ba1229ca3f110aacba64d56abe88bbb88000a4" },
  [pscustomobject]@{ File = "20260711141000_jobs_function_execute_grants.sql"; Expected = "70c4d7d54240f9cc9a08d26be09c8291dcf500a967329506079ae88c1415b509" },
  [pscustomobject]@{ File = "20260712120000_reports_pattern_c_case_scoped_ownership.sql"; Expected = "b8231973f34660332acc4aa53b36194df00ad31f2f62362748b74f985c500cfb" },
  [pscustomobject]@{ File = "20260712170000_add_escalation_waitlist.sql"; Expected = "b14c8dfd53b745f96a654a23b7a19bae064a233b371075c31eae309f9b732f1c" },
  [pscustomobject]@{ File = "20260712180000_extend_payments_service_type.sql"; Expected = "37f09b990547cb7ac5c702b0ffea364818f4c71bfa4a3f3b7d22b138932ff1cb" },
  [pscustomobject]@{ File = "20260713180000_slice8_a_staff_roles.sql"; Expected = "49e05212e9b6a4d3adeede1fde2be12dc9891b39e1841c38b1cc873f148b3976" },
  [pscustomobject]@{ File = "20260713180100_slice8_b_case_purchases.sql"; Expected = "e00feac330e27d92b16ef2fa24c7c87bb2212245365085f14142ff55c0363801" },
  [pscustomobject]@{ File = "20260713180200_slice8_c_case_consultations.sql"; Expected = "072e13b03a77f87e81be94845b66204e343210ddc157178e0627dad83da2e7e3" },
  [pscustomobject]@{ File = "20260713180300_slice8_d_consultation_consents.sql"; Expected = "dfe3d1dca998a45f6efd7c02ef553d24735618620eb35f453d4edbcd90204df6" },
  [pscustomobject]@{ File = "20260713180400_slice8_e_consultation_recordings.sql"; Expected = "2e47e4ce2cd5f15a3c89f3b894831f960e64c91d0d167b6ed853e388d79b5b6c" },
  [pscustomobject]@{ File = "20260713180500_slice8_f_consultation_events.sql"; Expected = "6f524a21f8b9afa1874c224caaa31b590fa1ab3d1e89b636b30c425284d73b13" },
  [pscustomobject]@{ File = "20260713180600_slice8_g_consultation_reviews_and_rpcs.sql"; Expected = "5fe698aead13a09ae63ed2a64cd928e4bef95e703ba45ebccc2585ebdab7942f" },
  [pscustomobject]@{ File = "20260713180700_slice8_h_consultation_rls_views_grants.sql"; Expected = "2754a0f9461f0dc4721a15a93ad99d5c4397f06828ee86f15c3723a378ef6242" },
  [pscustomobject]@{ File = "20260713180800_slice8_i_jobs_consultation_job_types.sql"; Expected = "961cf81e62a38ca84d9d26a22493cdf0a66c82b5ca9442dc540128a35b317cf4" },
  [pscustomobject]@{ File = "20260714120000_validation_reconciliation_rpcs.sql"; Expected = "917bf5a1d1d11ed4082a1a1770957451683814a49041857077aa34a53cb35f1c" },
  [pscustomobject]@{ File = "20260714140000_extract_document_readiness_columns.sql"; Expected = "f39f9ee7857a375c6d82f98e218f56f87ccc087f58448d45f1f302c2577f6043" },
  [pscustomobject]@{ File = "20260827190000_add_profiles_sensory_mode.sql"; Expected = "b56aa9ea6899d355d9731e0857a618c0aef6a4429c75a9fcf6f4cd3970a7aa98" },
  [pscustomobject]@{ File = "20260828120000_complete_pattern_c_security.sql"; Expected = "ba04bbb94e9f3e56ef2e07a2bc32387bfa4c646ed8e058745c20fddf7da58c37" },
  [pscustomobject]@{ File = "20260829000000_release_security_and_fulfilment_hardening.sql"; Expected = "855a64117d8189415fcbb816e69834fe066bf9d861a849cec7c10b2fa3d55576" },
  [pscustomobject]@{ File = "20260830000000_privileged_edge_and_evidence_jobs.sql"; Expected = "3eca73d64e98834cef92080654f8f832b80997b3411804cd7a183a20a00e47f7" },
  [pscustomobject]@{ File = "20260831180000_router_session_creation_intent.sql"; Expected = "c2ddcefab43b49ae70b023bc741a90bb7724df9e64cd2f1a3a01fc0772714a3c" },
  [pscustomobject]@{ File = "20260909120000_harden_clerk_profile_provisioning.sql"; Expected = "8a42315c24eaa5e14a7680e9b519e3d034b90e3d8d831b917c929d3900b65a26" },
  [pscustomobject]@{ File = "20260914120000_align_user_entitlements_pattern_c.sql"; Expected = "a631f459d5b86d5d696cbf5fb4615e4ff0f2bc7e832e7c3b385b7b5f133d6732" },
  [pscustomobject]@{ File = "20260915120000_harden_router_session_conversion.sql"; Expected = "750f83d7b8065c90391ad62937e57840cd6b9ddbaecee1b1b0fddb0e8d92d034" },
  [pscustomobject]@{ File = "20261102120000_secure_case_analysis_tables_and_anon_writes.sql"; Expected = "1e4129c40b29c1f0847d67c73088f02beff3e0a3ef734e54157fe21762b0fdc4" },
  [pscustomobject]@{ File = "20261102130000_advisor_warning_fixes.sql"; Expected = "26ba055624ac69dd5dc6a427d2e18223b63541b0f3dd8ec89b6de3a39425f33b" },
  [pscustomobject]@{ File = "20261106120000_fact_reconciliation_foundation.sql"; Expected = "7f94edd7d99ab6e3ec5da15e4af6e47ea54ef02825fe77391389fb93e6bff57b" },
  [pscustomobject]@{ File = "20261108120000_model_usage.sql"; Expected = "3f87b1aeea765c16910588ceefde0bd3667f2d5ae06d5a960b6f7faa05f96f4c" }
)

$files = Get-ChildItem "supabase\migrations\*.sql" | Sort-Object Name
if ($files.Count -ne $migrations.Count) { throw "Repo has $($files.Count) migrations; this procedure covers $($migrations.Count)" }
$recordedHashes = for ($i = 0; $i -lt $migrations.Count; $i++) {
  if ($files[$i].Name -cne $migrations[$i].File) { throw "Unexpected migration order at $($files[$i].Name)" }
  $actual = (Get-FileHash -Algorithm SHA256 $files[$i].FullName).Hash.ToLowerInvariant()
  if ($actual -cne $migrations[$i].Expected) { throw "Migration hash mismatch: $($migrations[$i].File)" }
  [pscustomobject]@{ File = $migrations[$i].File; SHA256 = $actual }
}
$recordedHashes | Format-Table -AutoSize
```

## 2. Ledger and dry run (Gate P2a)

```powershell
supabase migration list --db-url $env:SUPABASE_PRODUCTION_DB_URL
if ($LASTEXITCODE -ne 0) { throw "Unable to read the PROD migration ledger" }

supabase db push --db-url $env:SUPABASE_PRODUCTION_DB_URL --dry-run
if ($LASTEXITCODE -ne 0) { throw "PROD migration dry run failed" }
```

The ledger must be empty and the dry-run plan must list exactly the 39 files above, in filename order. Stop on any
difference. **Gate P2a:** Elena approves this exact plan before anything is applied.

## 3. Apply and verify

```powershell
supabase db push --db-url $env:SUPABASE_PRODUCTION_DB_URL
if ($LASTEXITCODE -ne 0) { throw "PROD migration push failed" }

supabase migration list --db-url $env:SUPABASE_PRODUCTION_DB_URL
if ($LASTEXITCODE -ne 0) { throw "Unable to verify the final PROD migration ledger" }
```

The final ledger must list all 39 versions. Then run every post-migration inspection from
`docs/release-operations.md` (foreign keys, RLS, grants, functions, entitlement trigger count),
`tests/database/security-baseline.test.sql`, and the Supabase security and performance advisors. Expected advisor
findings are only `extension_in_public` (vector), `rls_enabled_no_policy` and `unused_index`; anything else stops the
release. Do not mark a migration applied manually, re-apply a ledgered migration, or deploy code against a partial
sequence.

## 4. Seed the admin role (after the founder's first production sign-in)

Only Elena's production account holds `admin` (it opens `/analytics` and the cost dashboard). Run once, after her
first sign-in has provisioned her profile, with her sign-in address passed as a psql variable so it is not written in
this file. Stop unless exactly one profile matches and exactly one active admin remains.

```sql
\set ON_ERROR_STOP on
begin;
insert into public.staff_roles (profile_id, role)
select id, 'admin' from public.profiles where lower(email) = lower(:'founder_email');
do $$
begin
  if (select count(*) from public.staff_roles where role = 'admin' and revoked_at is null) <> 1 then
    raise exception 'expected exactly one active admin';
  end if;
end $$;
commit;
```

Run it as `psql "$SUPABASE_PRODUCTION_DB_URL" -v founder_email=<address> -f seed-admin.sql` with the SQL above saved
outside the repo. If the insert finds no profile, sign in first; if it finds more than one, stop.
