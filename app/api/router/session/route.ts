import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { nanoid } from "nanoid"
import type { PostgrestError } from "@supabase/supabase-js"
import { getCurrentUser } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/service"
import { rateLimit, keyFrom } from "@/lib/rate-limit"

const PUBLIC_SESSION_COLUMNS = [
  "id",
  "session_token",
  "dispute_narrative",
  "voice_transcript",
  "audio_file_url",
  "classification_result",
  "clarifying_questions",
  "user_responses",
  "eligibility_assessment",
  "recommended_path",
  "converted_to_case_id",
  "converted_at",
  "created_at",
  "expires_at",
  "status",
].join(", ")

const INTERNAL_SESSION_COLUMNS = `${PUBLIC_SESSION_COLUMNS}, converted_to_user_id`

type RouterSessionRow = Record<string, unknown>

function publicSession(row: unknown): RouterSessionRow {
  const { converted_to_user_id: _ownerId, ...safeRow } = row as RouterSessionRow
  return safeRow
}

const createPayloadSchema = z
  .object({
    intent: z.string().uuid(),
  })
  .strict()

const updatePayloadSchema = z
  .object({
    session_token: z.string().min(1, "session_token is required").max(512),
    updates: z
      .object({
        dispute_narrative: z.string().max(20_000).nullable().optional(),
        voice_transcript: z.string().max(40_000).nullable().optional(),
        audio_file_url: z.string().max(2_048).nullable().optional(),
        classification_result: z.unknown().optional(),
        clarifying_questions: z.unknown().optional(),
        user_responses: z.unknown().optional(),
        eligibility_assessment: z.unknown().optional(),
        recommended_path: z
          .enum(["fidrec_eligible", "waitlist", "self_service", "not_eligible"])
          .nullable()
          .optional(),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (Object.keys(value).length === 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "updates cannot be empty" })
        }
      }),
  })
  .strict()

export async function POST(request: NextRequest) {
  const rl = rateLimit(keyFrom(request, "/api/router/session/create"), 10, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  let parsed
  try {
    parsed = createPayloadSchema.parse(await request.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const supabase = createServiceClient()
  const sessionToken = `router_${Date.now()}_${nanoid(12)}`
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  const userAgent = request.headers.get("user-agent") ?? null

  const { data, error } = await supabase
    .from("router_sessions")
    .insert({
      creation_intent: parsed.intent,
      session_token: sessionToken,
      ip_address: ip,
      user_agent: userAgent,
    })
    .select(PUBLIC_SESSION_COLUMNS)
    .single()

  if (!error) return NextResponse.json({ session: publicSession(data as unknown as RouterSessionRow) })

  if (error.code === "23505") {
    const existing = await supabase
      .from("router_sessions")
      .select(PUBLIC_SESSION_COLUMNS)
      .eq("creation_intent", parsed.intent)
      .maybeSingle()
    if (!existing.error && existing.data) {
      return NextResponse.json({ session: publicSession(existing.data as unknown as RouterSessionRow) })
    }
  }

  console.error("[router/session] create error", { code: error.code ?? "unknown" })
  return NextResponse.json({ error: "Failed to create router session" }, { status: 500 })
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")
  const convertedFor = request.nextUrl.searchParams.get("convertedFor")

  if (!token && !convertedFor) {
    return NextResponse.json({ error: "token or convertedFor query parameter is required" }, { status: 400 })
  }
  if (token && convertedFor) {
    return NextResponse.json({ error: "Use either token or convertedFor, not both" }, { status: 400 })
  }

  const supabase = createServiceClient()
  let session: RouterSessionRow | null = null
  let fetchError: PostgrestError | null = null

  if (token) {
    const result = await supabase
      .from("router_sessions")
      .select(INTERNAL_SESSION_COLUMNS)
      .eq("session_token", token)
      .maybeSingle()
      session = (result.data as unknown as RouterSessionRow | null) ?? null
    fetchError = result.error

    if (session && ["CONVERTED", "IMPORTED"].includes(String(session.status))) {
      const user = await getCurrentUser()
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      if (session.converted_to_user_id !== user.supabaseUuid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }
  } else if (convertedFor) {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const result = await supabase
      .from("router_sessions")
      .select(INTERNAL_SESSION_COLUMNS)
      .eq("converted_to_user_id", user.supabaseUuid)
      .order("converted_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    session = (result.data as unknown as RouterSessionRow | null) ?? null
    fetchError = result.error
  }

  if (fetchError) {
    console.error("[router/session] fetch error", { code: fetchError.code ?? "unknown" })
    return NextResponse.json({ error: "Failed to fetch router session" }, { status: 500 })
  }

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  return NextResponse.json({ session: publicSession(session) })
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

  const { data, error } = await supabase
    .from("router_sessions")
    .update(updates)
    .eq("session_token", session_token)
    .eq("status", "ACTIVE")
    .gt("expires_at", new Date().toISOString())
    .select(PUBLIC_SESSION_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error("[router/session] update error", { code: error.code ?? "unknown" })
    return NextResponse.json({ error: "Failed to update router session" }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: "Router session is not active" }, { status: 409 })
  }

  return NextResponse.json({ session: publicSession(data as unknown as RouterSessionRow) })
}
