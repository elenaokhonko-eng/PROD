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
}

export function generateSessionToken(): string {
  return `router_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
}

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("router_session_token")
}

export function setSessionToken(token: string): void {
  if (typeof window === "undefined") return
  localStorage.setItem("router_session_token", token)
}

export function clearSessionToken(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem("router_session_token")
}

export async function createRouterSession(): Promise<RouterSession | null> {
  try {
    const res = await fetch("/api/router/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
    if (!res.ok) {
      const text = await res.text()
      console.error("[v0] Error creating router session:", res.status, text)
      return null
    }
    const { session } = (await res.json()) as { session: RouterSession }
    setSessionToken(session.session_token)
    return session
  } catch (error) {
    console.error("[v0] Error creating router session:", error)
    return null
  }
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
      try {
        sessionStorage.setItem("converted_router_session_token", sessionToken)
      } catch {
        // Ignore storage errors (e.g., Safari private mode)
      }
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
