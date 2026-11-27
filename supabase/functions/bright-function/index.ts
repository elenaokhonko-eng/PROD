import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  authorizeHarborEdgeRequest,
  HarborEdgeAuthError,
  verifyHarborEdgeRequest,
} from "../_shared/edge-auth.ts";
import { safeErrorText } from "../_shared/safe-error.ts";
import { dailyBreaker, OUTPUT_CAPS, recordModelUsage, type UsageClient, usageEnvironment } from "../_shared/model-usage.ts";
import {
  APPROVED,
  assessSrf,
  chatSummary,
  type EvidenceFinding,
  evidenceListsText,
  type FactKey,
  factsYouConfirmed,
  type Institution,
  produceSummary,
  ProviderFailure,
  buildTier0Input,
  documentedFacts,
  tier0Checks,
  tier0System,
  reportItNowText,
  paymentsTable,
  type SnapshotFacts,
  srfAssessmentText,
  srfFactsFromSnapshot,
} from "../_shared/facts/index.ts";

const PROJECT_URL = Deno.env.get("GUIDEBUOY_URL");
const SERVICE_ROLE_KEY = Deno.env.get("GUIDEBUOY_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction");
// OpenAI model IDs are lower case; the default keeps the model this function has always used.
// Pinned to a dated snapshot so a provider-side model update cannot change behaviour unseen (hardening item 2);
// the corpus (scripts/tier0-corpus) is re-run before this or the prompt changes.
const TIER0_MODEL = (Deno.env.get("TIER0_MODEL") ?? "gpt-6-luna").trim().toLowerCase(); // = TIER0_DEFAULT_MODEL
// Used straight away when the main model is rate-limited (cost-controls spec §5 B8).
const TIER0_SECONDARY_MODEL = (Deno.env.get("TIER0_SECONDARY_MODEL") ?? "gpt-6.1-terra").trim().toLowerCase();
const TIER0_BUDGET_MS = 90_000;

type FidrecCheck = {
  institution_name_input: string | null;
  institution_name_normalized: string | null;
  fidrec_subscription_possible: boolean | null;
  matched_institution_name: string | null;
  match_type: "exact" | "alias" | "none" | null;
};

/** Structured facts from latest `run_case_extract_v4` row in `case_extract_runs`. */
type Tier0ExtractFacts = {
  institution_name: string | null;
  claim_amount: number | null;
  claim_currency: string | null;
  incident_date: string | null;
  incident_datetime: string | null;
  channel: string | null;
  disputed_merchant: string | null;
  spoofing_indicator: {
    status: string | null;
    type: string | null;
    basis: string[];
  } | null;
};

type SrfSignals = {
  overall_fit: "likely" | "possible" | "unlikely";
  reasoning: string;
  bank_path_relevant: boolean;
  telco_path_relevant: boolean;
  imda_relevant: boolean;
  missing_fields: string[];
  fidrec_subscription_possible?: boolean | null;
  fidrec_match_note?: string | null;
};

type Tier0NormalizeInput = {
  case?: {
    institution_name?: unknown;
    claim_amount?: unknown;
    claim_currency?: unknown;
    incident_date?: unknown;
    incident_datetime?: unknown;
  };
  intake?: {
    narrative_text?: unknown;
    answers_json?: unknown;
    language?: unknown;
    intake_id?: unknown;
  } | null;
  primary_narrative?: unknown;
  timeline_raw?: unknown;
  fidrec_check?: FidrecCheck;
  extract_facts?: Tier0ExtractFacts | null;
};

