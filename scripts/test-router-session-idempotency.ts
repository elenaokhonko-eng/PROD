import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import {
  clearSessionToken,
  createRouterSession,
  rotateRouterSessionIntent,
} from "../lib/router-session"

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, "window", { value: { localStorage: storage }, configurable: true })
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })

type Deferred = {
  resolve: (response: Response) => void
  reject: (error: Error) => void
  promise: Promise<Response>
}

function deferred(): Deferred {
  let resolve!: (response: Response) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Response>((res, rej) => { resolve = res; reject = rej })
  return { resolve, reject, promise }
}

function sessionResponse(token: string): Response {
  return new Response(JSON.stringify({ session: {
    id: token,
    session_token: token,
    created_at: "2026-08-31T00:00:00.000Z",
    expires_at: "2026-09-01T00:00:00.000Z",
  } }), { status: 200, headers: { "Content-Type": "application/json" } })
}

test("clear invalidates single-flight and a late response cannot restore its token", async () => {
  rotateRouterSessionIntent()
  const first = deferred()
  const second = deferred()
  const requests: RequestInit[] = []
  globalThis.fetch = (async (_input, init) => {
    requests.push(init ?? {})
    return requests.length === 1 ? first.promise : second.promise
  }) as typeof fetch

  const oldRequest = createRouterSession()
  assert.equal(createRouterSession(), oldRequest)
  clearSessionToken()
  const newRequest = createRouterSession()
  assert.notEqual(newRequest, oldRequest)
  assert.equal(requests.length, 2)

  first.resolve(sessionResponse("old-token"))
  await oldRequest
  assert.equal(storage.getItem("router_session_token"), null)

  second.resolve(sessionResponse("new-token"))
  await newRequest
  assert.equal(storage.getItem("router_session_token"), "new-token")
})

test("a cross-tab intent rotation blocks a late token write", async () => {
  clearSessionToken()
  const pending = deferred()
  globalThis.fetch = (async () => pending.promise) as typeof fetch

  const request = createRouterSession()
  storage.setItem("router_session_creation_intent", crypto.randomUUID())
  pending.resolve(sessionResponse("cross-tab-stale-token"))
  await request
  assert.equal(storage.getItem("router_session_token"), null)
})

test("creation failures reject visibly and retry with the same intent", async () => {
  clearSessionToken()
  const bodies: string[] = []
  const sessionsByIntent = new Map<string, string>()
  let attempt = 0
  globalThis.fetch = (async (_input, init) => {
    bodies.push(String(init?.body))
    const intent = JSON.parse(String(init?.body)).intent as string
    const token = sessionsByIntent.get(intent) ?? "retry-token"
    sessionsByIntent.set(intent, token)
    attempt += 1
    if (attempt === 1) throw new Error("offline")
    return sessionResponse(token)
  }) as typeof fetch

  await assert.rejects(createRouterSession(), /offline/)
  await createRouterSession()
  assert.equal(JSON.parse(bodies[0]).intent, JSON.parse(bodies[1]).intent)
  assert.equal(sessionsByIntent.size, 1)
  assert.equal(storage.getItem("router_session_token"), "retry-token")
})

test("start-fresh intent rotation creates a distinct creation identity", async () => {
  clearSessionToken()
  const bodies: string[] = []
  globalThis.fetch = (async (_input, init) => {
    bodies.push(String(init?.body))
    return sessionResponse(`token-${bodies.length}`)
  }) as typeof fetch

  await createRouterSession()
  clearSessionToken()
  rotateRouterSessionIntent()
  await createRouterSession()
  assert.notEqual(JSON.parse(bodies[0]).intent, JSON.parse(bodies[1]).intent)
})

test("server and UI retain the durable idempotency and visible-error contracts", () => {
  const root = process.cwd()
  const route = fs.readFileSync(path.join(root, "app/api/router/session/route.ts"), "utf8")
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/20260831180000_router_session_creation_intent.sql"),
    "utf8",
  )
  const page = fs.readFileSync(path.join(root, "app/router/page.tsx"), "utf8")
  const onboarding = fs.readFileSync(path.join(root, "app/(auth)/onboarding/page.tsx"), "utf8")

  assert.match(route, /intent:\s*z\.string\(\)\.uuid\(\)/)
  assert.match(route, /error\.code === "23505"/)
  assert.match(route, /\.eq\("creation_intent", parsed\.intent\)/)
  assert.match(migration, /CREATE UNIQUE INDEX router_sessions_creation_intent_key/)
  assert.match(page, /setSessionError\('A new complaint check could not be started\./)
  assert.match(page, /rotateRouterSessionIntent\(\)/)
  assert.match(onboarding, /clearSessionToken\(\)\s*\n\s*rotateRouterSessionIntent\(\)/)
})
