import { trackClientEvent } from "@/lib/analytics/client"

export interface RouterSession {
  id: string
  session_token: string
  dispute_narrative?: string
  voice_transcript?: string
  audio_file_url?: string
  classification_result?: Record<string, unknown> | null
  clarifying_questions?: Record<string, unknown> | null
  user_responses?: Record<string, unknown> | null
  eligibility_assessment?: { [key: string]: unknown; eligibility_score?: number | null } | null
  recommended_path?: string
  created_at: string
  expires_at: string
  converted_to_user_id?: string
  converted_to_case_id?: string | null
  converted_at?: string | null
  status?: "ACTIVE" | "CONVERTED" | "EXPIRED"
}

const ROUTER_SESSION_TOKEN_KEY = "router_session_token"
const ROUTER_SESSION_INTENT_KEY = "router_session_creation_intent"
const CONVERTED_ROUTER_SESSION_TOKEN_KEY = "converted_router_session_token"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let createRouterSessionPromise: Promise<RouterSession> | null = null
let createRouterSessionGeneration = 0
let routerSessionIntentMemory: string | null = null

function invalidateRouterSessionCreation(): void {
  createRouterSessionGeneration += 1
  createRouterSessionPromise = null
}

function generateCreationIntent(): string {
  return crypto.randomUUID()
}

function getOrCreateRouterSessionIntent(): string {
  if (typeof window !== "undefined") {
    try {
      const existing = localStorage.getItem(ROUTER_SESSION_INTENT_KEY)
      if (existing && UUID_PATTERN.test(existing)) {
        routerSessionIntentMemory = existing
        return existing
      }
    } catch {
      // Continue with an in-memory intent when storage is unavailable.
    }
  }
  if (routerSessionIntentMemory) return routerSessionIntentMemory
  const intent = generateCreationIntent()
  routerSessionIntentMemory = intent
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(ROUTER_SESSION_INTENT_KEY, intent)
    } catch {
      // The in-memory intent still protects retries during this page lifetime.
    }
  }
  return intent
}

export function rotateRouterSessionIntent(): string {
  invalidateRouterSessionCreation()
  const intent = generateCreationIntent()
  routerSessionIntentMemory = intent
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(ROUTER_SESSION_INTENT_KEY, intent)
    } catch {
      // The new intent remains valid for this page lifetime.
    }
  }
  return intent
}