Deno.serve(async (req) => {
  try {
    const verified = await verifyHarborEdgeRequest(req, "bright-function");
    if (!PROJECT_URL) return new Response("Project URL Missing", { status: 500 });
    if (!SERVICE_ROLE_KEY) return new Response("Service Role Key Missing", { status: 500 });
    if (!OPENAI_API_KEY) return new Response("OpenAI API Key Missing", { status: 500 });

    const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);
    await authorizeHarborEdgeRequest(supabase, verified.context);
    const body = verified.body;
    const case_id = verified.context.caseId ?? undefined;
    const prompt_version = (body.prompt_version ?? "v0.1") as string;
    const source_ref = `tier0:${prompt_version}`;

    if (!case_id) return new Response("Missing case_id", { status: 400 });

    // The free evaluation is generated only from a confirmed fact snapshot (design C3): the latest "free" snapshot
    // for this case, frozen after every relevant finding was resolved. The web route re-checks it is still current.
    const fact_snapshot_id = typeof body.fact_snapshot_id === "string" ? body.fact_snapshot_id : null;
    if (!fact_snapshot_id) return json({ ok: false, reason: "facts_unconfirmed", error: "Confirm your facts first" }, 409);
    const { data: snapshot, error: snapshotErr } = await supabase
      .from("case_fact_snapshots")
      .select("id, facts")
      .eq("case_id", case_id)
      .eq("stage", "free")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshotErr) return json({ ok: false, error: "snapshot_unavailable", code: snapshotErr.code ?? null }, 500);
    if (!snapshot || snapshot.id !== fact_snapshot_id) {
      return json({ ok: false, reason: "facts_unconfirmed", error: "These facts are no longer the latest confirmed facts" }, 409);
    }
    const facts = snapshot.facts as SnapshotFacts;

    // The user's own story, for the order of events only; confirmed facts always win.
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

    const institutions = (facts.institution_names?.value as Institution[] | null) ?? [];
    const fidrecCheck = await checkFidrecSubscription(supabase, institutions[0]?.name ?? null);
    // Input, prompt and checks are shared with the corpus (scripts/tier0-corpus), so it measures exactly this.
    const input = buildTier0Input({ facts, findings: findings ?? [], storyText: storyRow?.story_text ?? null, fidrecCheck });
    const checks = { ...tier0Checks(facts), documented: documentedFacts(findings ?? []) };
    // The evidence checklist shown is the server's (C2); the model writes only the summary. A checker rejection or a
    // provider failure ends in the summary version, never in "failed" (summary-ladder.ts).
    const user = `INPUT JSON:
${JSON.stringify(input, null, 2)}`;
    const deadline = Date.now() + TIER0_BUDGET_MS;
    // Metering and the daily breaker (cost-controls spec §5 B4, B6): with today's budget used up, no model call is made
    // and the person gets the summary version.
    const env = Deno.env.toObject();
    const usageEnv = usageEnvironment(env);
    const usageClient = supabase as unknown as UsageClient;
    const meter = { caller: "edge" as const, purpose: "summary", provider: "openai" as const, caseId: case_id };
    const breaker = await dailyBreaker(usageClient, usageEnv, env);
    const result = await produceSummary({
      facts,
      options: checks,
      generate: async (previousFailures) => {
        if (breaker.state === "open") {
          await recordModelUsage(usageClient, usageEnv, { ...meter, model: TIER0_MODEL, outcome: "blocked" });
          throw new ProviderFailure("budget");
        }
        return chatSummary({
          fetch,
          apiKey: OPENAI_API_KEY,
          model: TIER0_MODEL,
          secondaryModel: TIER0_SECONDARY_MODEL,
          maxTokens: OUTPUT_CAPS.summary,
          system: tier0System(previousFailures),
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
        });
      },
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
      model: TIER0_MODEL,
      prompt_version,
      release: typeof body.release === "string" ? body.release.slice(0, 40) : null,
    };
    if (result.source === "fallback") console.warn(`Tier-0 evaluation not completed: ${JSON.stringify(review)}`);
    const { error: reviewErr } = await supabase.from("analytics_events").insert({
      event_name: result.source === "fallback" ? "free_evaluation_summary_version" : "free_evaluation_summary",
      event_data: review,
    });
    if (reviewErr) console.error(`Tier-0 review log failed: ${reviewErr.code ?? "unknown"}`);

    // Items 8 and 9 (Elena, 27 Nov 2026): the summary version is never delivered. Nothing is saved; the person can try
    // again, or, with today's budget used up, tomorrow.
    if (result.source === "fallback") {
      return result.fallbackReason === "budget"
        ? json({ ok: false, reason: "usage_limit", error: APPROVED.evaluationCap }, 429)
        : json({ ok: false, reason: "output_validation_failed", error: "The free evaluation could not be completed", checks: result.hardChecks.map((check) => ({ check })) }, 422);
    }

    const lang = "en";
    const intake_id = null;

    await upsertNarrative({
      supabase,
      case_id,
      narrative_type: "tier0_summary",
      title: "Free evaluation summary",
      text_content: result.summary,
      source_ref,
      version: 1,
      language: lang,
      audience: "user",
      intake_id,
      fact_snapshot_id,
    });

    await upsertNarrative({
      supabase,
      case_id,
      narrative_type: "tier0_evidence_checklist",
      title: "Evidence checklist",
      // Two lists from the confirmed facts and their documents (C2), not the model's suggestions.
      text_content: evidenceListsText(facts, (findings ?? []).map((f) => ({
        factKey: f.fact_key as FactKey,
        values: (f.values ?? []) as EvidenceFinding["values"],
        resolution: f.resolution as EvidenceFinding["resolution"],
      }))),
      source_ref,
      version: 1,
      language: lang,
      audience: "user",
      intake_id,
      fact_snapshot_id,
    });

    await upsertNarrative({
      supabase,
      case_id,
      narrative_type: "tier0_confirmed_facts",
      title: "Facts you confirmed",
      text_content: factsYouConfirmed(facts).map((f) => `${f.label}: ${f.text}`).join("\n"),
      source_ref,
      version: 1,
      language: lang,
      audience: "user",
      intake_id,
      fact_snapshot_id,
    });

    // The confirmed payments as a table (Elena, 27 Nov 2026); the other sections give their number and total.
    const payments = paymentsTable(facts);
    if (payments) {
      await upsertNarrative({
        supabase,
        case_id,
        narrative_type: "tier0_transactions",
        title: "The payments you dispute",
        text_content: payments,
        source_ref,
        version: 1,
        language: lang,
        audience: "user",
        intake_id,
        fact_snapshot_id,
      });
    } else {
      await supabase.from("case_narratives").delete().eq("case_id", case_id).eq("narrative_type", "tier0_transactions");
    }

    // Server-only SRF assessment from the confirmed facts and the cited rules; the model never produces one.
    await upsertNarrative({
      supabase,
      case_id,
      narrative_type: "tier0_srf_signal",
      title: "How the rules may apply",
      text_content: srfAssessmentText(assessSrf(srfFactsFromSnapshot(facts))),
      source_ref,
      version: 1,
      language: lang,
      audience: "user",
      intake_id,
      fact_snapshot_id,
    });
    const srfWritten = true;

    // "Report it now" (C4): always there (item 11); it says so once the bank and the police have both been told.
    await upsertNarrative({
      supabase,
      case_id,
      narrative_type: "tier0_report_now",
      title: "Report it now",
      text_content: reportItNowText(facts),
      source_ref,
      version: 1,
      language: lang,
      audience: "user",
      intake_id,
      fact_snapshot_id,
    });

    return json(
      {
        ok: true,
        case_id,
        source_ref,
        outputs: {
          summary: true,
          summary_source: result.source,
          evidence_checklist: true,
          srf_signal: srfWritten,
        },
      },
      200,
    );
  } catch (e) {
    // No case content in logs or responses (hardening item 6): name, code and a scrubbed message only.
    console.error(`Tier-0 error: ${safeErrorText(e)}`);
    if (e instanceof HarborEdgeAuthError) return json({ ok: false, error: e.message }, e.status);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function normalizeInstitutionName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Deterministic candidates: full normalized string, then each "/" segment normalized (e.g. DBS/POSB → dbs/posb, dbs, posb). */
function fidrecInstitutionCandidates(normalized: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (fragment: string) => {
    const n = normalizeInstitutionName(fragment);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };
  add(normalized);
  if (normalized.includes("/")) {
    for (const part of normalized.split("/")) {
      add(part);
    }
  }
  return out;
}

async function checkFidrecSubscription(
  supabase: SupabaseClient,
  institutionName: string | null | undefined,
): Promise<FidrecCheck> {
  const allNull = (): FidrecCheck => ({
    institution_name_input: null,
    institution_name_normalized: null,
    fidrec_subscription_possible: null,
    matched_institution_name: null,
    match_type: null,
  });

  if (institutionName === null || institutionName === undefined) return allNull();
  if (typeof institutionName !== "string") return allNull();
  const raw = institutionName.trim();
  if (!raw) return allNull();

  const normalized = normalizeInstitutionName(raw);
  const candidates = fidrecInstitutionCandidates(normalized);

  const withInput = (partial: Omit<FidrecCheck, "institution_name_input" | "institution_name_normalized">): FidrecCheck => ({
    institution_name_input: raw,
    institution_name_normalized: normalized,
    ...partial,
  });

  let exactRow: { institution_name?: unknown; institution_name_normalized?: unknown } | null = null;
  for (const cand of candidates) {
    const { data: exact, error: exactErr } = await supabase
      .from("fidrec_eligible")
      .select("institution_name, institution_name_normalized")
      .eq("institution_name_normalized", cand)
      .maybeSingle();

    if (exactErr) {
      console.warn(`Tier-0: fidrec_eligible exact match failed: ${exactErr.code ?? "unknown"}`);
      return withInput({
        fidrec_subscription_possible: null,
        matched_institution_name: null,
        match_type: null,
      });
    }
    if (exact) {
      exactRow = exact;
      break;
    }
  }

  if (exactRow) {
    const display =
      typeof exactRow.institution_name === "string" && exactRow.institution_name.trim().length > 0
        ? exactRow.institution_name.trim()
        : String(exactRow.institution_name_normalized ?? normalized);
    return withInput({
      fidrec_subscription_possible: true,
      matched_institution_name: display,
      match_type: "exact",
    });
  }

  const { data: rows, error: listErr } = await supabase
    .from("fidrec_eligible")
    .select("institution_name, institution_name_normalized, aliases");

  if (listErr) {
    console.warn(`Tier-0: fidrec_eligible alias list unavailable: ${listErr.code ?? "unknown"}`);
    return withInput({
      fidrec_subscription_possible: false,
      matched_institution_name: null,
      match_type: "none",
    });
  }

  for (const cand of candidates) {
    for (const row of rows ?? []) {
      const aliases = row.aliases;
      if (!Array.isArray(aliases)) continue;
      for (const a of aliases) {
        if (typeof a !== "string") continue;
        if (normalizeInstitutionName(a) === cand) {
          const display =
            typeof row.institution_name === "string" && row.institution_name.trim().length > 0
              ? row.institution_name.trim()
              : String(row.institution_name_normalized ?? cand);
          return withInput({
            fidrec_subscription_possible: true,
            matched_institution_name: display,
            match_type: "alias",
          });
        }
      }
    }
  }

  return withInput({
    fidrec_subscription_possible: false,
    matched_institution_name: null,
    match_type: "none",
  });
}

function safeExtractNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeExtractCurrency(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const c = String(v).trim().toUpperCase();
  if (!c) return null;
  if (c === "S$" || c === "S") return "SGD";
  return c;
}

function parseExtractSpoofing(raw: unknown): Tier0ExtractFacts["spoofing_indicator"] {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const basisRaw = o.basis;
  const basis = Array.isArray(basisRaw)
    ? basisRaw.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
    : [];
  return {
    status: typeof o.status === "string" ? o.status : null,
    type: typeof o.type === "string" ? o.type : null,
    basis,
  };
}

function buildFidrecMatchNote(check: FidrecCheck): string {
  const m = check.matched_institution_name;
  if (check.match_type === "exact" && m) return `Matched institution in FIDReC list: ${m}`;
  if (check.match_type === "alias" && m) return `Matched institution in FIDReC list by alias: ${m}`;
  if (check.match_type === "none") return "No FIDReC list match found for provided institution name";
  return "Institution name not available for FIDReC matching";
}

function isCaseFieldPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  return true;
}

/** Maps normalized (trimmed, lowercased, collapsed spaces) labels to case keys. */
function canonicalMissingFieldKey(normalized: string): keyof NonNullable<Tier0NormalizeInput["case"]> | null {
  const map: Record<string, keyof NonNullable<Tier0NormalizeInput["case"]>> = {
    amount: "claim_amount",
    "claim amount": "claim_amount",
    claim_amount: "claim_amount",
    currency: "claim_currency",
    "claim currency": "claim_currency",
    claim_currency: "claim_currency",
    institution: "institution_name",
    "institution name": "institution_name",
    institution_name: "institution_name",
    date: "incident_date",
    "incident date": "incident_date",
    incident_date: "incident_date",
    datetime: "incident_datetime",
    "incident datetime": "incident_datetime",
    incident_datetime: "incident_datetime",
  };
  return map[normalized] ?? null;
}

function extractFactsFieldPresent(
  canonical: keyof NonNullable<Tier0NormalizeInput["case"]>,
  xf: Tier0ExtractFacts | null | undefined,
): boolean {
  if (!xf) return false;
  switch (canonical) {
    case "institution_name":
      return isCaseFieldPresent(xf.institution_name);
    case "claim_amount":
      return isCaseFieldPresent(xf.claim_amount);
    case "claim_currency":
      return isCaseFieldPresent(xf.claim_currency);
    case "incident_date":
      return isCaseFieldPresent(xf.incident_date);
    case "incident_datetime":
      return isCaseFieldPresent(xf.incident_datetime);
    default:
      return false;
  }
}

function normalizeMissingFields(raw: string[], input: Tier0NormalizeInput): string[] {
  const c = input.case ?? {};
  const xf = input.extract_facts;
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;

    const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
    const canonical = canonicalMissingFieldKey(normalized);
    if (canonical && isCaseFieldPresent(c[canonical])) {
      continue;
    }
    if (canonical && extractFactsFieldPresent(canonical, xf)) {
      continue;
    }

    const dedupeKey = canonical ?? normalized;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(trimmed);
  }

  return out;
}

