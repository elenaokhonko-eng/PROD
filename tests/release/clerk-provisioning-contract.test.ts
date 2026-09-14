import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = process.cwd()
const migration = readFileSync(
  resolve(root, "supabase", "migrations", "20260909120000_harden_clerk_profile_provisioning.sql"),
  "utf8",
)
const entitlementMigration = readFileSync(
  resolve(root, "supabase", "migrations", "20260914120000_align_user_entitlements_pattern_c.sql"),
  "utf8",
)
const provisioner = readFileSync(resolve(root, "lib", "server", "clerk-profile-provisioner.ts"), "utf8")
const webhookHandler = readFileSync(resolve(root, "lib", "server", "clerk-webhook.ts"), "utf8")
const webhookRoute = readFileSync(resolve(root, "app", "api", "webhooks", "clerk", "route.ts"), "utf8")
const renderBlueprint = readFileSync(resolve(root, "render.yaml"), "utf8")
const releaseOperations = readFileSync(resolve(root, "docs", "release-operations.md"), "utf8")

test("Clerk mapping migration normalizes only blanks before fail-closed preflight constraints", () => {
  const addColumn = migration.indexOf("ADD COLUMN IF NOT EXISTS clerk_id text")
  const normalizeBlanks = migration.indexOf("SET clerk_id = NULL")
  const preflight = migration.indexOf("DO $preflight$")
  const constraint = migration.indexOf("ADD CONSTRAINT profiles_clerk_id_shape_check")
  const uniqueIndex = migration.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS profiles_clerk_id_unique_idx")
  assert.ok(addColumn >= 0 && addColumn < normalizeBlanks)
  assert.ok(normalizeBlanks < preflight && preflight < constraint && constraint < uniqueIndex)
  assert.match(migration, /clerk_id <> btrim\(clerk_id\)/)
  assert.match(migration, /GROUP BY clerk_id[\s\S]*HAVING count\(\*\) > 1/)
  assert.match(migration, /clerk_id IS NULL OR \(clerk_id = btrim\(clerk_id\) AND clerk_id <> ''\)/)
})

test("Clerk provisioning RPC is atomic and service-role-only", () => {
  assert.match(migration, /FUNCTION public\.provision_clerk_profile_v1/)
  assert.match(migration, /SECURITY DEFINER/)
  assert.match(migration, /ON CONFLICT \(clerk_id\) DO UPDATE/)
  assert.match(migration, /RETURNING id INTO v_profile_id/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.provision_clerk_profile_v1[\s\S]*FROM authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.provision_clerk_profile_v1[\s\S]*TO service_role/)
  assert.match(entitlementMigration, /AFTER INSERT ON public\.profiles/)
  assert.match(entitlementMigration, /ON CONFLICT \(user_id\) DO NOTHING/)
})

test("runtime provisioner delegates UUID ownership to the RPC and patches only one metadata key", () => {
  assert.match(provisioner, /\.rpc\("provision_clerk_profile_v1"/)
  assert.match(provisioner, /publicMetadata: \{ supabase_uuid: profileId \}/)
  assert.doesNotMatch(provisioner, /randomUUID|uuidv4|nanoid/)
  assert.match(provisioner, /Conflicting Clerk profile mapping/)
})

test("Clerk webhook verifies the raw Svix request before provisioning", () => {
  assert.match(webhookHandler, /const rawBody = await request\.text\(\)/)
  assert.match(webhookHandler, /new Webhook\(signingSecret\)\.verify\(rawBody/)
  assert.ok(webhookHandler.indexOf(".verify(rawBody") < webhookHandler.indexOf("dependencies.provisionUser"))
})

test("Clerk route exports only supported Next.js route fields", () => {
  assert.match(webhookRoute, /export const dynamic =/)
  assert.match(webhookRoute, /export async function POST/)
  assert.doesNotMatch(webhookRoute, /export (?:async )?function handleClerkWebhook/)
})

test("Render contract scopes webhook and Edge secrets to their consumers", () => {
  const web = renderBlueprint.match(/  - type: web[\s\S]*?(?=\n  - type: worker)/)?.[0]
  const worker = renderBlueprint.match(/  - type: worker[\s\S]*$/)?.[0]
  assert.ok(web)
  assert.ok(worker)
  assert.match(web, /CLERK_WEBHOOK_SIGNING_SECRET/)
  assert.match(web, /EDGE_PROXY_HMAC_SECRET/)
  assert.match(worker, /EDGE_PROXY_HMAC_SECRET/)
  assert.doesNotMatch(worker, /CLERK_WEBHOOK_SIGNING_SECRET/)
})

test("staging migration procedure hashes, plans, applies, and verifies all four files", () => {
  const procedure = releaseOperations.slice(
    releaseOperations.indexOf("#### Staging-only migration procedure"),
    releaseOperations.indexOf("### Type-safety gate"),
  )
  const filenames = [
    "20260829000000_release_security_and_fulfilment_hardening.sql",
    "20260830000000_privileged_edge_and_evidence_jobs.sql",
    "20260909120000_harden_clerk_profile_provisioning.sql",
    "20260914120000_align_user_entitlements_pattern_c.sql",
  ]

  for (const filename of filenames) assert.match(procedure, new RegExp(filename.replaceAll(".", "\\.")))
  assert.match(procedure, /Get-FileHash -Algorithm SHA256/)
  assert.match(procedure, /migration list --db-url/)
  assert.match(procedure, /db push --db-url[^\n]+--dry-run/)
  assert.match(procedure, /db push --db-url/)
  assert.match(
    procedure,
    /Do not enable the Clerk webhook until `20260909120000` and `20260914120000` are present/,
  )
  assert.match(procedure, /Keep the worker suspended after migration verification/)
  assert.doesNotMatch(procedure, /supabase link/)
})
