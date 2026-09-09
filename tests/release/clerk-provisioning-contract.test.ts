import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = process.cwd()
const migration = readFileSync(
  resolve(root, "supabase", "migrations", "20260909120000_harden_clerk_profile_provisioning.sql"),
  "utf8",
)
const provisioner = readFileSync(resolve(root, "lib", "server", "clerk-profile-provisioner.ts"), "utf8")
const webhook = readFileSync(resolve(root, "app", "api", "webhooks", "clerk", "route.ts"), "utf8")
const renderBlueprint = readFileSync(resolve(root, "render.yaml"), "utf8")

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
})

test("runtime provisioner delegates UUID ownership to the RPC and patches only one metadata key", () => {
  assert.match(provisioner, /\.rpc\("provision_clerk_profile_v1"/)
  assert.match(provisioner, /publicMetadata: \{ supabase_uuid: profileId \}/)
  assert.doesNotMatch(provisioner, /randomUUID|uuidv4|nanoid/)
  assert.match(provisioner, /Conflicting Clerk profile mapping/)
})

test("Clerk webhook verifies the raw Svix request before provisioning", () => {
  assert.match(webhook, /const rawBody = await request\.text\(\)/)
  assert.match(webhook, /new Webhook\(signingSecret\)\.verify\(rawBody/)
  assert.ok(webhook.indexOf(".verify(rawBody") < webhook.indexOf("dependencies.provisionUser"))
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
