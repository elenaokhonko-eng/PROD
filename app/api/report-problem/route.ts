import { type NextRequest, NextResponse } from "next/server"
import { clerkClient } from "@clerk/nextjs/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth"
import { sendMail } from "@/lib/mail"
import { keyFrom, rateLimit } from "@/lib/rate-limit"
import { buildReport, REPORT_EMAIL, REPORT_SUBJECT } from "@/lib/report-problem"

// "Report a problem" sends the report to info@ from the server, so the person needs no email app (Elena, 8 Nov).
// Signed-in users only, rate-limited, and the recipient is fixed: this is not a general email relay.
const reportSchema = z.object({
  description: z.string().max(2000),
  pathname: z.string().max(300),
  time: z.string().max(60),
  userAgent: z.string().max(400),
  problem: z
    .object({ code: z.string().max(80), details: z.array(z.string().max(200)).max(10), at: z.string().max(40) })
    .nullable(),
})

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rl = rateLimit(keyFrom(request, "/api/report-problem"), 5, 10 * 60_000)
  if (!rl.ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })

  const parsed = reportSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })

  let account: string | null = null
  try {
    const clerkUser = await (await clerkClient()).users.getUser(user.userId)
    account = clerkUser.primaryEmailAddress?.emailAddress ?? null
  } catch {
    // The report is still useful without the reply address.
  }

  const { description, pathname, time, userAgent, problem } = parsed.data
  const report = buildReport({
    description: description ?? "",
    pathname: pathname ?? "",
    time: time ?? "",
    userAgent: userAgent ?? "",
    problem: problem ? { code: problem.code ?? "", details: problem.details ?? [], at: problem.at ?? "" } : null,
    account,
  })
  try {
    await sendMail({
      to: REPORT_EMAIL,
      subject: REPORT_SUBJECT,
      html: `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(report)}</pre>`,
      replyTo: account ?? undefined,
    })
  } catch {
    return NextResponse.json({ error: "The report could not be sent" }, { status: 502 })
  }
  return NextResponse.json({ sent: true })
}
