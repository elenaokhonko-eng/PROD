import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { EMAIL_FROM } from "@/lib/email-config"
import { WelcomeEmail } from "@/lib/email-templates"
import { sendMail } from "@/lib/mail"
import { render } from "@react-email/render"

const welcomeSchema = z.object({
  userEmail: z.string().email(),
  userName: z.string().max(120).optional(),
  hasRouterSession: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  try {
    let parsed
    try {
      parsed = welcomeSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { userEmail, userName, hasRouterSession = false } = parsed

    const html = await render(WelcomeEmail({ userName, userEmail, hasRouterSession }))
    const info = await sendMail({ from: EMAIL_FROM, to: userEmail, subject: "Welcome to GuideBuoy AI - Let's Get Started", html })
    return NextResponse.json({ success: true, messageId: info.messageId })
  } catch (error) {
    console.error("[v0] Welcome email error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