async function upsertNarrative(args: {
  supabase: SupabaseClient;
  case_id: string;
  narrative_type: string;
  title: string;
  text_content: string;
  source_ref: string;
  version: number;
  language: string;
  audience: string;
  intake_id: string | null;
  fact_snapshot_id: string;
}) {
  const { supabase, case_id, narrative_type, title, text_content, source_ref, version, language, audience, intake_id, fact_snapshot_id } =
    args;
  const upd = await supabase
    .from("case_narratives")
    .update({
      title,
      text_content,
      language,
      audience,
      intake_id,
      version,
      fact_snapshot_id,
    })
    .eq("case_id", case_id)
    .eq("narrative_type", narrative_type)
    .eq("source_ref", source_ref)
    .select("id");
  if (upd.error) throw upd.error;
  if ((upd.data?.length ?? 0) === 0) {
    const ins = await supabase.from("case_narratives").insert({
      case_id,
      narrative_type,
      title,
      text_content,
      source_ref,
      version,
      language,
      audience,
      intake_id,
      fact_snapshot_id,
    });
    if (ins.error) throw ins.error;
  }
}

const OVERALL_FIT = new Set(["likely", "possible", "unlikely"]);

function isValidSrfSignals(v: unknown): v is SrfSignals {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!OVERALL_FIT.has(o.overall_fit as string)) return false;
  if (typeof o.reasoning !== "string") return false;
  if (typeof o.bank_path_relevant !== "boolean") return false;
  if (typeof o.telco_path_relevant !== "boolean") return false;
  if (typeof o.imda_relevant !== "boolean") return false;
  if (!Array.isArray(o.missing_fields)) return false;
  if (!o.missing_fields.every((x) => typeof x === "string")) return false;
  if (o.fidrec_subscription_possible !== undefined && o.fidrec_subscription_possible !== null) {
    if (typeof o.fidrec_subscription_possible !== "boolean") return false;
  }
  if (o.fidrec_match_note !== undefined && o.fidrec_match_note !== null && typeof o.fidrec_match_note !== "string") {
    return false;
  }
  return true;
}

