import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const PROJECT_URL = Deno.env.get("GUIDEBUOY_URL");
const SERVICE_ROLE_KEY = Deno.env.get("GUIDEBUOY_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction");

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

type Tier0LLMResult = {
  summary: string;
  evidence_checklist?: string;
  srf_signals?: SrfSignals;
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
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (!PROJECT_URL) return new Response("Project URL Missing", { status: 500 });
    if (!SERVICE_ROLE_KEY) return new Response("Service Role Key Missing", { status: 500 });
    if (!OPENAI_API_KEY) return new Response("OpenAI API Key Missing", { status: 500 });

    const body = await req.json();
    const case_id = body.case_id as string | undefined;
    const prompt_version = (body.prompt_version ?? "v0.1") as string;
    const source_ref = `tier0:${prompt_version}`;

    if (!case_id) return new Response("Missing case_id", { status: 400 });

    const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select(
        "id, jurisdiction, institution_name, claim_amount, claim_currency, incident_date, incident_datetime, primary_narrative",
      )
      .eq("id", case_id)
      .single();
    if (caseErr) return new Response(`Case Error: ${caseErr.message}`, { status: 500 });

    const { data: intakeRows, error: intakeErr } = await supabase
      .from("case_intake")
      .select("id, narrative_text, answers_json, language, created_at")
      .eq("case_id", case_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .range(0, 0);
    if (intakeErr) return new Response(`Intake Error: ${intakeErr.message}`, { status: 500 });
    const intake = intakeRows?.[0] ?? null;

    const { data: timelineRows, error: timelineErr } = await supabase
      .from("case_narratives")
      .select("text_content, created_at")
      .eq("case_id", case_id)
      .eq("narrative_type", "timeline_raw")
      .order("created_at", { ascending: false })
      .limit(1)
      .range(0, 0);
    if (timelineErr) return new Response(`Timeline narrative Error: ${timelineErr.message}`, { status: 500 });
    const timeline_raw = timelineRows?.[0]?.text_content ?? null;

    const extractFacts = await getLatestExtractFacts(supabase, case_id);
    const institutionForFidrec = extractFacts?.institution_name ?? caseRow.institution_name ?? null;
    const fidrecCheck = await checkFidrecSubscription(supabase, institutionForFidrec);

    const input = {
      case: {
        id: caseRow.id,
        jurisdiction: caseRow.jurisdiction,
        institution_name: extractFacts?.institution_name ?? caseRow.institution_name,
        claim_amount: extractFacts?.claim_amount ?? caseRow.claim_amount,
        claim_currency: extractFacts?.claim_currency ?? caseRow.claim_currency,
        incident_date: extractFacts?.incident_date ?? caseRow.incident_date,
        incident_datetime: caseRow.incident_datetime,
      },
      primary_narrative: caseRow.primary_narrative,
      intake: intake
        ? {
            intake_id: intake.id,
            narrative_text: intake.narrative_text,
            answers_json: intake.answers_json,
            language: intake.language ?? "en",
          }
        : null,
      timeline_raw,
      extract_facts: extractFacts,
      fidrec_check: fidrecCheck,
    };

    const llm = await callOpenAITier0(input);

    if (isValidSrfSignals(llm.srf_signals)) {
      llm.srf_signals.missing_fields = normalizeMissingFields(llm.srf_signals.missing_fields, input);
      llm.srf_signals.fidrec_subscription_possible = fidrecCheck.fidrec_subscription_possible;
      llm.srf_signals.fidrec_match_note = buildFidrecMatchNote(fidrecCheck);
    }

    const lang = intake?.language ?? "en";
    const intake_id = intake?.id ?? null;

    await upsertNarrative({
      supabase,
      case_id,
      narrative_type: "tier0_summary",
      title: "Incident summary (Tier-0)",
      text_content: sanitizeSummary(llm.summary ?? ""),
      source_ref,
      version: 1,
      language: lang,
      audience: "user",
      intake_id,
    });

    await upsertNarrative({
      supabase,
      case_id,
      narrative_type: "tier0_evidence_checklist",
      title: "Evidence checklist (Tier-0)",
      text_content: llm.evidence_checklist ?? "",
      source_ref,
      version: 1,
      language: lang,
      audience: "user",
      intake_id,
    });

    let srfWritten = false;
    if (isValidSrfSignals(llm.srf_signals)) {
      const srfText = renderTier0SrfSignal(llm.srf_signals);
      await upsertNarrative({
        supabase,
        case_id,
        narrative_type: "tier0_srf_signal",
        title: "SRF eligibility signal (Tier-0)",
        text_content: srfText,
        source_ref,
        version: 1,
        language: lang,
        audience: "user",
        intake_id,
      });
      srfWritten = true;
    } else if (llm.srf_signals !== undefined) {
      console.warn("Tier-0: srf_signals missing or malformed; skipping SRF narrative");
    }

    return json(
      {
        ok: true,
        case_id,
        source_ref,
        outputs: {
          summary: true,
          evidence_checklist: true,
          srf_signal: srfWritten,
        },
      },
      200,
    );
  } catch (e) {
    console.error(`Error: ${String(e)}`);
    return json({ ok: false, error: String(e) }, 500);
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
      console.warn(`Tier-0: fidrec_eligible exact match failed: ${exactErr.message}`);
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
    console.warn(`Tier-0: fidrec_eligible alias list unavailable: ${listErr.message}`);
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

async function getLatestExtractFacts(
  supabase: SupabaseClient,
  case_id: string,
): Promise<Tier0ExtractFacts | null> {
  const { data, error } = await supabase
    .from("case_extract_runs")
    .select("extract_json, prompt_version")
    .eq("case_id", case_id)
    .ilike("prompt_version", "%run_case_extract%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`Tier-0: case_extract_runs fetch failed: ${error.message}`);
    return null;
  }
  if (!data?.prompt_version || !String(data.prompt_version).includes("run_case_extract")) return null;
  if (!data.extract_json || typeof data.extract_json !== "object") return null;

  const ej = data.extract_json as Record<string, unknown>;

  const cm = ej.case_meta;
  let institution_name: string | null = null;
  let claim_amount: number | null = null;
  let claim_currency: string | null = null;
  if (cm && typeof cm === "object") {
    const meta = cm as Record<string, unknown>;
    if (typeof meta.institution_name === "string") {
      const t = meta.institution_name.trim();
      institution_name = t.length > 0 ? t : null;
    }
    claim_amount = safeExtractNumber(meta.claim_amount);
    claim_currency = normalizeExtractCurrency(meta.claim_currency);
  }

  let incident_date: string | null = null;
  const idRaw = ej.incident_date;
  if (typeof idRaw === "string") {
    const s = idRaw.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) incident_date = s.slice(0, 10);
    else if (s.length > 0) incident_date = s;
  }

  let incident_datetime: string | null = null;
  const tl = ej.timeline;
  if (tl && typeof tl === "object") {
    const ia = (tl as Record<string, unknown>).incident_at;
    if (typeof ia === "string" && ia.trim().length > 0) incident_datetime = ia.trim();
  }
  if (!incident_datetime && typeof ej.incident_datetime === "string" && ej.incident_datetime.trim().length > 0) {
    incident_datetime = ej.incident_datetime.trim();
  }

  let channel: string | null = null;
  let spoofing_indicator: Tier0ExtractFacts["spoofing_indicator"] = null;
  const inc = ej.incident;
  if (inc && typeof inc === "object") {
    const iv = inc as Record<string, unknown>;
    if (typeof iv.channel === "string") {
      const c = iv.channel.trim();
      channel = c.length > 0 ? c : null;
    }
    if (iv.spoofing_indicator !== undefined && iv.spoofing_indicator !== null) {
      spoofing_indicator = parseExtractSpoofing(iv.spoofing_indicator);
    }
  }

  let disputed_merchant: string | null = null;
  const tx = ej.transaction;
  if (tx && typeof tx === "object") {
    const dm = (tx as Record<string, unknown>).disputed_merchant;
    if (typeof dm === "string") {
      const m = dm.trim();
      disputed_merchant = m.length > 0 ? m : null;
    }
  }

  return {
    institution_name,
    claim_amount,
    claim_currency,
    incident_date,
    incident_datetime,
    channel,
    disputed_merchant,
    spoofing_indicator,
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

const BANNED_SUMMARY_PATTERNS: RegExp[] = [
  /\bat home\b/gi,
  /\bhaving dinner\b/gi,
  /\bwith family\b/gi,
  /\bwith my family\b/gi,
  /\bwith his family\b/gi,
  /\bwith her family\b/gi,
  /\bwith their family\b/gi,
  /\bwhile at home\b/gi,
  /\bwatching tv\b/gi,
];

function sanitizeSummary(summary: string): string {
  let s = summary;
  for (const re of BANNED_SUMMARY_PATTERNS) {
    const next = s.replace(re, "");
    if (next !== s) {
      console.warn("Tier-0: removed banned contextual phrase from summary");
      s = next;
    }
  }
  return s.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
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
}) {
  const { supabase, case_id, narrative_type, title, text_content, source_ref, version, language, audience, intake_id } =
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

async function callOpenAITier0(input: unknown): Promise<Tier0LLMResult> {
  const system = `You are generating a Tier-0 consumer dispute report: an early-stage, informational output for someone who may have experienced a scam or fraud. Help them structure what happened and give a preliminary, non-binding signal about whether the matter may relate to the Singapore Shared Responsibility Framework (SRF) or may warrant further review on an IMDA-related telco path. This is not a legal determination, not a final eligibility decision, and not compensation advice.

GROUND RULES
Use only facts explicitly present in the provided JSON. Do not infer, assume, invent facts, or introduce external knowledge (e.g. how scams usually work). If something is missing, write "not provided". Be neutral, factual, chronological, clear, and non-judgemental. Do not provide legal advice, do not determine liability, and do not state that the user is eligible or ineligible for compensation.

FIDREC_CHECK (optional object in input JSON)
The fidrec_check block is a soft, reference-list signal only. Do not guess FIDReC subscription from institution name familiarity alone. A positive list match may suggest relevance of a consumer financial dispute pathway; a non-match is not a final exclusion. A null or inconclusive result means unknown. Do not state that the user is or is not entitled to FIDReC or any scheme.

SUMMARY HARD RULES
Do not add personal circumstances, location, family context, emotions, or surrounding scene details unless explicitly stated in the input. Do not add inferred context such as where the user was, what device they used, or what they were doing at the time, unless the input explicitly says so. If a fact is not explicitly in the input, do not include it.

MISSING_FIELDS HARD RULES
Do not list a field as missing if it appears anywhere in the input JSON, including: case fields, intake narrative_text, intake answers_json, primary_narrative, and timeline_raw. Specifically, do not list institution_name, claim_amount, claim_currency, incident_date, or incident_datetime as missing when they are present in input.case (non-null and non-empty where applicable). Do not list any field as missing unless it would materially help clarify the SRF signal.

OUTPUT
Return STRICT JSON only, with this exact structure (no extra keys):
{
"summary": "string",
"evidence_checklist": "string",
"srf_signals": {
"overall_fit": "likely | possible | unlikely",
"reasoning": "string",
"bank_path_relevant": true,
"telco_path_relevant": false,
"imda_relevant": false,
"missing_fields": ["string"]
}
}

SUMMARY
Produce a clear, chronological summary covering: how the incident or contact started; what the user did; transactions or losses; and what happened afterward (e.g. reporting, bank contact). Do not add interpretation or judgement. Use "not provided" where key elements are missing.

EVIDENCE CHECKLIST
Suggest useful supporting evidence based only on gaps implied by the input. Valid examples include: bank transaction records, screenshots of messages, call logs, police report, bank correspondence. Do not suggest evidence unrelated to the scenario; do not assume documents exist if not mentioned.

SRF SIGNALS (srf_signals object)
The soft signal is directional only and must follow these rules in one pass:

overall_fit: Use "likely" when facts clearly align with unauthorised transaction or scam-type scenarios; "possible" when facts are incomplete, ambiguous, or only partially aligned; "unlikely" when facts do not suggest a scam or SRF-relevant scenario. If unsure, use "possible".

bank_path_relevant: true only if the input includes facts such as unauthorised transactions, phishing or credential compromise, account access issues, suspicious transfers, or delayed or failed bank response. Otherwise false.

telco_path_relevant: Assess only from user-visible facts in the input. true only with explicit evidence of spoofed SMS sender ID, a message under a legitimate organisation sender name (e.g. bank/government ID), communication inside an existing legitimate SMS thread, or clear impersonation via sender identity (not message content alone). false if communication was from a normal number, or the scam was via WhatsApp, Telegram, voice call, or ordinary SMS without identity masking, or there is no visible sender-identity manipulation, or the case rests on social engineering alone. Do not assume spoofing unless stated. Do not infer telco failure from the mere existence of a call or message. Do not use facts the user could not know (e.g. internal telco data, whether a number was on a scam list).

imda_relevant: true only if telco_path_relevant is true; otherwise false. Be conservative.

missing_fields: List only genuinely missing information the user could reasonably supply (e.g. whether an SMS showed a sender name, whether a message appeared in an existing thread, whether a transaction was authorised, whether and when the bank was contacted). Exclude telco-internal data, regulatory conclusions, and speculative items. Apply the MISSING_FIELDS HARD RULES above. When suggesting missing information, prefer concise user-actionable wording for items the consumer can provide, and plain language for gaps that mainly need the bank's explanation, investigation, or records (still output a single missing_fields string array as specified).

reasoning: Explain the classifications using only input facts; if uncertain, say what is missing.`;

  const user = `INPUT JSON:\n${JSON.stringify(input, null, 2)}`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: {
        type: "json_object",
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`OpenAI error ${resp.status}: ${err}`);
    throw new Error(`OpenAI error ${resp.status}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");

  return JSON.parse(content) as Tier0LLMResult;
}
