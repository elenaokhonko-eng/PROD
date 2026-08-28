import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"
import { EMAIL_FROM } from "@/lib/email-config"
import { InvitationEmail } from "@/lib/email-templates"
import { sendMail } from "@/lib/mail"
import { render } from "@react-email/render"
import { rateLimit, keyFrom } from "@/lib/rate-limit"
import type { ReactElement } from "react"

const invitationRoles = ["victim", "helper", "lead_victim", "defendant"] as const

const invitationSchema = z.object({
  caseId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(invitationRoles).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(keyFrom(request, "/api/invitations/send"), 10, 60_000)
    if (!rl.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let parsed
    try {
      parsed = invitationSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { caseId, role } = parsed
    const email = parsed.email.trim().toLowerCase()
    const invitationRole = role ?? "helper"
    const supabase = await createUserClient()

    const { data: invitationRows, error: inviteError } = await supabase.rpc("create_case_invitation", {
      p_case_id: caseId,
      p_invitee_email: email,
      p_role: invitationRole,
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

    const [{ data: profile, error: profileError }, { data: caseData, error: caseError }] = await Promise.all([
      supabase.from("profiles").select("full_name, email").eq("id", user.supabaseUuid).single(),
      supabase.from("cases").select("claim_type").eq("id", caseId).single(),
    ])

    if (profileError || caseError || !profile || !caseData) {
      await supabase.rpc("cancel_case_invitation", { p_invitation_id: invitation.invitation_id })
      return NextResponse.json({ error: "Failed to prepare invitation email" }, { status: 500 })
    }

    const invitationToken = invitation.invitation_token
    const userEmail = profile.email

    try {
      const html = await render(InvitationEmail({
        inviterName: profile.full_name || userEmail || "A user",
        inviterEmail: userEmail,
        caseTitle: caseData.claim_type?.replace("_", " ") || "Financial Dispute Case",
        invitationToken,
        role: invitationRole,
      }) as ReactElement)

      await sendMail({
        from: EMAIL_FROM,
        to: email,
        subject: `${profile.full_name || userEmail} invited you to collaborate on a case`,
        html,
      })
    } catch (mailError) {
      const { data: cancelled, error: cancelError } = await supabase.rpc("cancel_case_invitation", {
        p_invitation_id: invitation.invitation_id,
      })
      console.error("[invitations/send] Email delivery failed", {
        mailError,
        invitationCancelled: cancelled === true,
        cancelError,
      })
      return NextResponse.json({ error: "Failed to send invitation" }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      invitation: {
        id: invitation.invitation_id,
        case_id: caseId,
        invitee_email: invitation.normalized_email,
        role: invitation.invitation_role,
        status: "pending",
        expires_at: invitation.invitation_expires_at,
      },
    })
  } catch (error) {
    console.error("[v0] Invitation send error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