function headingForFit(fit: SrfSignals["overall_fit"]): string {
  const cap = fit.charAt(0).toUpperCase() + fit.slice(1);
  return `Assessment: ${cap} SRF relevance`;
}

function pathWording(b: boolean): string {
  return b ? "Possible" : "Not indicated";
}

function fidrecPathwayWording(v: boolean | null | undefined): string {
  if (v === true) return "Possible";
  if (v === false) return "Not indicated";
  return "Unknown";
}

/** Deterministic split for SRF narrative: bank explanation/records vs user-suppliable facts. */
function classifyMissingInfoItem(item: string): "user_fact" | "bank_gap" {
  const n = item.toLowerCase().replace(/\s+/g, " ");
  const bankMarkers = [
    "authenticated",
    "authentication",
    "digital token",
    "token",
    "how the transaction was",
    "bank explanation",
    "bank's explanation",
    "how the bank",
    "why the bank",
    "bank decision",
    "bank investigation",
    "bank records",
    "notification",
    "payee",
    "how this transaction",
    "method used",
  ];
  for (const m of bankMarkers) {
    if (n.includes(m)) return "bank_gap";
  }
  return "user_fact";
}

/** User-friendly phrasing for missing-info bullets; falls back to trimmed original. */
function rewriteMissingInfoItem(item: string): string {
  const t = item.trim();
  if (!t) return t;
  const rules: { source: string; flags: string; replacement: string }[] = [
    {
      source: "details on how the transaction was authenticated by the digital token",
      flags: "gi",
      replacement: "The bank's explanation of the claimed digital token authentication",
    },
    {
      source: "evidence of any notifications received regarding the addition of the payee",
      flags: "gi",
      replacement: "Screenshots or records of any bank notifications about payee addition",
    },
    {
      source: "whether (the )?transaction was authenticated (by|using) (a )?digital token",
      flags: "gi",
      replacement: "Whether the bank says the transaction was authenticated with a digital token (and any proof you have)",
    },
  ];
  for (const { source, flags, replacement } of rules) {
    const re = new RegExp(source, flags);
    if (re.test(t)) return t.replace(re, replacement).replace(/\s+/g, " ").trim();
  }
  return t;
}

