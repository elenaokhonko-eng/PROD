import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = process.cwd()
const migration = readFileSync(
  resolve(root, "supabase", "migrations", "20260915120000_harden_router_session_conversion.sql"),
  "utf8",
)
const sessionRoute = readFileSync(resolve(root, "app", "api", "router", "session", "route.ts"), "utf8")
const conversionRoute = readFileSync(
  resolve(root, "app", "api", "cases", "create-from-session", "route.ts"),
  "utf8",
)
const routerSession = readFileSync(resolve(root, "lib", "router-session.ts"), "utf8")
const caseTypes = readFileSync(resolve(root, "lib", "types", "case.ts"), "utf8")

function indexOfRequired(source: string, marker: string) {
  const index = source.indexOf(marker)
  assert.notEqual(index, -1, `Missing required marker: ${marker}`)
  return index
}

test("router conversion migration fails closed before installing its RPC", () => {
  const preflight = indexOfRequired(migration, "DO $preflight$")
  const functionStart = indexOfRequired(migration, "CREATE OR REPLACE FUNCTION public.convert_router_session_to_case_v1")

  assert.ok(preflight < functionStart)
  assert.match(migration, /status = 'IMPORTED'[\s\S]*converted_to_case_id IS NULL/)
  assert.match(migration, /converted_to_case_id IS NOT NULL[\s\S]*c\.id IS NULL/)
  assert.match(migration, /c\.user_id IS DISTINCT FROM rs\.converted_to_user_id/)
  assert.match(migration, /LOCK TABLE public\.router_sessions, public\.cases IN SHARE ROW EXCLUSIVE MODE/)
})

test("router conversion derives ownership and serializes the claim", () => {
  assert.match(migration, /v_owner_id uuid := public\.current_app_user_id\(\)/)
  assert.match(migration, /WHERE rs\.session_token = p_session_token[\s\S]*FOR UPDATE/)
  assert.match(migration, /converted_to_user_id <> v_owner_id/)
  assert.match(migration, /FROM public\.profiles p[\s\S]*WHERE p\.id = v_owner_id/)
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = ''/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.convert_router_session_to_case_v1\(text\) TO authenticated, service_role/)
  assert.doesNotMatch(migration, /auth\.uid\(\)/)
})

test("public router updates reject privileged ownership and lifecycle fields", () => {
  const updateSchema = sessionRoute.slice(
    sessionRoute.indexOf("const updatePayloadSchema"),
    sessionRoute.indexOf("export async function POST"),
  )
  assert.match(updateSchema, /\.strict\(\)/)
  assert.match(sessionRoute, /\.eq\("status", "ACTIVE"\)[\s\S]*\.gt\("expires_at"/)
  assert.doesNotMatch(updateSchema, /converted_to_user_id|converted_to_case_id|converted_at|expires_at/)
  assert.doesNotMatch(sessionRoute, /console\.(?:log|warn|error)\([^\n]*session_token/)
  assert.doesNotMatch(sessionRoute, /select\("\*"\)/)
})

test("converted router reads require the canonical authenticated profile", () => {
  assert.match(sessionRoute, /const user = await getCurrentUser\(\)/)
  assert.match(sessionRoute, /converted_to_user_id", user\.supabaseUuid/)
  assert.match(sessionRoute, /session\.converted_to_user_id !== user\.supabaseUuid/)
  assert.doesNotMatch(sessionRoute, /auth\.getUser\(\)/)
})

test("case conversion is authenticated and delegated to one atomic RPC", () => {
  assert.match(conversionRoute, /if \(!user\) \{[\s\S]*status: 401/)
  assert.match(conversionRoute, /createUserClient\(\)/)
  assert.match(conversionRoute, /convert_router_session_to_case_v1/)
  assert.doesNotMatch(conversionRoute, /createServiceClient|converted_to_user_id|\.from\("router_sessions"\)/)
  assert.doesNotMatch(conversionRoute, /console\.(?:log|warn|error)\([^\n]*token/)
})

test("application ownership documentation names public profiles", () => {
  assert.match(caseTypes, /FK → public\.profiles\.id \(Pattern C\)/)
  assert.doesNotMatch(caseTypes, /FK → auth\.users\.id \(Pattern C\)/)
  assert.doesNotMatch(routerSession, /convertRouterSessionToUser/)
  assert.match(routerSession, /export type RouterSessionUpdate/)
})
