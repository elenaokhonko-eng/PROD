# Supabase storage copy (source → staging)

Copies all Supabase Storage buckets + objects from a **source** project to a **target** project (STAGING), preserving bucket names and object paths.

## Safety rules implemented

- Never deletes or moves anything in the source project.
- Only creates missing buckets in target.
- Preserves object keys (paths) exactly.
- Forces the `evidence` bucket to be **private** on target (even if source differs).

## Prereqs

- Node 18+.
- Service role keys for both projects (do **not** use anon keys).

## Run

PowerShell:

```powershell
$env:SOURCE_REF = 'ujilatkjweudsptpoqyr'
$env:STAGING_REF = 'yqqkkftfddxuxmpxwbcj'
$env:SOURCE_SERVICE_ROLE_KEY = '<source-service-role-key>'
$env:STAGING_SERVICE_ROLE_KEY = '<staging-service-role-key>'

node scripts/storage-copy/copy-storage.mjs inventory
node scripts/storage-copy/copy-storage.mjs ensure-buckets
node scripts/storage-copy/copy-storage.mjs copy
node scripts/storage-copy/copy-storage.mjs verify-counts
node scripts/storage-copy/copy-storage.mjs verify-samples --per-bucket 2
```

To scan the staging DB for lingering source-hostname URLs:

```powershell
$env:SUPABASE_ACCESS_TOKEN = 'sbp_...'
$env:SUPABASE_DISABLE_TELEMETRY = '1'
$env:SUPABASE_CONFIG_HOME = "$PWD\.supabase-cli"
npx supabase link --project-ref $env:STAGING_REF

node scripts/storage-copy/scan-source-urls.mjs
```

