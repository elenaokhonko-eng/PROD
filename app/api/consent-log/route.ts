import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"

const payloadSchema = z.object({
  consent_purposes: z.array(z.string().trim().min(1).max(100)).max(32).default([]),
  policy_version: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/).default("1.0"),
})

export async function POST(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let parsed: z.infer<typeof payloadSchema>
  try {
    parsed = payloadSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const supabase = await createUserClient()
  const { data: consentId, error } = await supabase.rpc("record_my_consent", {
    p_consent_purposes: parsed.consent_purposes,
    p_policy_version: parsed.policy_version,
  })

  if (error || !consentId) {
    console.error("[consent-log] Failed to record consent", error)
    return NextResponse.json({ error: "Failed to record consent" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
