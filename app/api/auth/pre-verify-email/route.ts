import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { rateLimit, keyFrom } from "@/lib/rate-limit"
import { buildAppUrl } from "@/lib/url"

const requestSchema = z.object({
  email: z.string().email(),
  source: z.string().optional(),
})

const preferPublicBase = () => {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL,
    "https://guidebuoyai.sg",
    "https://guidebuoyaisg.onrender.com",
  ]

  const isLocalish = (value: string | undefined | null) => {
    if (!value) return true
    try {
      const url = new URL(value.startsWith("http") ? value : `https://${value}`)
      const host = url.hostname.toLowerCase()
      return host === "localhost" || host === "127.0.0.1" || !host.includes(".")
    } catch {
      return true
    }
  }

  for (const candidate of candidates) {
    if (!isLocalish(candidate)) {
      try {
        return new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`).origin
      } catch {
        continue
      }
    }
  }

  return "https://guidebuoyai.sg"
}

export async function POST(request: NextRequest) {
  if (process.env.DISABLE_EMAIL_RATE_LIMIT === "true") {
    // Temporary bypass for testing environments
    console.warn("[Pre Verify Email] Rate limit bypassed via DISABLE_EMAIL_RATE_LIMIT")
  } else {
    const limiter = rateLimit(keyFrom(request, "/api/auth/pre-verify-email"), 50, 300_000)
    if (!limiter.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
    }
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
  const redirectBase = preferPublicBase()
  const emailRedirectTo = new URL(`/auth/callback?next=${encodeURIComponent(nextPath)}`, redirectBase).toString()
  console.log("[Pre Verify Email] Using redirect base:", redirectBase, "full URL:", emailRedirectTo)

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
