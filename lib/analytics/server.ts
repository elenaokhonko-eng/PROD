import { createServiceClient } from "@/lib/supabase/service"
import type { AnalyticsEventPayload } from "./types"

function buildRecord(payload: AnalyticsEventPayload) {
  const record = {
    event_name: payload.eventName,
    event_data: payload.eventData ?? null,
    session_id: payload.sessionId ?? null,
    user_id: payload.userId ?? null,
    page_url: payload.pageUrl ?? null,
    user_agent: payload.userAgent ?? null,
    created_at: payload.createdAt ?? new Date().toISOString(),
  }

  return record
}

export async function trackServerEvent(payload: AnalyticsEventPayload) {
  const supabase = createServiceClient()
  const record = buildRecord(payload)

  const { error } = await supabase.from("analytics_events").insert(record)
  if (error) {
    const analyticsError = new Error(`Failed to record analytics event "${payload.eventName}": ${error.message}`)
    ;(analyticsError as Error & { cause?: unknown }).cause = error
    throw analyticsError
  }
}
