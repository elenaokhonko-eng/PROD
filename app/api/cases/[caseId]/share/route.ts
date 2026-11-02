import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth"
import { keyFrom, rateLimit } from "@/lib/rate-limit"
import { createUserClient } from "@/lib/supabase/server"

const shareSchema = z.object({
  email: z.string().email(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const rl = rateLimit(keyFrom(request, "/api/cases/share"), 10, 60_000)
    if (!rl.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let parsed
    try {
      parsed = shareSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const email = parsed.email.trim().toLowerCase()
    const { caseId } = await params
    if (!z.string().uuid().safeParse(caseId).success) {
      return NextResponse.json({ error: "Invalid case id" }, { status: 400 })
    }

    const supabase = await createUserClient()
    const { data: invitationRows, error: inviteError } = await supabase.rpc("create_case_invitation", {
      p_case_id: caseId,
      p_invitee_email: email,
      p_role: "defendant",
      p_message: null,
    })

    if (inviteError) {
      const status = inviteError.code === "23505" ? 409 : inviteError.code === "42501" ? 403 : 500
      return NextResponse.json(
        { error: status === 409 ? "Invitation already pending" : status === 403 ? "Insufficient permissions" : "Failed to create invitation" },
        { status },
      )
    }

    const invitation = invitationRows?.[0]
    if (!invitation) {
      return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 })
    }

    const invitationToken = invitation.invitation_token

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    const normalizedAppUrl = appUrl
      ? appUrl.startsWith("http") ? appUrl : `https://${appUrl}`
      : "https://guidebuoyaisg.onrender.com"
    const shareLink = `${normalizedAppUrl}/invite/${invitationToken}`

    return NextResponse.json({ success: true, message: "Invitation created", shareLink })
  } catch (error) {
    console.error("[v0] Share case error:", error)
    return NextResponse.json({ error: "Failed to share case" }, { status: 500 })
  }
}
