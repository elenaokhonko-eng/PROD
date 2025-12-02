import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { rateLimit, keyFrom } from "@/lib/rate-limit"
import { buildAppUrl } from "@/lib/url"

const requestSchema = z.object({
  email: z.string().email(),
  source: z.string().optional(),
})

export async function POST(request: NextRequest) {
  // Allow more verification attempts before throttling: 12 requests per 5 minutes per IP.
  const limiter = rateLimit(keyFrom(request, "/api/auth/pre-verify-email"), 12, 300_000)
  if (!limiter.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  const supabase = await createClient()

  let parsed: z.infer<typeof requestSchema>
  try {
    parsed = requestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const normalizedEmail = parsed.email.trim().toLowerCase()
  const nextParams = new URLSearchParams({ verified: "1", email: normalizedEmail })
  if (parsed.source) {
    nextParams.set("source", parsed.source)
  }
  const nextPath = `/auth/sign-up?${nextParams.toString()}`
  const emailRedirectTo = buildAppUrl(`/auth/callback?next=${encodeURIComponent(nextPath)}`)

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
      emailRedirectTo,
    },
  })

  if (error) {
    console.error("[Pre Verify Email] Failed to send verification link:", error)
    return NextResponse.json({ error: error.message ?? "Unable to send verification link" }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
