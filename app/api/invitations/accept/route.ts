import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth"
import { keyFrom, rateLimit } from "@/lib/rate-limit"
import { createUserClient } from "@/lib/supabase/server"

const acceptSchema = z.object({
  invitationToken: z.string().min(32, "Invalid invitation token").max(256, "Invalid invitation token"),
})

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(keyFrom(request, "/api/invitations/accept"), 10, 60_000)
    if (!rl.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let parsed
    try {
      parsed = acceptSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const supabase = await createUserClient()
    const { data: acceptedRows, error: acceptError } = await supabase.rpc("accept_case_invitation", {
      p_token: parsed.invitationToken,
    })

    if (acceptError) {
      console.error("[invitations/accept] RPC failed", acceptError)
      return NextResponse.json({ error: "Unable to accept invitation" }, { status: 500 })
    }

    const accepted = acceptedRows?.[0]
    if (!accepted) {
      return NextResponse.json({ error: "Invalid or expired invitation" }, { status: 400 })
    }

    return NextResponse.json({ success: true, caseId: accepted.case_id })
  } catch (error) {
    console.error("[v0] Invitation accept error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
