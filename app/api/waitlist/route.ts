import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { createServiceClient } from "@/lib/supabase/service"

export const dynamic = "force-dynamic"

// "Email me when it's available" for the paid packs during stage 1. Signed-in users only; the address is the one on
// their account, never one typed in. Writes go through the service role to the existing public.waitlist table,
// which has one row per email, so several products share the row's source list.
const PRODUCTS = new Set(["bank_pack", "fidrec_pack"])

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!rateLimit(`waitlist:${user.supabaseUuid}`, 10, 60_000).ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = (await request.json().catch(() => null)) as { product?: unknown } | null
  const product = typeof body?.product === "string" && PRODUCTS.has(body.product) ? body.product : null
  if (!product) return NextResponse.json({ error: "product must be bank_pack or fidrec_pack" }, { status: 400 })

  const service = createServiceClient()
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("email")
    .eq("id", user.supabaseUuid)
    .maybeSingle()
  const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : ""
  if (profileError || !email) return NextResponse.json({ error: "No email on your account" }, { status: 409 })

  const { data: existing, error: existingError } = await service
    .from("waitlist")
    .select("id, source")
    .eq("email", email)
    .maybeSingle()
  if (existingError) return NextResponse.json({ error: "Failed to save" }, { status: 500 })

  const tag = `stage2:${product}`
  if (existing) {
    const sources = new Set(String(existing.source ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    if (!sources.has(tag)) {
      sources.add(tag)
      const { error } = await service.from("waitlist").update({ source: [...sources].join(",") }).eq("id", existing.id)
      if (error) return NextResponse.json({ error: "Failed to save" }, { status: 500 })
    }
  } else {
    const { error } = await service.from("waitlist").insert({ email, source: tag })
    if (error) return NextResponse.json({ error: "Failed to save" }, { status: 500 })
  }
  return NextResponse.json({ ok: true, email })
}
