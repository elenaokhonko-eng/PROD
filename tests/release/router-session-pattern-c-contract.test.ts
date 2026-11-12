import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { NextRequest } from "next/server"
import test from "node:test"
import {
  createRouterSessionHandlers,
  type RouterSessionRouteDependencies,
} from "../../app/api/router/session/handlers"

const root = process.cwd()
const migration = readFileSync(
  resolve(root, "supabase", "migrations", "20260915120000_harden_router_session_conversion.sql"),
  "utf8",
)
const sessionRoute = readFileSync(resolve(root, "app", "api", "router", "session", "route.ts"), "utf8")
const sessionHandlers = readFileSync(resolve(root, "app", "api", "router", "session", "handlers.ts"), "utf8")
const sessionSource = `${sessionRoute}\n${sessionHandlers}`
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
  const updateSchema = sessionHandlers.slice(
    sessionHandlers.indexOf("const updatePayloadSchema"),
    sessionHandlers.indexOf("export type RouterSessionRouteDependencies"),
  )
  assert.match(updateSchema, /\.strict\(\)/)
  assert.match(sessionSource, /\.eq\("status", "ACTIVE"\)[\s\S]*\.gt\("expires_at"/)
  assert.match(sessionSource, /\.is\("converted_to_user_id", null\)/)
  assert.match(sessionSource, /\.is\("converted_to_case_id", null\)/)
  assert.match(sessionSource, /\.is\("converted_at", null\)/)
  assert.doesNotMatch(updateSchema, /converted_to_user_id|converted_to_case_id|converted_at|expires_at/)
  assert.doesNotMatch(sessionSource, /console\.(?:log|warn|error)\([^\n]*session_token/)
  assert.doesNotMatch(sessionSource, /select\("\*"\)/)
})

