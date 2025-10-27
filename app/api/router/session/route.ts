import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { nanoid } from "nanoid"
import type { PostgrestError } from "@supabase/supabase-js"
import { createServiceClient } from "@/lib/supabase/service"
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { rateLimit, keyFrom } from "@/lib/rate-limit"

const updatePayloadSchema = z.object({
  session_token: z.string().min(1, "session_token is required"),
  updates: z
    .object({
      dispute_narrative: z.string().max(20_000).nullable().optional(),
      voice_transcript: z.string().max(40_000).nullable().optional(),
      audio_file_url: z.string().max(2_048).nullable().optional(),
      classification_result: z.unknown().optional(),
      clarifying_questions: z.unknown().optional(),
      user_responses: z.unknown().optional(),
      eligibility_assessment: z.unknown().optional(),
      recommended_path: z.enum(["fidrec_eligible", "waitlist", "self_service", "not_eligible"]).nullable().optional(),
      converted_to_case_id: z.string().uuid().nullable().optional(),
      converted_to_user_id: z.string().uuid().nullable().optional(),
      converted_at: z.string().datetime().nullable().optional(),
      expires_at: z.string().datetime().optional(),
    })
    .superRefine((value, ctx) => {
      if (Object.keys(value).length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "updates cannot be empty" })
      }
    }),
})

export async function POST(request: NextRequest) {
  const rl = rateLimit(keyFrom(request, "/api/router/session/create"), 10, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  const supabase = createServiceClient()
  const sessionToken = `router_${Date.now()}_${nanoid(12)}`
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  const userAgent = request.headers.get("user-agent") ?? null

  const { data, error } = await supabase
    .from("router_sessions")
    .insert({
      session_token: sessionToken,
      ip_address: ip,
      user_agent: userAgent,
    })
    .select()
    .single()

  if (error) {
    console.error("[router/session] create error:", error)
    return NextResponse.json({ error: "Failed to create router session" }, { status: 500 })
  }

  return NextResponse.json({ session: data })
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")
  const convertedFor = request.nextUrl.searchParams.get("convertedFor")

  if (!token && !convertedFor) {
    return NextResponse.json({ error: "token or convertedFor query parameter is required" }, { status: 400 })
  }

  const supabase = createServiceClient()
  type RouterSessionRow = Record<string, unknown>
  let session: RouterSessionRow | null = null
  let fetchError: PostgrestError | null = null

  if (token) {
    const result = await supabase
      .from("router_sessions")
      .select("*")
      .eq("session_token", token)
      .maybeSingle()
    session = (result.data as RouterSessionRow | null) ?? null
    fetchError = result.error
  } else if (convertedFor) {
    const authClient = await createServerSupabase()
    const {
      data: { user },
    } = await authClient.auth.getUser()
    if (!user || user.id !== convertedFor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const result = await supabase
      .from("router_sessions")
      .select("*")
      .eq("converted_to_user_id", convertedFor)
      .order("converted_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    session = (result.data as RouterSessionRow | null) ?? null
    fetchError = result.error
  }

  if (fetchError) {
    console.error("[router/session] fetch error:", fetchError)
    return NextResponse.json({ error: "Failed to fetch router session" }, { status: 500 })
  }

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  return NextResponse.json({ session })
}

export async function PATCH(request: NextRequest) {
  const rl = rateLimit(keyFrom(request, "/api/router/session/update"), 30, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  let parsed
  try {
    parsed = updatePayloadSchema.parse(await request.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { session_token, updates } = parsed

  console.log(
    `[Router Session Update] Attempting PATCH for sessionToken: ${session_token}, converting to userId: ${
      updates.converted_to_user_id ?? "n/a"
    }`,
  )

  try {
    const { data, error } = await supabase
      .from("router_sessions")
      .update(updates)
      .eq("session_token", session_token)
      .select()
      .single()

    if (error) {
      throw error
    }

    console.log(
      `[Router Session Update] Update successful for sessionToken: ${session_token}, userId: ${
        updates.converted_to_user_id ?? "n/a"
      }. Result:`,
      data,
    )

    return NextResponse.json({ session: data })
  } catch (dbError) {
    console.error(
      `[Router Session Update] Update failed for sessionToken: ${session_token}, userId: ${
        updates.converted_to_user_id ?? "n/a"
      }:`,
      dbError,
    )
    return NextResponse.json({ error: "Failed to update router session" }, { status: 500 })
  }
}