function renderTier0SrfSignal(signals: SrfSignals): string {
  const lines: string[] = [];
  lines.push(headingForFit(signals.overall_fit));
  lines.push(
    "Based on current information, this is a preliminary signal only and not a determination of eligibility.",
  );
  lines.push("");
  lines.push("Reason:");
  lines.push(signals.reasoning);
  lines.push("");
  lines.push("Potential paths:");
  lines.push(`- Bank-related SRF issues: ${pathWording(signals.bank_path_relevant)}`);
  lines.push(`- Telco-related SRF / IMDA issues: ${pathWording(signals.telco_path_relevant)}`);
  lines.push(`- IMDA may be relevant: ${pathWording(signals.imda_relevant)}`);
  lines.push("");
  lines.push("Institution pathway:");
  lines.push(`- FIDReC subscription match: ${fidrecPathwayWording(signals.fidrec_subscription_possible)}`);
  if (signals.fidrec_match_note != null && String(signals.fidrec_match_note).trim() !== "") {
    lines.push(`- Match note: ${signals.fidrec_match_note}`);
  }
  const userMissingLines: string[] = [];
  const bankMissingLines: string[] = [];
  for (const f of signals.missing_fields) {
    const rewritten = rewriteMissingInfoItem(f);
    const bucket = classifyMissingInfoItem(rewritten) === "bank_gap" ? bankMissingLines : userMissingLines;
    bucket.push(`- ${rewritten}`);
  }
  if (userMissingLines.length > 0) {
    lines.push("");
    lines.push("User information that may help:");
    for (const line of userMissingLines) lines.push(line);
  }
  if (bankMissingLines.length > 0) {
    lines.push("");
    lines.push("Bank information or explanation that may help:");
    for (const line of bankMissingLines) lines.push(line);
  }
  return lines.join("\n");
}

