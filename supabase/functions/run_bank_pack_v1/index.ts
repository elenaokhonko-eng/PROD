import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  authorizeHarborEdgeRequest,
  HarborEdgeAuthError,
  verifyHarborEdgeRequest,
} from "../_shared/edge-auth.ts";
import { safeErrorText } from "../_shared/safe-error.ts";
import { OUTPUT_CAPS, recordModelUsage, type UsageClient, usageEnvironment } from "../_shared/model-usage.ts";
import { DEFAULT_OPENAI_MODEL } from "../_shared/openai-params.ts";
import {
  assembleBankPack,
  BANK_PACK_CHECKS,
  bankPackFallback,
  bankPackSystem,
  bankPackTexts,
  buildBankPackInput,
  chatJson,
  documentedFacts,
  type EvidenceFinding,
  mapBankPackProse,
  parseBankPackProse,
  produceChecked,
  type SnapshotFacts,
} from "../_shared/facts/index.ts";

// The bank pack (S$18), generated once the person has paid and confirmed the bank facts (stage2-plan §3a; design
// K1). Called by the case owner through /api/edge/bank-pack, like bright-function. The model writes only the prose;
// everything else comes from the confirmed "bank" snapshot (_shared/facts/bank-pack.ts). Paid packs are exempt from
// the daily model cap (Elena, 13 Nov: the price covers the calls); every call is still metered.

const PROJECT_URL = Deno.env.get("GUIDEBUOY_URL");
const SERVICE_ROLE_KEY = Deno.env.get("GUIDEBUOY_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction");
const BANK_PACK_MODEL = (Deno.env.get("BANK_PACK_MODEL") ?? DEFAULT_OPENAI_MODEL).trim().toLowerCase();
// Used straight away when the main model is rate-limited (cost-controls spec §5 B8).
const BANK_PACK_SECONDARY_MODEL = (Deno.env.get("BANK_PACK_SECONDARY_MODEL") ?? "gpt-6.1-terra").trim().toLowerCase();
const BANK_PACK_BUDGET_MS = 120_000;

