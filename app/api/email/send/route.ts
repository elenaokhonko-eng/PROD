import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { EMAIL_FROM } from "@/lib/email-config"
import { sendMail } from "@/lib/mail"
import { getCurrentUser } from "@/lib/auth"
import { rateLimit, keyFrom } from "@/lib/rate-limit"
import { safeErrorText } from "@/lib/server/safe-error"
import { SMTP_TEST_SUBJECT_PREFIX, smtpTestRecipients } from "@/lib/server/smtp-test"

// SMTP self-test only (Elena, 9 Nov): signed-in users could otherwise send any HTML, as anyone, to anyone, from our
// domain. Mail goes only to the configured test and admin recipients, always from EMAIL_FROM, with a fixed prefix.
const emailSendSchema = z.object({
  to: z.string().email("Recipient email must be valid"),
  subject: z.string().min(1, "Subject is required").max(200),
  html: z.string().min(1, "Email body is required").max(5_000),
})

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(keyFrom(request, "/api/email/send"), 10, 60_000)
    if (!rl.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
    }

    // Require an authenticated user to avoid exposing an open email relay
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let parsed
    try {
      parsed = emailSendSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { to, subject, html } = parsed
    if (!smtpTestRecipients().includes(to.trim().toLowerCase())) {
      return NextResponse.json({ error: "This address cannot receive test email" }, { status: 403 })
    }

    const info = await sendMail({ from: EMAIL_FROM, to, subject: `${SMTP_TEST_SUBJECT_PREFIX}${subject}`, html })
    return NextResponse.json({ success: true, messageId: info.messageId })
  } catch (err) {
    console.error("[email/send] error:", safeErrorText(err))
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
