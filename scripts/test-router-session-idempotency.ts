import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import {
  clearSessionToken,
  createRouterSession,
  replaceRouterSessionIfCurrent,
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

test("concurrent expired-token initializers create one replacement and ignore a late result", async () => {
  clearSessionToken()
  storage.setItem("router_session_token", "expired-token")
  const pending = deferred()
  const bodies: string[] = []
  globalThis.fetch = (async (_input, init) => {
    bodies.push(String(init?.body))
    return pending.promise
  }) as typeof fetch

  const first = replaceRouterSessionIfCurrent("expired-token")
  const second = replaceRouterSessionIfCurrent("expired-token")
  assert.equal(second, first)
  assert.equal(bodies.length, 1)

  pending.resolve(sessionResponse("replacement-token"))
  const [firstSession, secondSession] = await Promise.all([first, second])
  assert.equal(firstSession?.session_token, "replacement-token")
  assert.equal(secondSession?.session_token, "replacement-token")
  assert.equal(storage.getItem("router_session_token"), "replacement-token")

  const lateResult = await replaceRouterSessionIfCurrent("expired-token")
  assert.equal(lateResult, null)
  assert.equal(bodies.length, 1)
  assert.equal(storage.getItem("router_session_token"), "replacement-token")
})

test("failed expired-token replacement permits a same-intent retry", async () => {
  clearSessionToken()
  storage.setItem("router_session_token", "failed-expired-token")
  const bodies: string[] = []
  let attempt = 0
  globalThis.fetch = (async (_input, init) => {
    bodies.push(String(init?.body))
    attempt += 1
    if (attempt === 1) throw new Error("offline")
    return sessionResponse("retried-replacement-token")
  }) as typeof fetch

  await assert.rejects(replaceRouterSessionIfCurrent("failed-expired-token"), /offline/)
  assert.equal(storage.getItem("router_session_token"), null)

  await createRouterSession()
  assert.equal(bodies.length, 2)
  assert.equal(JSON.parse(bodies[0]).intent, JSON.parse(bodies[1]).intent)
  assert.equal(storage.getItem("router_session_token"), "retried-replacement-token")
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

test("start fresh supersedes a pending replacement with one distinct creation", async () => {
  clearSessionToken()
  storage.setItem("router_session_token", "expired-before-start-fresh")
  const expired = deferred()
  const fresh = deferred()
  const bodies: string[] = []
  globalThis.fetch = (async (_input, init) => {
    bodies.push(String(init?.body))
    return bodies.length === 1 ? expired.promise : fresh.promise
  }) as typeof fetch

  const expiredRequest = replaceRouterSessionIfCurrent("expired-before-start-fresh")
  clearSessionToken()
  rotateRouterSessionIntent()
  const freshRequest = createRouterSession()
  assert.equal(bodies.length, 2)
  assert.notEqual(JSON.parse(bodies[0]).intent, JSON.parse(bodies[1]).intent)

  expired.resolve(sessionResponse("stale-replacement-token"))
  await expiredRequest
  assert.equal(storage.getItem("router_session_token"), null)

  fresh.resolve(sessionResponse("start-fresh-token"))
  await freshRequest
  assert.equal(storage.getItem("router_session_token"), "start-fresh-token")
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
  assert.match(page, /await replaceRouterSessionIfCurrent\(existingToken\)/)
  assert.match(page, /rotateRouterSessionIntent\(\)/)
  assert.match(onboarding, /clearSessionToken\(\)\s*\n\s*rotateRouterSessionIntent\(\)/)
})
