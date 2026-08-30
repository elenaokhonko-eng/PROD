import type { AnalyticsEventPayload } from "./types"

const TRACK_ENDPOINT = "/api/analytics/track"
const analyticsConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

export async function trackClientEvent(payload: AnalyticsEventPayload) {
  if (!analyticsConfigured) return

  try {
    const response = await fetch(TRACK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      let details: unknown
      try {
        details = await response.json()
      } catch {
        details = await response.text()
      }

      console.error(
        `[analytics] Failed to record event "${payload.eventName}" (status ${response.status}):`,
        details,
      )
    }
  } catch (error) {
    console.error(`[analytics] Network error while recording "${payload.eventName}":`, error)
  }
}
