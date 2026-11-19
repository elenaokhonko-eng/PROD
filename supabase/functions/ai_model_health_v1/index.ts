// supabase/functions/ai_model_health_v1/index.ts
//
// Purpose: confirm each AI model the Edge functions are configured with still answers with the Edge keys.
// Called by the web app's model health check (lib/server/ai/model-health.ts) at startup, hourly and from
// /api/health/release. Returns model IDs and HTTP statuses only.
//
// Auth: admin-signed HMAC envelope (EDGE_PROXY_HMAC_SECRET, 5-minute window). It reads and writes no data, so it
// deliberately doesn't consume a database nonce. A replay can only repeat the probe, and the result is reused for
// 60 seconds (concurrent requests share one probe) so replays can't run up model calls.
//
// EDGE_MODELS must match the defaults in each function; tests/contracts/ai-models.test.ts checks that.
import { HarborEdgeAuthError, verifyHarborEdgeRequest } from "../_shared/edge-auth.ts";

type Provider = "gemini" | "openai";
type EdgeModel = { use: string; provider: Provider; env: string | null; fallback: string; key: string };

export const EDGE_MODELS: EdgeModel[] = [
  { use: "evidence_processed_v2", provider: "gemini", env: "EVIDENCE_GEMINI_MODEL", fallback: "gemini-3.8-flash", key: "GEMINI_API_KEY" },
  { use: "run_case_extract_v4", provider: "openai", env: "CASE_EXTRACT_MODEL", fallback: "gpt-6-luna", key: "GuideBuoy_EdgeFunction" },
  { use: "run_case_decision_v1", provider: "openai", env: "CASE_DECISION_MODEL", fallback: "gpt-6-luna", key: "GuideBuoy_EdgeFunction" },
  { use: "run_case_decision_v1 embeddings", provider: "openai", env: null, fallback: "text-embedding-3-small", key: "GuideBuoy_EdgeFunction" },
  { use: "run_report_selfserve_v1", provider: "openai", env: "SELF_SERVE_REPORT_MODEL", fallback: "gpt-6-luna", key: "GuideBuoy_EdgeFunction" },
  { use: "bright-function", provider: "openai", env: "TIER0_MODEL", fallback: "gpt-6-luna", key: "GuideBuoy_EdgeFunction" },
  { use: "bright-function secondary", provider: "openai", env: "TIER0_SECONDARY_MODEL", fallback: "gpt-6.1-terra", key: "GuideBuoy_EdgeFunction" },
  { use: "run_bank_pack_v1", provider: "openai", env: "BANK_PACK_MODEL", fallback: "gpt-6-luna", key: "GuideBuoy_EdgeFunction" },
  { use: "run_bank_pack_v1 secondary", provider: "openai", env: "BANK_PACK_SECONDARY_MODEL", fallback: "gpt-6.1-terra", key: "GuideBuoy_EdgeFunction" },
  { use: "run_fidrec_pack_v1", provider: "openai", env: "FIDREC_PACK_MODEL", fallback: "gpt-6-luna", key: "GuideBuoy_EdgeFunction" },
  { use: "run_fidrec_pack_v1 secondary", provider: "openai", env: "FIDREC_PACK_SECONDARY_MODEL", fallback: "gpt-6.1-terra", key: "GuideBuoy_EdgeFunction" },
  { use: "backfill_embeddings_v1", provider: "openai", env: null, fallback: "text-embedding-3-small", key: "GuideBuoy_EdgeFunction" },
];

const PROBE_TIMEOUT_MS = 15_000;
const RESULT_CACHE_MS = 60_000;

type Check = { use: string; provider: Provider; model: string; status: number | null };
let cached: { checks: Check[]; at: number } | null = null;
let inFlight: Promise<Check[]> | null = null;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function statusOf(url: string, init: RequestInit): Promise<number | null> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}

function probe(provider: Provider, apiKey: string, model: string) {
  if (provider === "gemini") {
    return statusOf(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: "ok" }] }], generationConfig: { maxOutputTokens: 1 } }),
    });
  }
  return statusOf(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

function runChecks(): Promise<Check[]> {
  return Promise.all(
    EDGE_MODELS.map(async ({ use, provider, env, fallback, key }) => {
      const model = (env ? Deno.env.get(env)?.trim() : "") || fallback;
      const apiKey = Deno.env.get(key)?.trim() ?? "";
      const status = apiKey ? await probe(provider, apiKey, model) : null;
      return { use, provider, model, status };
    }),
  );
}

async function currentChecks(): Promise<Check[]> {
  if (cached && Date.now() - cached.at < RESULT_CACHE_MS) return cached.checks;
  inFlight ??= runChecks()
    .then((checks) => {
      cached = { checks, at: Date.now() };
      return checks;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

Deno.serve(async (req) => {
  try {
    await verifyHarborEdgeRequest(req, "ai_model_health_v1");
    return jsonResponse({ checks: await currentChecks() });
  } catch (error) {
    if (error instanceof HarborEdgeAuthError) return jsonResponse({ error: error.message }, error.status);
    return jsonResponse({ error: "Model health check failed" }, 500);
  }
});
