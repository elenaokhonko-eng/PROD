// The free-evaluation summary is the only model-written section; every other section is built from the confirmed
// facts. A checker rejection must never end in "failed" (free-evaluation hardening, 8 Nov), so the summary comes from
// a repair ladder:
//   1. generate; repair in code what can be repaired exactly (qualifiers on document-less or unsure facts);
//   2. any remaining violation, soft or hard: regenerate once with the violations fed back, repair again;
//   3. still failing, or the provider failed after its retry: a fixed-wording "summary version" of the confirmed
//      facts, with no model text. The job is logged for review with IDs and check names only.
// Only infrastructure errors (database, auth) still fail the request.

import { factLabel, formatFactValue, harmoniseDates } from "./display.ts";
import { backoffMs, openAiUsage, type TokenUsage } from "../model-usage.ts";
import type { FactKey } from "./keys.ts";
import {
  describeFailures,
  isHardCheck,
  type OutputCheck,
  type OutputFailure,
  qualifyUnsupportedStatements,
  type SnapshotFacts,
  validateOutput,
  type ValidateOptions,
} from "./validate-output.ts";

// "budget": today's model spend reached the daily cap (cost-controls spec §5 B4), so no call is made.
export type ProviderFailureKind = "rate_limited" | "provider_error" | "timeout" | "malformed" | "empty" | "refusal" | "budget";

/** A provider failure that survived its own retry; the ladder answers it with the summary version. */
export class ProviderFailure extends Error {
  constructor(readonly kind: ProviderFailureKind, readonly status: number | null = null, readonly retryAfter: string | null = null) {
    super(`provider ${kind}${status ? ` ${status}` : ""}`);
  }
}

export type SummarySource = "model" | "fallback";

export interface SummaryResult {
  summary: string;
  source: SummarySource;
  /** Model calls made (0-2). */
  attempts: number;
  /** Why the summary version was used: "checks" or a provider failure kind. */
  fallbackReason: "checks" | ProviderFailureKind | null;
  /** Check names that fired on each attempt, for the review log and the corpus measurement. Never the text. */
  firedChecks: OutputCheck[][];
  /** Hard checks still failing on the last model attempt (the text was not shown). */
  hardChecks: OutputCheck[];
}

export interface LadderInput {
  facts: SnapshotFacts;
  options: ValidateOptions;
  /** One model call; `previousFailures` lists the violations of the last attempt. Throws ProviderFailure. */
  generate: (previousFailures: string | null) => Promise<string>;
  /** Clean-up applied to every model summary before it is checked (e.g. banned context phrases). */
  sanitize?: (summary: string) => string;
}

function repair(summary: string, failures: OutputFailure[], facts: SnapshotFacts, options: ValidateOptions): string {
  return failures.some((f) => f.check === "unqualified") ? qualifyUnsupportedStatements(summary, facts, options.documented) : summary;
}

export async function produceSummary({ facts, options, generate, sanitize = (s) => s }: LadderInput): Promise<SummaryResult> {
  const firedChecks: OutputCheck[][] = [];
  let previous: string | null = null;
  let lastFailures: OutputFailure[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let summary: string;
    try {
      summary = sanitize(await generate(previous));
    } catch (error) {
      if (!(error instanceof ProviderFailure)) throw error;
      return fallback(facts, attempt, error.kind, firedChecks, []);
    }
    let failures = validateOutput([summary], facts, options);
    firedChecks.push(failures.map((f) => f.check));
    if (failures.length) {
      summary = repair(summary, failures, facts, options);
      failures = validateOutput([summary], facts, options);
    }
    if (!failures.length) {
      return { summary: harmoniseDates(summary), source: "model", attempts: attempt, fallbackReason: null, firedChecks, hardChecks: [] };
    }
    lastFailures = failures;
    previous = describeFailures(failures);
  }
  const hard = [...new Set(lastFailures.map((f) => f.check).filter(isHardCheck))];
  return fallback(facts, 2, "checks", firedChecks, hard);
}

function fallback(
  facts: SnapshotFacts,
  attempts: number,
  reason: SummaryResult["fallbackReason"],
  firedChecks: OutputCheck[][],
  hardChecks: OutputCheck[],
): SummaryResult {
  return { summary: fallbackSummary(facts), source: "fallback", attempts, fallbackReason: reason, firedChecks, hardChecks };
}

export const FALLBACK_TITLE = "Free evaluation summary (summary version)";
export const FALLBACK_INTRO =
  "This is a summary version: we couldn't write the full summary for your case this time, so here are the facts " +
  "you confirmed, grouped in the order things happened. Nothing has been added to them. The sections below are complete.";

const FALLBACK_GROUPS: Array<{ heading: string; keys: FactKey[] }> = [
  { heading: "How it started", keys: ["scam_type", "phishing_channel", "impersonated_entity_type", "credentials_or_otp_shared"] },
  { heading: "What was lost", keys: ["institution_names", "account_types", "transactions", "total_loss", "amount_recovered_or_offered"] },
  {
    heading: "What has happened since",
    keys: ["date_discovered", "reported_to_bank", "bank_case_reference", "written_complaint_sent", "bank_reply", "reported_to_police", "police_report_number", "fidrec_filed"],
  },
];

