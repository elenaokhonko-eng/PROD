import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createServiceClient } from "@/lib/supabase/service"

const payloadSchema = z.object({
  user_id: z.string(),
  email: z.string().email(),
  consent_purposes: z.array(z.string()).default([]),
  policy_version: z.string().default("1.0"),
  consented_at: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const json = await request.json()
    const parsed = payloadSchema.parse(json)
    console.log(
      `[Consent Log] Received request for userId: ${parsed.user_id}, purposes: ${parsed.consent_purposes.join(", ")}`,
    )

    const supabase = createServiceClient()

    try {
      const { error } = await supabase.from("consent_logs").insert({
        user_id: parsed.user_id,
        email: parsed.email,
        consent_purposes: parsed.consent_purposes,
        policy_version: parsed.policy_version,
        consented_at: parsed.consented_at ?? new Date().toISOString(),
      })

      if (error) {
        throw error
      }

      console.log(`[Consent Log] Insert successful for userId: ${parsed.user_id}`)
    } catch (dbError) {
      console.error(`[Consent Log] Insert failed for userId: ${parsed.user_id}:`, dbError)
      return NextResponse.json({ error: "Failed to record consent" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[consent-log] Request error:", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
