// Model-call metering and the daily spend breaker (cost-controls spec §5 B4, B6; approved by Elena 8 Nov 2026).
// Shared by the web app, the worker and the Edge Functions: no runtime-specific imports. Every model call records
// one public.model_usage row (tokens, latency, outcome, estimated cost, IDs), never prompt or response text.

/** List prices in US$ per 1M tokens (docs/release/model-call-inventory.md, checked 8 Nov 2026). */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
}

const GEMINI_FLASH_2026: ModelPrice = { input: 0.75, cachedInput: 0.075, output: 3.75 };
// Gemini prices double on 1 January 2027 (inventory).
const GEMINI_FLASH_2027: ModelPrice = { input: 1.5, cachedInput: 0.15, output: 7.5 };

export function priceOf(model: string, at: Date = new Date()): ModelPrice {
  const m = model.toLowerCase();
  if (m.startsWith("gpt-4.1-mini")) return { input: 0.4, cachedInput: 0.1, output: 1.6 };
  if (m.startsWith("gpt-4o-mini")) return { input: 0.15, cachedInput: 0.075, output: 0.6 };
  if (m.startsWith("gpt-4.1")) return { input: 2, cachedInput: 0.5, output: 8 };
  if (m.startsWith("text-embedding-3-small")) return { input: 0.02, cachedInput: 0.02, output: 0 };
  if (m.startsWith("gemini")) return at >= new Date("2027-01-01T00:00:00+08:00") ? GEMINI_FLASH_2027 : GEMINI_FLASH_2026;
  // Unknown model: priced as the most expensive one in use, so the breaker errs on the safe side.
  return { input: 2, cachedInput: 0.5, output: 8 };
}

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens?: number;
  /** Including any reasoning or thinking tokens, which are billed as output. */
  outputTokens: number;
}

export function estimateCostUsd(model: string, usage: TokenUsage, at: Date = new Date()): number {
  const p = priceOf(model, at);
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const cost = ((usage.inputTokens - cached) * p.input + cached * p.cachedInput + usage.outputTokens * p.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Token usage from an OpenAI Chat Completions or Responses body. */
export function openAiUsage(body: unknown): TokenUsage {
  const u = (body as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const details = (u.prompt_tokens_details ?? u.input_tokens_details) as Record<string, unknown> | undefined;
  return {
    inputTokens: num(u.prompt_tokens ?? u.input_tokens),
    cachedInputTokens: num(details?.cached_tokens),
    outputTokens: num(u.completion_tokens ?? u.output_tokens),
  };
}

/** Token usage from a Gemini generateContent body (thinking tokens are billed as output). */
export function geminiUsage(body: unknown): TokenUsage {
  const u = (body as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: num(u.promptTokenCount),
    cachedInputTokens: num(u.cachedContentTokenCount),
    outputTokens: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount),
  };
}

export type UsageCaller = "web" | "worker" | "edge" | "script";
export type UsageOutcome = "ok" | "retry" | "fallback" | "refused" | "error" | "blocked";

export interface UsageRecord {
  caller: UsageCaller;
  purpose: string;
  provider: "openai" | "gemini";
  model: string;
  usage?: TokenUsage;
  latencyMs?: number;
  outcome: UsageOutcome;
  httpStatus?: number | null;
  caseId?: string | null;
  userId?: string | null;
  jobId?: string | null;
}

// The minimal client surface used here, satisfied by supabase-js in both runtimes.
export interface UsageClient {
  from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: { code?: string } | null }> };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined) => (v && UUID.test(v) ? v : null);

export function usageEnvironment(env: Record<string, string | undefined>): "production" | "staging" | "development" | "test" {
  const declared = (env.HARBOR_DEPLOYMENT_ENVIRONMENT ?? env.MODEL_USAGE_ENVIRONMENT ?? "").toLowerCase();
  if (declared === "production" || declared === "staging" || declared === "test") return declared;
  // Edge Functions declare nothing: the project they run in decides (no extra secret needed).
  const url = env.GUIDEBUOY_URL ?? env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url.includes("ottnvtqltxinxasedbjp")) return "production";
  if (url.includes("yqqkkftfddxuxmpxwbcj")) return "staging";
  return "development";
}

