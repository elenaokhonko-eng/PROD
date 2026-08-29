import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { trackServerEvent } from "@/lib/analytics/server"
import { ADMIN_EMAIL, EMAIL_FROM } from "@/lib/email-config"
import { sendMail } from "@/lib/mail"

export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    await sendMail({
      from: EMAIL_FROM,
      to: ADMIN_EMAIL,
      subject: "Data deletion request",
      html: `
        <h2>Data deletion request</h2>
        <p>A user has requested review of a data deletion request.</p>
        <p><strong>Clerk user ID:</strong> ${user.userId}</p>
        <p><strong>Supabase profile ID:</strong> ${user.supabaseUuid}</p>
      `,
    })

    await trackServerEvent({
      eventName: "privacy_delete_requested",
      userId: user.supabaseUuid,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[privacy] delete request email failed:", err)
    return NextResponse.json({ error: "Failed to send deletion request" }, { status: 500 })
  }
}
