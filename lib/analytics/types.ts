export type AnalyticsEventPayload = {
  eventName: string
  eventData?: Record<string, unknown>
  sessionId?: string | null
  userId?: string | null
  pageUrl?: string | null
  userAgent?: string | null
  createdAt?: string
}