/** Records one model call. Never throws: metering must not break the call it measures. */
export async function recordModelUsage(client: UsageClient, environment: string, rec: UsageRecord): Promise<void> {
  try {
    const usage = rec.usage ?? { inputTokens: 0, outputTokens: 0 };
    const { error } = await client.from("model_usage").insert({
      environment,
      caller: rec.caller,
      purpose: rec.purpose.slice(0, 64),
      provider: rec.provider,
      model: rec.model.slice(0, 100),
      input_tokens: Math.max(0, Math.round(usage.inputTokens)),
      cached_input_tokens: Math.max(0, Math.round(usage.cachedInputTokens ?? 0)),
      output_tokens: Math.max(0, Math.round(usage.outputTokens)),
      latency_ms: rec.latencyMs == null ? null : Math.max(0, Math.round(rec.latencyMs)),
      outcome: rec.outcome,
      http_status: rec.httpStatus ?? null,
      estimated_cost_usd: estimateCostUsd(rec.model, usage),
      case_id: uuidOrNull(rec.caseId),
      user_id: uuidOrNull(rec.userId),
      job_id: uuidOrNull(rec.jobId),
    });
    if (error) console.warn(`[model-usage] not recorded: ${error.code ?? "unknown"}`);
  } catch {
    console.warn("[model-usage] not recorded: exception");
  }
}

// Daily circuit breaker (§5 B4): at 80% of the cap a warning, at 100% model calls stop and users get the summary
// version or a calm message, never an error. Cap from MODEL_DAILY_CAP_USD, default and minimum US$20.
export const DAILY_CAP_MIN_USD = 20;
export const DAILY_WARN_RATIO = 0.8;

export function dailyCapUsd(env: Record<string, string | undefined>): number {
  const configured = Number(env.MODEL_DAILY_CAP_USD);
  return Number.isFinite(configured) && configured > 0 ? Math.max(configured, DAILY_CAP_MIN_USD) : DAILY_CAP_MIN_USD;
}

export type BreakerState = { state: "ok" | "warn" | "open"; spentUsd: number; capUsd: number };

export function breakerFor(spentUsd: number, capUsd: number): BreakerState {
  const state = spentUsd >= capUsd ? "open" : spentUsd >= capUsd * DAILY_WARN_RATIO ? "warn" : "ok";
  return { state, spentUsd, capUsd };
}

/** Reads today's spend (Singapore day). If the read fails the breaker stays closed: a metering outage is not a stop. */
export async function dailyBreaker(client: UsageClient, environment: string, env: Record<string, string | undefined>): Promise<BreakerState> {
  const cap = dailyCapUsd(env);
  try {
    const { data, error } = await client.rpc("model_usage_spend_today", { p_environment: environment });
    if (error) return breakerFor(0, cap);
    return breakerFor(Number(data) || 0, cap);
  } catch {
    return breakerFor(0, cap);
  }
}

// Anonymous sub-cap (Elena, 9 Nov): model calls reachable before sign-in may spend at most this share of the daily
// cap, so abuse from rotating addresses can never use up the budget that signed-in people's evaluations need.
export const PRE_SIGN_IN_PURPOSES = ["router_classify", "router_questions", "transcription"] as const;
export const PRE_SIGN_IN_CAP_SHARE = 0.25;

export function preSignInCapUsd(env: Record<string, string | undefined>): number {
  return Math.round(dailyCapUsd(env) * PRE_SIGN_IN_CAP_SHARE * 100) / 100;
}

/** Midnight in Singapore (UTC+8, no daylight saving) as an ISO timestamp: the day the caps count. */
export function singaporeDayStart(now: Date = new Date()): string {
  const day = 24 * 60 * 60_000;
  const offset = 8 * 60 * 60_000;
  return new Date(Math.floor((now.getTime() + offset) / day) * day - offset).toISOString();
}

export class ModelBudgetExceeded extends Error {
  constructor() {
    super("model_budget_exceeded");
  }
}

/** Output caps per call (§5 B5): observed maximum + 30% (inventory). */
export const OUTPUT_CAPS = {
  fact_extraction: 1_100,
  summary: 800,
  case_extraction: 400,
  evidence: 8_192,
  transcription: 2_000,
  router: 1_000,
} as const;
export const GEMINI_THINKING_BUDGET = { evidence: 1_024, router: 256, transcription: 0 } as const;

/** Truncated exponential backoff with full jitter, honouring Retry-After (seconds) when the provider sends one (§5 B8). */
export function backoffMs(attempt: number, retryAfterHeader: string | null, baseMs = 500, maxMs = 8_000): number {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, maxMs);
  return Math.floor(Math.random() * Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1)));
}
