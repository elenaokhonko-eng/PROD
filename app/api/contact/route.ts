import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { ADMIN_EMAIL, EMAIL_FROM } from '@/lib/email-config'
import { sendMail } from '@/lib/mail'
import { keyFrom, rateLimit } from '@/lib/rate-limit'

const ContactBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(254),
  message: z.string().trim().min(10).max(2000),
}).strict()

export async function POST(request: NextRequest) {
  const limit = rateLimit(keyFrom(request, '/api/contact'), 5, 60_000)
  if (!limit.ok) return NextResponse.json({ error: 'Too many messages. Please try again later.' }, { status: 429 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = ContactBody.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Please provide a name, valid email and message.' }, { status: 400 })

  await sendMail({
    from: EMAIL_FROM,
    to: ADMIN_EMAIL,
    subject: 'New GuideBuoy contact message',
    html: `<p><strong>Name:</strong> ${escapeHtml(parsed.data.name)}</p><p><strong>Email:</strong> ${escapeHtml(parsed.data.email)}</p><p>${escapeHtml(parsed.data.message)}</p>`,
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character)
}
