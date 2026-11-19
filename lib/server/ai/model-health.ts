import { logger } from "@/lib/logger"
import { ADMIN_EMAIL, EMAIL_FROM } from "@/lib/email-config"
import { sendMail } from "@/lib/mail"
import { postAdminEdgeFunction } from "@/lib/server/edge-proxy"
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
  try {
    const response = await postAdminEdgeFunction(EDGE_MODEL_HEALTH_FUNCTION, { operation: "check" }, "release-health", {
      timeoutMs: PROBE_TIMEOUT_MS + 5_000,
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

// Why a check failed, which decides what the alert asks for. "not-responding" (no answer or a 5xx) is usually a
// short provider outage, as on 17 Nov, when OpenAI answered 504 twice; it says nothing about the key or the model ID.
export type FailureKind = "key-refused" | "model-missing" | "not-responding" | "other"

export function failureKind(status: number | null): FailureKind {
  if (status === null || status >= 500) return "not-responding"
  if (status === 401 || status === 403) return "key-refused"
  if (status === 404) return "model-missing"
  return "other"
}

const RETRY_AFTER_MS = 60_000

// The scheduled checks look again a minute later before alerting on a provider that did not respond, so a passing
// blip sends no email. A missing model or refused key is reported at once.
export async function confirmFailures(
  run: () => Promise<ModelHealth>,
  delayMs = RETRY_AFTER_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ModelHealth> {
  const first = await run()
  if (first.ok || !first.checks.some((check) => !check.ok && failureKind(check.status) === "not-responding")) return first
  await sleep(delayMs)
  return run()
}

const ADVICE: Record<FailureKind, { heading: string; advice: string }> = {
  "key-refused": {
    heading: "The provider refused the deployed key",
    advice: "Check that the key is current and has access to this model. Calls using it will fail until it is fixed.",
  },
  "model-missing": {
    heading: "The model ID is not available to the deployed key",
    advice: "Evidence processing, transcription or report generation will fail until the model setting is changed to an available model ID.",
  },
  "not-responding": {
    heading: "The provider did not answer in time, twice, a minute apart",
    advice: "This is usually a short outage on the provider's side; the key and the model ID were not rejected. The check runs again within the hour. If this alert repeats, check the provider's status page.",
  },
  other: {
    heading: "The provider gave an unexpected answer",
    advice: "Look at the status codes above and the provider's documentation.",
  },
}

// The alert email, grouped by cause.
export function alertEmail(health: ModelHealth, environment: string): { subject: string; html: string } {
  const failing = health.checks.filter((check) => !check.ok)
  const kinds = [...new Set(failing.map((check) => failureKind(check.status)))]
  const onlyNotResponding = kinds.length === 1 && kinds[0] === "not-responding"
  const subject = `GuideBuoy AI ${onlyNotResponding ? "provider not responding" : "model unavailable"} (${environment})`
  const sections = kinds.map((kind) => {
    const items = failing
      .filter((check) => failureKind(check.status) === kind)
      .map((check) => `<li>${check.where} ${check.provider} ${check.model} (${check.use}): HTTP ${check.status ?? "no response"}</li>`)
      .join("")
    return `<p><strong>${ADVICE[kind].heading}:</strong></p><ul>${items}</ul><p>${ADVICE[kind].advice}</p>`
  })
  return { subject, html: sections.join("") }
}

let cached: { health: ModelHealth; expiresAt: number } | null = null
let inFlight: Promise<ModelHealth> | null = null
let lastAlertAt = 0

async function runChecks(): Promise<ModelHealth> {
  const checks = (await Promise.all([appChecks(), edgeChecks()])).flat()
  return { ok: checks.every((check) => check.ok), checks, checkedAt: new Date().toISOString() }
}

// `confirm` (the startup and hourly checks) looks again after a minute before alerting on a provider that did not
// respond; /api/health/release answers at once.
export async function checkModelHealth(options: { force?: boolean; confirm?: boolean } = {}): Promise<ModelHealth> {
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.health
  inFlight ??= (async () => {
    const health = options.confirm ? await confirmFailures(runChecks) : await runChecks()
    const checks = health.checks
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
    const { subject, html } = alertEmail(health, process.env.HARBOR_DEPLOYMENT_ENVIRONMENT ?? "unknown environment")
    await sendMail({ from: EMAIL_FROM, to: ADMIN_EMAIL, subject, html })
  } catch (error) {
    log.error("ai_model_unavailable alert email failed", { message: error instanceof Error ? error.message : String(error) })
  }
}