Deno.serve(async (req) => {
  try {
    const verified = await verifyHarborEdgeRequest(req, "run_bank_pack_v1");
    if (!PROJECT_URL) return new Response("Project URL Missing", { status: 500 });
    if (!SERVICE_ROLE_KEY) return new Response("Service Role Key Missing", { status: 500 });
    if (!OPENAI_API_KEY) return new Response("OpenAI API Key Missing", { status: 500 });

    const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);
    await authorizeHarborEdgeRequest(supabase, verified.context);
    const body = verified.body;
    const case_id = verified.context.caseId ?? undefined;
    if (!case_id) return json({ ok: false, error: "Missing case_id" }, 400);

    // Paid for: checked before any model call (commit_bank_pack_v1 checks again).
    const { data: entitlement, error: entitlementErr } = await supabase.rpc("get_effective_entitlement", { p_case_id: case_id });
    if (entitlementErr) return json({ ok: false, error: "entitlement_unavailable", code: entitlementErr.code ?? null }, 500);
    if ((entitlement as { features?: Record<string, unknown> } | null)?.features?.allow_self_serve_report !== true) {
      return json({ ok: false, reason: "not_purchased", error: "The bank pack has not been bought for this case" }, 403);
    }

    // One pack per case: a repeat request returns the stored one without another model call.
    const { data: existing, error: existingErr } = await supabase
      .from("reports")
      .select("id")
      .eq("case_id", case_id)
      .eq("report_type", "bank_pack_v1")
      .not("report_json", "is", null)
      .limit(1)
      .maybeSingle();
    if (existingErr) return json({ ok: false, error: "report_unavailable", code: existingErr.code ?? null }, 500);
    if (existing) return json({ ok: true, case_id, report_id: existing.id, reused: true }, 200);

    // Generated only from the latest confirmed "bank" snapshot; the web route re-checks it is still current.
    const fact_snapshot_id = typeof body.fact_snapshot_id === "string" ? body.fact_snapshot_id : null;
    if (!fact_snapshot_id) return json({ ok: false, reason: "facts_unconfirmed", error: "Confirm your facts first" }, 409);
    const { data: snapshot, error: snapshotErr } = await supabase
      .from("case_fact_snapshots")
      .select("id, facts")
      .eq("case_id", case_id)
      .eq("stage", "bank")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshotErr) return json({ ok: false, error: "snapshot_unavailable", code: snapshotErr.code ?? null }, 500);
    if (!snapshot || snapshot.id !== fact_snapshot_id) {
      return json({ ok: false, reason: "facts_unconfirmed", error: "These facts are no longer the latest confirmed facts" }, 409);
    }
    const facts = snapshot.facts as SnapshotFacts;

    const { data: storyRow, error: storyErr } = await supabase
      .from("case_story_revisions")
      .select("story_text")
      .eq("case_id", case_id)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (storyErr) return json({ ok: false, error: "story_unavailable", code: storyErr.code ?? null }, 500);

    const { data: findings, error: findingsErr } = await supabase
      .from("case_fact_findings")
      .select("fact_key, finding_type, values, resolution")
      .eq("case_id", case_id)
      .is("invalidated_at", null);
    if (findingsErr) return json({ ok: false, error: "findings_unavailable", code: findingsErr.code ?? null }, 500);

    const input = buildBankPackInput({ facts, findings: findings ?? [], storyText: storyRow?.story_text ?? null });
    const checks = { ...BANK_PACK_CHECKS, documented: documentedFacts(findings ?? []) };
    const user = `INPUT JSON:
${JSON.stringify(input, null, 2)}`;
    const deadline = Date.now() + BANK_PACK_BUDGET_MS;
    const usageEnv = usageEnvironment(Deno.env.toObject());
    const usageClient = supabase as unknown as UsageClient;
    const meter = { caller: "edge" as const, purpose: "bank_pack", provider: "openai" as const, caseId: case_id };
    const result = await produceChecked({
      facts,
      options: checks,
      sanitize: sanitizeProse,
      mapText: mapBankPackProse,
      texts: bankPackTexts,
      fallback: bankPackFallback,
      generate: (previousFailures) =>
        chatJson(
          {
            fetch,
            apiKey: OPENAI_API_KEY,
            model: BANK_PACK_MODEL,
            secondaryModel: BANK_PACK_SECONDARY_MODEL,
            maxTokens: OUTPUT_CAPS.bank_pack,
            system: bankPackSystem(previousFailures),
            user,
            deadline,
            onCall: (call) =>
              recordModelUsage(usageClient, usageEnv, {
                ...meter,
                model: call.model,
                usage: call.usage ?? undefined,
                latencyMs: call.latencyMs,
                httpStatus: call.httpStatus,
                outcome: call.kind === "ok" ? "ok" : call.kind === "refusal" ? "refused" : "error",
              }),
          },
          parseBankPackProse,
        ),
    });

    // Review log: IDs, check names and the release only, never the story or the generated text (hardening item 6).
    const review = {
      case_id,
      fact_snapshot_id,
      source: result.source,
      fallback_reason: result.fallbackReason,
      attempts: result.attempts,
      fired_checks: result.firedChecks,
      hard_checks: result.hardChecks,
      model: BANK_PACK_MODEL,
      release: typeof body.release === "string" ? body.release.slice(0, 40) : null,
    };
    if (result.source === "fallback") console.warn(`Bank pack fixed wording used: ${JSON.stringify(review)}`);
    const { error: reviewErr } = await supabase.from("analytics_events").insert({
      event_name: result.source === "fallback" ? "bank_pack_fixed_wording" : "bank_pack_generated",
      event_data: review,
    });
    if (reviewErr) console.error(`Bank pack review log failed: ${reviewErr.code ?? "unknown"}`);

    const report = assembleBankPack({
      prose: result.output,
      source: result.source,
      facts,
      findings: (findings ?? []).map((f) => ({
        factKey: f.fact_key,
        values: (f.values ?? []) as EvidenceFinding["values"],
        resolution: f.resolution as EvidenceFinding["resolution"],
      })),
    });
    const { data: committed, error: commitErr } = await supabase.rpc("commit_bank_pack_v1", {
      p_case_id: case_id,
      p_fact_snapshot_id: fact_snapshot_id,
      p_report_json: report,
    });
    if (commitErr) {
      const reason = commitErr.message === "bank_pack_snapshot_not_current" ? "facts_unconfirmed" : null;
      return json({ ok: false, ...(reason ? { reason } : {}), error: "report_not_saved", code: commitErr.code ?? null }, reason ? 409 : 500);
    }

    return json({ ok: true, case_id, report_id: (committed as { id?: string } | null)?.id ?? null, source: result.source }, 200);
  } catch (e) {
    // No case content in logs or responses (hardening item 6): name, code and a scrubbed message only.
    console.error(`Bank pack error: ${safeErrorText(e)}`);
    if (e instanceof HarborEdgeAuthError) return json({ ok: false, error: e.message }, e.status);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});

// The old report's wording rule, kept: "disputed", never "unauthorised" (run_report_selfserve_v1).
function sanitizeProse(text: string): string {
  return text.replace(/\bunauthori[sz]ed\b/gi, "disputed").replace(/[ \t]{2,}/g, " ").trim();
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