export function generateSessionToken(): string {
  return `router_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
}

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(ROUTER_SESSION_TOKEN_KEY)
}

export function setSessionToken(token: string): void {
  if (typeof window === "undefined") return
  localStorage.setItem(ROUTER_SESSION_TOKEN_KEY, token)
}

export function clearSessionToken(): void {
  invalidateRouterSessionCreation()
  if (typeof window === "undefined") return
  localStorage.removeItem(ROUTER_SESSION_TOKEN_KEY)
}

export function persistConvertedRouterSessionToken(token: string) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(CONVERTED_ROUTER_SESSION_TOKEN_KEY, token)
  } catch {
    // Ignore sessionStorage failures (e.g., Safari private mode)
  }

  try {
    localStorage.setItem(CONVERTED_ROUTER_SESSION_TOKEN_KEY, token)
  } catch {
    // Ignore localStorage failures (e.g., storage disabled)
  }
}

export function getConvertedRouterSessionToken(): string | null {
  if (typeof window === "undefined") return null

  try {
    const token = sessionStorage.getItem(CONVERTED_ROUTER_SESSION_TOKEN_KEY)
    if (token) return token
  } catch {
    // Ignore sessionStorage failures
  }

  try {
    return localStorage.getItem(CONVERTED_ROUTER_SESSION_TOKEN_KEY)
  } catch {
    return null
  }
}

export function clearConvertedRouterSessionToken(): void {
  if (typeof window === "undefined") return

  try {
    sessionStorage.removeItem(CONVERTED_ROUTER_SESSION_TOKEN_KEY)
  } catch {
    // Ignore
  }

  try {
    localStorage.removeItem(CONVERTED_ROUTER_SESSION_TOKEN_KEY)
  } catch {
    // Ignore
  }
}

export function consumeConvertedRouterSessionToken(): string | null {
  if (typeof window === "undefined") return null

  let token: string | null = null

  try {
    token = sessionStorage.getItem(CONVERTED_ROUTER_SESSION_TOKEN_KEY)
  } catch {
    token = null
  }

  if (!token) {
    try {
      token = localStorage.getItem(CONVERTED_ROUTER_SESSION_TOKEN_KEY)
    } catch {
      token = null
    }
  }

  try {
    sessionStorage.removeItem(CONVERTED_ROUTER_SESSION_TOKEN_KEY)
  } catch {
    // Ignore
  }

  if (token) {
    try {
      localStorage.removeItem(CONVERTED_ROUTER_SESSION_TOKEN_KEY)
    } catch {
      // Ignore
    }
  }

  return token
}

export function createRouterSession(): Promise<RouterSession> {
  if (createRouterSessionPromise) return createRouterSessionPromise

  const generation = createRouterSessionGeneration
  const intent = getOrCreateRouterSessionIntent()
  const request = createRouterSessionRequest(intent, generation)
  createRouterSessionPromise = request
  const clearRequest = () => {
    if (createRouterSessionPromise === request) createRouterSessionPromise = null
  }
  void request.then(clearRequest, clearRequest)
  return request
}

async function createRouterSessionRequest(intent: string, generation: number): Promise<RouterSession> {
  const res = await fetch("/api/router/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error("[v0] Error creating router session:", res.status, text)
    throw new Error("Failed to create router session")
  }
  const { session } = (await res.json()) as { session: RouterSession }
  if (generation === createRouterSessionGeneration && intent === getOrCreateRouterSessionIntent()) {
    setSessionToken(session.session_token)
  }
  return session
}

export async function getRouterSession(sessionToken: string): Promise<RouterSession | null> {
  try {
    const res = await fetch(`/api/router/session?token=${encodeURIComponent(sessionToken)}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
    })
    if (!res.ok) {
      if (res.status !== 404) {
        const text = await res.text()
        console.error("[v0] Error fetching router session:", res.status, text)
      }
      return null
    }
    const { session } = (await res.json()) as { session: RouterSession }
    return session
  } catch (error) {
    console.error("[v0] Error fetching router session:", error)
    return null
  }
}

export async function updateRouterSession(
  sessionToken: string,
  updates: Partial<RouterSession>,
): Promise<RouterSession | null> {
  try {
    const res = await fetch("/api/router/session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ session_token: sessionToken, updates }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error("[v0] Error updating router session:", res.status, text)
      return null
    }
    const { session } = (await res.json()) as { session: RouterSession }
    return session
  } catch (error) {
    console.error("[v0] Error updating router session:", error)
    return null
  }
}

export async function convertRouterSessionToUser(
  sessionToken: string,
  userId: string,
): Promise<{ success: boolean; sessionData?: RouterSession }> {
  try {
    const res = await fetch("/api/router/session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        session_token: sessionToken,
        updates: {
          converted_to_user_id: userId,
          converted_at: new Date().toISOString(),
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error("[v0] Error converting router session:", res.status, text)
      return { success: false }
    }

    const { session: data } = (await res.json()) as { session: RouterSession }

    if (typeof window !== "undefined") {
      persistConvertedRouterSessionToken(sessionToken)
    }

    await trackClientEvent({
      eventName: "router_conversion_complete",
      userId: userId,
      sessionId: sessionToken,
      eventData: {
        session_id: data.id,
        recommended_path: data.recommended_path,
        eligibility_score: data.eligibility_assessment?.eligibility_score,
      },
      pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent: typeof window !== "undefined" ? navigator.userAgent : undefined,
    })

    return { success: true, sessionData: data }
  } catch (error) {
    console.error("[v0] Conversion error:", error)
    return { success: false }
  }
}