/** The summary version: the confirmed facts in fixed wording, with the same qualifiers as "Facts you confirmed". */
export function fallbackSummary(facts: SnapshotFacts): string {
  const blocks = [FALLBACK_INTRO];
  for (const group of FALLBACK_GROUPS) {
    const lines = group.keys.flatMap((key) => {
      const fact = facts[key];
      if (!fact) return [];
      const text =
        fact.label === "not_sure" ? "not sure"
          : fact.label === "not_known" ? "not known"
          : fact.label === "claimant_only" ? `you told us: ${formatFactValue(key, fact.value)} (no document yet)`
          : formatFactValue(key, fact.value);
      return [`- ${factLabel(key)}: ${text}`];
    });
    if (lines.length) blocks.push([group.heading, ...lines].join("\n"));
  }
  return blocks.join("\n\n");
}

export interface ChatSummaryRequest {
  fetch: typeof fetch;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** Epoch ms after which no call is started; each call is also capped at `callTimeoutMs`. */
  deadline: number;
  callTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Output cap (cost-controls spec §5 B5). */
  maxTokens?: number;
  /** Model to switch to on the first 429 instead of waiting (§5 B8). */
  secondaryModel?: string;
  /** Called once per HTTP attempt with tokens and outcome, for metering (§5 B6). Never sees any text. */
  onCall?: (call: SummaryCall) => void | Promise<void>;
}

export interface SummaryCall {
  model: string;
  usage: TokenUsage | null;
  latencyMs: number;
  httpStatus: number | null;
  kind: ProviderFailureKind | "ok";
}

const RETRYABLE: ProviderFailureKind[] = ["rate_limited", "provider_error", "timeout", "malformed", "empty"];

/**
 * One chat-completion call for the summary, retried once on rate limits, 5xx, timeouts and unusable output. A
 * safety refusal is not retried (the same story is refused again): the ladder answers it with the summary version.
 * Errors carry the status and kind only, never the provider's response text.
 */
export async function chatSummary(req: ChatSummaryRequest): Promise<string> {
  const sleep = req.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: ProviderFailure | null = null;
  let model = req.model;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = req.deadline - Date.now();
    if (remaining < 5_000) throw last ?? new ProviderFailure("timeout");
    try {
      return await chatSummaryOnce(req, model, Math.min(req.callTimeoutMs ?? 40_000, remaining));
    } catch (error) {
      if (!(error instanceof ProviderFailure)) throw error;
      last = error;
      if (!RETRYABLE.includes(error.kind) || attempt === 2) throw error;
      // A rate limit on the main model: switch to the secondary model at once rather than wait (§5 B8).
      if (error.kind === "rate_limited" && req.secondaryModel && req.secondaryModel !== model) model = req.secondaryModel;
      else await sleep(backoffMs(attempt, error.retryAfter));
    }
  }
  throw last ?? new ProviderFailure("provider_error");
}

async function chatSummaryOnce(req: ChatSummaryRequest, model: string, timeoutMs: number): Promise<string> {
  const started = Date.now();
  const report = async (kind: SummaryCall["kind"], httpStatus: number | null, usage: TokenUsage | null = null) => {
    try {
      await req.onCall?.({ model, usage, latencyMs: Date.now() - started, httpStatus, kind });
    } catch {
      // Metering never breaks the call.
    }
  };
  try {
    const result = await chatSummaryRequest(req, model, timeoutMs);
    await report("ok", 200, result.usage);
    return result.summary;
  } catch (error) {
    if (error instanceof ProviderFailure) await report(error.kind, error.status, (error as ProviderFailure & { usage?: TokenUsage }).usage ?? null);
    throw error;
  }
}

async function chatSummaryRequest(req: ChatSummaryRequest, model: string, timeoutMs: number): Promise<{ summary: string; usage: TokenUsage }> {
  let resp: Response;
  try {
    resp = await req.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ProviderFailure("timeout");
  }
  if (resp.status === 429) throw new ProviderFailure("rate_limited", 429, resp.headers.get("retry-after"));
  if (!resp.ok) throw new ProviderFailure("provider_error", resp.status);
  let data: { choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }> };
  try {
    data = await resp.json();
  } catch {
    throw new ProviderFailure("malformed", resp.status);
  }
  const usage = openAiUsage(data);
  const fail = (kind: ProviderFailureKind) => Object.assign(new ProviderFailure(kind, resp.status), { usage });
  const choice = data?.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw fail("refusal");
  const content = choice?.message?.content;
  if (!content || !content.trim()) throw fail("empty");
  // A cut-off answer ("length") is not valid JSON; the parse below rejects it as malformed.
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw fail("malformed");
  }
  const summary = (parsed as { summary?: unknown })?.summary;
  if (typeof summary !== "string" || !summary.trim()) throw fail("empty");
  return { summary, usage };
}
