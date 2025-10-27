import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createServiceClient } from "@/lib/supabase/service"
import { EMAIL_FROM, ADMIN_EMAIL } from "@/lib/email-config"
import { sendMail } from "@/lib/mail"
import { render } from "@react-email/render"
import { WaitlistConfirmationEmail } from "@/lib/email-templates"
import { rateLimit, keyFrom } from "@/lib/rate-limit"

const waitlistSchema = z.object({
  email: z.string().email(),
  name: z.string().max(120).optional(),
  first_name: z.string().max(120).optional(),
  last_name: z.string().max(120).optional(),
  source: z.string().max(120).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(keyFrom(request, "/api/waitlist/join"), 8, 60_000)
    if (!rl.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
    }

    let parsed
    try {
      parsed = waitlistSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { email, name, first_name, last_name } = parsed

    const supabase = createServiceClient()

    // Check if email already exists
    const { data: existingEntry, error: selectError } = await supabase
      .from("waitlist")
      .select("id, email, name, source")
      .eq("email", email)
      .maybeSingle()

    if (selectError && selectError.code !== "PGRST116") {
      console.error("[waitlist] Select error:", selectError)
      return NextResponse.json({ error: "Failed to add to waitlist" }, { status: 500 })
    }

    const displayName = name || [first_name, last_name].filter(Boolean).join(" ") || null
    const resolvedSource = parsed.source ?? existingEntry?.source ?? "direct"

    let waitlistRecord = existingEntry

    if (!existingEntry) {
      // Add to waitlist
      const insertPayload: { email: string; name: string | null; source: string } = {
        email,
        name: displayName,
        source: resolvedSource,
      }

      const { data: insertedData, error: insertError } = await supabase
        .from("waitlist")
        .insert(insertPayload)
        .select()
        .single()

      if (insertError) {
        if (insertError.code === "23505") {
          // race condition duplicate, treat as existing
          console.warn("[waitlist] Duplicate insert detected, treating as already joined:", email)
          const { data: duplicateEntry } = await supabase
            .from("waitlist")
            .select("id, email, name, source")
            .eq("email", email)
            .maybeSingle()
          waitlistRecord = duplicateEntry ?? waitlistRecord
        } else {
          console.error("[waitlist] Insert error:", insertError)
          return NextResponse.json({ error: "Failed to add to waitlist" }, { status: 500 })
        }
      } else {
        waitlistRecord = insertedData
      }
    } else {
      console.log(`[waitlist] Email ${email} already on waitlist.`)
    }

    // Send confirmation email to user
    try {
      const html = await render(
        WaitlistConfirmationEmail({
          userName: waitlistRecord?.name || displayName || existingEntry?.name || undefined,
          userEmail: email,
          source: resolvedSource,
        }),
      )
      await sendMail({ to: email, subject: "You're on the GuideBuoy AI Waitlist!", html, from: EMAIL_FROM })
    } catch (emailError) {
      console.error("[v0] User confirmation email failed:", emailError)
    }

    // Send notification to admin only for new signups
    if (!existingEntry && waitlistRecord) {
      try {
        await sendMail({
          from: EMAIL_FROM,
          to: ADMIN_EMAIL,
          subject: "New GuideBuoy AI Waitlist Signup",
          html: `
            <h2>New Waitlist Signup</h2>
            <p><strong>Name:</strong> ${waitlistRecord.name || displayName || "Not provided"}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Source:</strong> ${resolvedSource}</p>
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          `,
        })
      } catch (emailError) {
        console.error("[v0] Admin notification email failed:", emailError)
      }
    }

    return NextResponse.json({
      success: true,
      alreadyJoined: Boolean(existingEntry),
      message: existingEntry ? "Already on waitlist" : "Successfully added to waitlist",
    })
  } catch (error) {
    console.error("[v0] Waitlist API error:", error)
    return NextResponse.json({ error: "Failed to add to waitlist" }, { status: 500 })
  }
}
