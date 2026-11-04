import { logger } from "@/lib/logger"
import { ADMIN_EMAIL, EMAIL_FROM } from "@/lib/email-config"
import { sendMail } from "@/lib/mail"
import { signAdminEdgeRequest } from "@/lib/server/edge-request-signing"
import { EMBEDDING_MODEL } from "@/lib/server/ai/generate-embedding"
import { getOpenAiModel, sanitizeOpenAiApiKey } from "@/lib/server/ai/generate-json"
import { getGeminiModel } from "@/lib/server/ai/models"

// Confirms that every configured AI model ID still answers with the deployed keys. Providers retire model IDs
// for new keys without warning (D3, November 2026: every evidence upload failed on a 404), so this runs at
// startup, hourly, and in /api/health/release, and a failure is logged, emailed and fails the release check.

const log = logger.withContext({ module: "ai-model-health" })

export type ModelProvider = "gemini" | "openai"

export type ModelCheck = {
  where: "app" | "edge"
  use: string
  provider: ModelProvider
  model: string
  ok: boolean
  status: number | null
}

export type ModelHealth = { ok: boolean; checks: ModelCheck[]; checkedAt: string }

const PROBE_TIMEOUT_MS = 15_000
const HEALTHY_CACHE_MS = 10 * 60_000
const UNHEALTHY_CACHE_MS = 60_000
const ALERT_INTERVAL_MS = 6 * 60 * 60_000
export const EDGE_MODEL_HEALTH_FUNCTION = "ai_model_health_v1"

// 429 proves the model exists for this key; only a missing model, rejected key or outage counts as unavailable.
export function isReachable(status: number | null): boolean {
  return status !== null && ((status >= 200 && status < 300) || status === 429)
}

async function statusOf(url: string, init: RequestInit): Promise<number | null> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    await response.body?.cancel()
    return response.status
  } catch {
    return null
  }
}

// Model metadata can still be listed after an ID is retired for new keys, so Gemini is probed with a one-token
// generation, the call the app actually makes.
export function probeGemini(apiKey: string, model: string) {
  return statusOf(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: "ok" }] }], generationConfig: { maxOutputTokens: 1 } }),
  })
}

// OpenAI's model endpoint answers 404 for an ID this key's project can't use (including a wrong-case ID).
export function probeOpenAi(apiKey: string, model: string) {
  return statusOf(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  })
}

async function appChecks(): Promise<ModelCheck[]> {
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ?? ""
  const openAiKey = sanitizeOpenAiApiKey(process.env.OPENAI_API_KEY)
  const wanted = [
    { use: "router, transcription", provider: "gemini" as const, model: getGeminiModel(), key: geminiKey },
    { use: "tier 2 JSON", provider: "openai" as const, model: getOpenAiModel(), key: openAiKey },
    { use: "embeddings", provider: "openai" as const, model: EMBEDDING_MODEL, key: openAiKey },
  ]
  return Promise.all(
    wanted.map(async ({ key, ...check }) => {
      const status = key ? await (check.provider === "gemini" ? probeGemini : probeOpenAi)(key, check.model) : null
      return { where: "app" as const, ...check, ok: isReachable(status), status }
    }),
  )
}

// The Edge functions hold their own provider keys, so their models are probed from inside Supabase.
async function edgeChecks(): Promise<ModelCheck[]> {
  const failed = (status: number | null): ModelCheck[] => [
    { where: "edge", use: EDGE_MODEL_HEALTH_FUNCTION, provider: "openai", model: "(edge model check)", ok: false, status },
  ]
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return failed(null)
  try {
    const bodyText = JSON.stringify({ operation: "check" })
    const response = await fetch(`${supabaseUrl}/functions/v1/${EDGE_MODEL_HEALTH_FUNCTION}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        ...signAdminEdgeRequest(EDGE_MODEL_HEALTH_FUNCTION, bodyText, "release-health"),
      },
      body: bodyText,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS + 5_000),
    })
    const body = (await response.json().catch(() => null)) as { checks?: unknown } | null
    if (!Array.isArray(body?.checks)) return failed(response.status)
    return body.checks.map((check: Partial<ModelCheck>) => ({
      where: "edge" as const,
      use: String(check.use ?? ""),
      provider: check.provider === "gemini" ? "gemini" : "openai",
      model: String(check.model ?? ""),
      status: typeof check.status === "number" ? check.status : null,
      ok: isReachable(typeof check.status === "number" ? check.status : null),
    }))
  } catch {
    return failed(null)
  }
}

export function describeFailures(health: ModelHealth): string {
  return health.checks
    .filter((check) => !check.ok)
    .map((check) => `${check.where} ${check.provider} ${check.model} (${check.use}): HTTP ${check.status ?? "no response"}`)
    .join("; ")
}

let cached: { health: ModelHealth; expiresAt: number } | null = null
let inFlight: Promise<ModelHealth> | null = null
let lastAlertAt = 0

export async function checkModelHealth(options: { force?: boolean } = {}): Promise<ModelHealth> {
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.health
  inFlight ??= (async () => {
    const checks = (await Promise.all([appChecks(), edgeChecks()])).flat()
    const health = { ok: checks.every((check) => check.ok), checks, checkedAt: new Date().toISOString() }
    cached = { health, expiresAt: Date.now() + (health.ok ? HEALTHY_CACHE_MS : UNHEALTHY_CACHE_MS) }
    if (health.ok) {
      log.info("AI models available", { models: checks.map((check) => `${check.where}:${check.model}`) })
    } else {
      await reportUnavailable(health)
    }
    return health
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function reportUnavailable(health: ModelHealth) {
  const failures = describeFailures(health)
  log.error("ai_model_unavailable", { failures, environment: process.env.HARBOR_DEPLOYMENT_ENVIRONMENT })
  if (Date.now() - lastAlertAt < ALERT_INTERVAL_MS) return
  lastAlertAt = Date.now()
  try {
    await sendMail({
      from: EMAIL_FROM,
      to: ADMIN_EMAIL,
      subject: `GuideBuoy AI model unavailable (${process.env.HARBOR_DEPLOYMENT_ENVIRONMENT ?? "unknown environment"})`,
      html: `<p>These configured AI models did not respond with the deployed keys:</p><ul>${failures
        .split("; ")
        .map((failure) => `<li>${failure}</li>`)
        .join("")}</ul><p>Evidence processing, transcription or report generation will fail until the model setting is changed to an available model ID.</p>`,
    })
  } catch (error) {
    log.error("ai_model_unavailable alert email failed", { message: error instanceof Error ? error.message : String(error) })
  }
}
