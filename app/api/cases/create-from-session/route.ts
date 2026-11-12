import { NextResponse } from "next/server"
import { z } from "zod"

import { trackServerEvent } from "@/lib/analytics/server"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"

const requestSchema = z
  .object({
    token: z.string().min(1).max(512),
  })
  .strict()

function conversionStatus(message: string): number {
  if (message.includes("router_session_not_found")) return 404
  if (message.includes("router_session_owner_mismatch")) return 403
  if (message.includes("router_session_expired")) return 410
  if (message.includes("router_session_profile_missing")) return 409
  if (message.includes("router_session_inconsistent")) return 409
  return 500
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let parsed
  try {
    parsed = requestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const supabase = await createUserClient()
  const { data: caseId, error } = await supabase.rpc("convert_router_session_to_case_v1", {
    p_session_token: parsed.token,
  })

  if (error || !caseId) {
    const status = conversionStatus(error?.message ?? "")
    return NextResponse.json(
      { error: status === 500 ? "Failed to convert router session" : "Router session cannot be converted" },
      { status },
    )
  }

  try {
    await trackServerEvent({
      eventName: "router_conversion_imported",
      userId: user.supabaseUuid,
      sessionId: null,
      eventData: { case_id: caseId },
    })
  } catch {
    // Analytics failure must not turn a committed conversion into a client error.
  }

  return NextResponse.json({
    success: true,
    caseId,
    message: "Case created from session",
  })
}
