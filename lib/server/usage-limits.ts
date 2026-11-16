// Limits on everything that makes a model call (cost-controls spec §5 B1/B2, approved by Elena 8 Nov 2026). Per-account
// limits are counted in the database, so they survive deploys and hold across instances; per-IP limits are in memory
// (one web instance). Every number can be raised per environment with a USAGE_LIMIT_* variable; defaults are the spec's.
import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { keyFrom, rateLimit } from "@/lib/rate-limit"
import { createServiceClient } from "@/lib/supabase/service"

function limit(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export const USAGE_LIMITS = {
  get casesPerAccountPerDay() { return limit("USAGE_LIMIT_CASES_PER_ACCOUNT_PER_DAY", 5) },
  get evaluationsPerCasePerDay() { return limit("USAGE_LIMIT_EVALUATIONS_PER_CASE_PER_DAY", 3) },
  get documentUploadsPerAccountPerDay() { return limit("USAGE_LIMIT_UPLOADS_PER_ACCOUNT_PER_DAY", 20) },
  get modelRequestsPerIpPerHour() { return limit("USAGE_LIMIT_MODEL_REQUESTS_PER_IP_PER_HOUR", 30) },
  // Tightened 9 Nov (Elena): 8 an hour and 20 a day per address before sign-in. One journey makes four or five calls.
  get preSignInRequestsPerIpPerHour() { return limit("USAGE_LIMIT_PRE_SIGN_IN_REQUESTS_PER_IP_PER_HOUR", 8) },
  get preSignInRequestsPerIpPerDay() { return limit("USAGE_LIMIT_PRE_SIGN_IN_REQUESTS_PER_IP_PER_DAY", 20) },
}

/** Voice notes are transcribed only up to this size (about 3 minutes of compressed speech). */
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024

export const LIMIT_MESSAGE = "You've reached today's limit. Please try again tomorrow, or email info@guidebuoyai.sg."
export const HOURLY_LIMIT_MESSAGE = "You've reached the limit for now. Please try again in an hour, or email info@guidebuoyai.sg."

export function limitResponse(message = LIMIT_MESSAGE) {
  // Every limit refusal leaves a line in the logs (cutover checklist, week one: R-02).
  logger.warn("request refused", { reason: "usage_limit", window: message === HOURLY_LIMIT_MESSAGE ? "hour" : "day", status: 429 })
  return NextResponse.json({ error: message, reason: "usage_limit" }, { status: 429 })
}

// Approved test identities on staging only (the seeded fixture profiles), so repeated release runs are not limited.
function exempt(profileId: string): boolean {
  return (process.env.USAGE_LIMIT_EXEMPT_PROFILE_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(profileId)
}

const DAY_MS = 24 * 60 * 60_000
const since = () => new Date(Date.now() - DAY_MS).toISOString()

// A failed count lets the request through: a metering outage must not lock people out.
async function countOrZero(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count, error } = await query
    return error ? 0 : count ?? 0
  } catch {
    return 0
  }
}

export async function overCaseLimit(profileId: string): Promise<boolean> {
  if (exempt(profileId)) return false
  const n = await countOrZero(
    createServiceClient().from("cases").select("id", { count: "exact", head: true }).eq("user_id", profileId).gte("created_at", since()),
  )
  return n >= USAGE_LIMITS.casesPerAccountPerDay
}

export async function overUploadLimit(profileId: string): Promise<boolean> {
  if (exempt(profileId)) return false
  const n = await countOrZero(
    createServiceClient().from("evidence").select("id", { count: "exact", head: true }).eq("user_id", profileId).gte("uploaded_at", since()),
  )
  return n >= USAGE_LIMITS.documentUploadsPerAccountPerDay
}

/** Free evaluations generated for this case in the last 24 hours (the summary review rows, one per generation). */
export async function overEvaluationLimit(caseId: string, profileId: string): Promise<boolean> {
  if (exempt(profileId)) return false
  const n = await countOrZero(
    createServiceClient()
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .in("event_name", ["free_evaluation_summary", "free_evaluation_summary_version"])
      .eq("event_data->>case_id", caseId)
      .gte("created_at", since()),
  )
  return n >= USAGE_LIMITS.evaluationsPerCasePerDay
}

/** Signed-in requests that start model work, per IP per hour. */
export function overIpModelLimit(request: Request): boolean {
  return !rateLimit(keyFrom(request, "model-work"), USAGE_LIMITS.modelRequestsPerIpPerHour, 60 * 60_000).ok
}

/** Model calls reachable before sign-in, per IP per hour and per day, shared by every such route. Returns the message
 * to show when a limit is reached, or null. */
export function preSignInLimit(request: Request): string | null {
  const hour = rateLimit(keyFrom(request, "pre-sign-in-model"), USAGE_LIMITS.preSignInRequestsPerIpPerHour, 60 * 60_000).ok
  const day = rateLimit(keyFrom(request, "pre-sign-in-model-day"), USAGE_LIMITS.preSignInRequestsPerIpPerDay, 24 * 60 * 60_000).ok
  if (!day) return LIMIT_MESSAGE
  if (!hour) return HOURLY_LIMIT_MESSAGE
  return null
}
