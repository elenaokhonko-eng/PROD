import type { AnalyticsEventPayload } from "./types"

const TRACK_ENDPOINT = "/api/analytics/track"

export async function trackClientEvent(payload: AnalyticsEventPayload) {
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