test("converted router reads require the canonical authenticated profile", () => {
  assert.match(sessionSource, /z\.string\(\)\.uuid\(\)\.safeParse\(convertedFor\)/)
  assert.match(sessionSource, /convertedForResult\.data !== convertedForUser\.supabaseUuid/)
  assert.match(sessionSource, /converted_to_user_id", convertedForUser\.supabaseUuid/)
  assert.match(sessionSource, /session\.converted_to_user_id !== user\.supabaseUuid/)
  assert.doesNotMatch(sessionSource, /auth\.getUser\(\)/)
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

type TestUser = { userId: string; supabaseUuid: string }
type QueryResult = { data: unknown; error: { code?: string; message?: string } | null }
type QueryCall = { method: string; args: unknown[] }

class FakeQueryBuilder {
  readonly calls: QueryCall[] = []

  constructor(private readonly result: QueryResult) {}

  select(...args: unknown[]) {
    this.calls.push({ method: "select", args })
    return this
  }

  update(...args: unknown[]) {
    this.calls.push({ method: "update", args })
    return this
  }

  eq(...args: unknown[]) {
    this.calls.push({ method: "eq", args })
    return this
  }

  gt(...args: unknown[]) {
    this.calls.push({ method: "gt", args })
    return this
  }

  is(...args: unknown[]) {
    this.calls.push({ method: "is", args })
    return this
  }

  order(...args: unknown[]) {
    this.calls.push({ method: "order", args })
    return this
  }

  limit(...args: unknown[]) {
    this.calls.push({ method: "limit", args })
    return this
  }

  maybeSingle() {
    this.calls.push({ method: "maybeSingle", args: [] })
    return Promise.resolve(this.result)
  }
}

function fakeClient(result: QueryResult) {
  const builder = new FakeQueryBuilder(result)
  const client = {
    from(table: string) {
      builder.calls.push({ method: "from", args: [table] })
      return builder
    },
  } as unknown as ReturnType<RouterSessionRouteDependencies["createServiceClient"]>
  return { client, builder }
}

function makeHandlers(user: TestUser | null, result: QueryResult) {
  const fake = fakeClient(result)
  let authCalls = 0
  let serviceClientCalls = 0
  const dependencies: Partial<RouterSessionRouteDependencies> = {
    getCurrentUser: async () => {
      authCalls += 1
      return user
    },
    createServiceClient: (() => {
      serviceClientCalls += 1
      return fake.client
    }) as RouterSessionRouteDependencies["createServiceClient"],
    rateLimit: (() => ({ ok: true, remaining: 99, reset: Date.now() + 60_000 })) as RouterSessionRouteDependencies["rateLimit"],
    keyFrom: (() => "router-session-behavior-test") as RouterSessionRouteDependencies["keyFrom"],
  }

  return {
    handlers: createRouterSessionHandlers(dependencies),
    builder: fake.builder,
    authCalls: () => authCalls,
    serviceClientCalls: () => serviceClientCalls,
  }
}

function getRequest(query: string) {
  return new NextRequest(`http://localhost/api/router/session${query}`)
}

function patchRequest(updates: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/router/session", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_token: "router-test-token", updates }),
  })
}

function hasCall(builder: FakeQueryBuilder, method: string, ...args: unknown[]) {
  return builder.calls.some((call) => call.method === method && JSON.stringify(call.args) === JSON.stringify(args))
}

const USER_A: TestUser = {
  userId: "user_test_a",
  supabaseUuid: "11111111-1111-4111-8111-111111111111",
}
const USER_B_UUID = "22222222-2222-4222-8222-222222222222"
const CONVERTED_SESSION = {
  id: "session-test-id",
  session_token: "router-test-token",
  status: "CONVERTED",
  converted_to_user_id: USER_A.supabaseUuid,
  converted_at: "2026-09-19T00:00:00.000Z",
}
const EMPTY_RESULT: QueryResult = { data: null, error: null }

test("convertedFor rejects malformed UUIDs and Clerk IDs before authentication", async (t) => {
  for (const value of ["not-a-uuid", "user_abc123"]) {
    await t.test(value, async () => {
      const { handlers, authCalls, serviceClientCalls } = makeHandlers(USER_A, { data: CONVERTED_SESSION, error: null })
      const response = await handlers.GET(getRequest(`?convertedFor=${encodeURIComponent(value)}`))

      assert.equal(response.status, 400)
      assert.equal(authCalls(), 0)
      assert.equal(serviceClientCalls(), 0)
    })
  }
})

test("convertedFor requires authentication", async () => {
  const { handlers, authCalls, serviceClientCalls } = makeHandlers(null, { data: CONVERTED_SESSION, error: null })
  const response = await handlers.GET(getRequest(`?convertedFor=${USER_A.supabaseUuid}`))

  assert.equal(response.status, 401)
  assert.equal(authCalls(), 1)
  assert.equal(serviceClientCalls(), 0)
})

test("convertedFor rejects a different authenticated profile", async () => {
  const { handlers, authCalls, serviceClientCalls } = makeHandlers(USER_A, { data: CONVERTED_SESSION, error: null })
  const response = await handlers.GET(getRequest(`?convertedFor=${USER_B_UUID}`))

  assert.equal(response.status, 403)
  assert.equal(authCalls(), 1)
  assert.equal(serviceClientCalls(), 0)
})

test("convertedFor queries only the signed profile and redacts its owner UUID", async () => {
  const { handlers, builder } = makeHandlers(USER_A, { data: CONVERTED_SESSION, error: null })
  const response = await handlers.GET(getRequest(`?convertedFor=${USER_A.supabaseUuid}`))

  assert.equal(response.status, 200)
  assert.ok(hasCall(builder, "eq", "converted_to_user_id", USER_A.supabaseUuid))
  assert.ok(hasCall(builder, "maybeSingle"))

  const body = await response.json() as { session: Record<string, unknown> }
  assert.equal(body.session.converted_to_user_id, undefined)
})

test("PATCH allows an active unexpired unclaimed intake update", async () => {
  const result: QueryResult = {
    data: { id: "session-test-id", session_token: "router-test-token", dispute_narrative: "updated" },
    error: null,
  }
  const { handlers, builder } = makeHandlers(USER_A, result)
  const response = await handlers.PATCH(patchRequest({ dispute_narrative: "updated" }))

  assert.equal(response.status, 200)
  assert.ok(hasCall(builder, "update", { dispute_narrative: "updated" }))
  assert.ok(hasCall(builder, "eq", "session_token", "router-test-token"))
  assert.ok(hasCall(builder, "eq", "status", "ACTIVE"))
  assert.ok(builder.calls.some((call) => call.method === "gt" && call.args[0] === "expires_at"))
  assert.ok(hasCall(builder, "is", "converted_to_user_id", null))
  assert.ok(hasCall(builder, "is", "converted_to_case_id", null))
  assert.ok(hasCall(builder, "is", "converted_at", null))
  assert.ok(hasCall(builder, "maybeSingle"))
})

test("PATCH fails closed for claimed, converted, imported, and expired sessions", async (t) => {
  const rejectedStates = [
    "converted_to_user_id non-NULL",
    "converted_to_case_id non-NULL",
    "converted_at non-NULL",
    "all conversion fields non-NULL",
    "CONVERTED status",
    "IMPORTED status",
    "EXPIRED status",
    "expired ACTIVE session",
  ]

  for (const state of rejectedStates) {
    await t.test(state, async () => {
      const { handlers, builder } = makeHandlers(USER_A, EMPTY_RESULT)
      const response = await handlers.PATCH(patchRequest({ dispute_narrative: "must not persist" }))

      assert.equal(response.status, 409)
      assert.ok(hasCall(builder, "is", "converted_to_user_id", null))
      assert.ok(hasCall(builder, "is", "converted_to_case_id", null))
      assert.ok(hasCall(builder, "is", "converted_at", null))
    })
  }
})

test("PATCH rejects privileged and unknown properties before creating an update client", async (t) => {
  const invalidUpdates = [
    { name: "converted_to_user_id", value: USER_A.supabaseUuid },
    { name: "converted_to_case_id", value: "case-test-id" },
    { name: "converted_at", value: "2026-09-19T00:00:00.000Z" },
    { name: "status", value: "CONVERTED" },
    { name: "expires_at", value: "2026-09-20T00:00:00.000Z" },
    { name: "unknown_field", value: "rejected" },
  ]

  for (const invalid of invalidUpdates) {
    await t.test(invalid.name, async () => {
      const { handlers, serviceClientCalls } = makeHandlers(USER_A, EMPTY_RESULT)
      const response = await handlers.PATCH(patchRequest({ [invalid.name]: invalid.value }))

      assert.equal(response.status, 400)
      assert.equal(serviceClientCalls(), 0)
    })
  }
})

test("PATCH returns 409 when the atomic guarded update matches no row", async () => {
  const { handlers, builder } = makeHandlers(USER_A, EMPTY_RESULT)
  const response = await handlers.PATCH(patchRequest({ dispute_narrative: "no matching row" }))

  assert.equal(response.status, 409)
  assert.ok(hasCall(builder, "maybeSingle"))
  assert.ok(hasCall(builder, "is", "converted_to_user_id", null))
  assert.ok(hasCall(builder, "is", "converted_to_case_id", null))
  assert.ok(hasCall(builder, "is", "converted_at", null))
})
