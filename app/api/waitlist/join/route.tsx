import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { EMAIL_FROM, ADMIN_EMAIL } from "@/lib/email-config"
import { sendMail } from "@/lib/mail"
import { render } from "@react-email/render"
import { WaitlistConfirmationEmail } from "@/lib/email-templates"

export async function POST(request: NextRequest) {
  try {
    const { email, name, first_name, last_name, source = "direct" } = await request.json()

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    const supabase = await createClient()

    // Add to waitlist
    const displayName = name || [first_name, last_name].filter(Boolean).join(" ") || null

    const { error: insertError } = await supabase
      .from("waitlist")
      .insert({ email, name: displayName, first_name, last_name, source })
      .select()
      .single()

    if (insertError && !insertError.message.includes("duplicate")) {
      throw insertError
    }

    // Send confirmation email to user
    try {
      const html = await render(WaitlistConfirmationEmail({ userName: displayName || undefined, userEmail: email, source }))
      await sendMail({ to: email, subject: "You're on the GuideBuoy AI Waitlist!", html, from: EMAIL_FROM })
    } catch (emailError) {
      console.error("[v0] User confirmation email failed:", emailError)
    }

    // Send notification to admin
    try {
      await sendMail({
        from: EMAIL_FROM,
        to: ADMIN_EMAIL,
        subject: "New GuideBuoy AI Waitlist Signup",
        html: `
          <h2>New Waitlist Signup</h2>
          <p><strong>Name:</strong> ${displayName || "Not provided"}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Source:</strong> ${source}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        `,
      })
    } catch (emailError) {
      console.error("[v0] Admin notification email failed:", emailError)
    }

    return NextResponse.json({
      success: true,
      message: "Successfully added to waitlist",
    })
  } catch (error) {
    console.error("[v0] Waitlist API error:", error)
    return NextResponse.json({ error: "Failed to add to waitlist" }, { status: 500 })
  }
}
