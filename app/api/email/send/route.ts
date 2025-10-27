import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { EMAIL_FROM } from "@/lib/email-config"
import { sendMail } from "@/lib/mail"
import { createClient } from "@/lib/supabase/server"
import { rateLimit, keyFrom } from "@/lib/rate-limit"

const emailSendSchema = z.object({
  to: z.string().email("Recipient email must be valid"),
  subject: z.string().min(1, "Subject is required").max(200),
  html: z.string().min(1, "Email body is required"),
  from: z.string().email().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(keyFrom(request, "/api/email/send"), 10, 60_000)
    if (!rl.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
    }

    // Require an authenticated user to avoid exposing an open email relay
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
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

    const { to, subject, html, from } = parsed

    const info = await sendMail({ from: from || EMAIL_FROM, to, subject, html })
    return NextResponse.json({ success: true, messageId: info.messageId })
  } catch (err) {
    console.error("[email/send] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
