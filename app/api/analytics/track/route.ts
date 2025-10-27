import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import type { AnalyticsEventPayload } from "@/lib/analytics/types"
import { trackServerEvent } from "@/lib/analytics/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"

const payloadSchema = z.object({
  eventName: z.string().min(1, "eventName is required"),
  eventData: z.record(z.any()).optional(),
  sessionId: z.string().optional(),
  userId: z.string().uuid().optional(),
  pageUrl: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.string().optional(),
})

const log = logger.withContext({ module: "analytics-track" })

export async function POST(request: NextRequest) {
  try {
    let parsed
    try {
      parsed = payloadSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid analytics payload", details: err.flatten() }, { status: 400 })
      }

      return NextResponse.json({ error: "Invalid analytics payload" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const payload: AnalyticsEventPayload = {
      eventName: parsed.eventName,
      eventData: parsed.eventData,
      sessionId: parsed.sessionId ?? null,
      userId: parsed.userId ?? user?.id ?? null,
      pageUrl: parsed.pageUrl ?? request.headers.get("referer") ?? null,
      userAgent: parsed.userAgent ?? request.headers.get("user-agent") ?? null,
      createdAt: parsed.createdAt,
    }

    await trackServerEvent(payload)
    log.debug("Recorded analytics event", {
      eventName: payload.eventName,
      userId: payload.userId,
      hasSession: Boolean(payload.sessionId),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error("Failed to record analytics event", {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to record analytics event" }, { status: 500 })
  }
}
