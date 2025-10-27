import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { nanoid } from "nanoid"

const shareSchema = z.object({
  email: z.string().email(),
})

export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

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

    const { email } = parsed
    const { caseId } = params

    // Ensure user has permission to invite
    const { data: caseData } = await supabase.from("cases").select("owner_user_id").eq("id", caseId).single()
    const isOwner = caseData?.owner_user_id === user.id

    let canInvite = isOwner
    if (!canInvite) {
      const { data: collab } = await supabase
        .from("case_collaborators")
        .select("can_invite")
        .eq("case_id", caseId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single()
      canInvite = Boolean(collab?.can_invite)
    }

    if (!canInvite) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    // Prevent duplicate pending invitations
    const { data: existingInvite } = await supabase
      .from("invitations")
      .select("id")
      .eq("case_id", caseId)
      .eq("invitee_email", email)
      .eq("status", "pending")
      .maybeSingle()

    if (existingInvite) {
      return NextResponse.json({ error: "Invitation already pending" }, { status: 400 })
    }

    // Generate invitation token
    const invitation_token = nanoid(32)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    // Create read-only invitation (can_view true only)
    const { data: invitation, error: inviteError } = await supabase
      .from("invitations")
      .insert({
        case_id: caseId,
        inviter_user_id: user.id,
        invitee_email: email,
        role: "defendant",
        invitation_token,
        expires_at: expiresAt.toISOString(),
        status: "pending",
      })
      .select()
      .single()

    if (inviteError || !invitation) {
      return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    const normalizedAppUrl = appUrl
      ? appUrl.startsWith("http") ? appUrl : `https://${appUrl}`
      : "https://guidebuoyaisg.onrender.com"
    const shareLink = `${normalizedAppUrl}/invite/${invitation_token}`

    return NextResponse.json({ success: true, message: "Invitation created", shareLink })
  } catch (error) {
    console.error("[v0] Share case error:", error)
    return NextResponse.json({ error: "Failed to share case" }, { status: 500 })
  }
}
