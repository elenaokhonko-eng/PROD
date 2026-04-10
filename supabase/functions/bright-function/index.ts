import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const PROJECT_URL = Deno.env.get("GUIDEBUOY_URL");
const SERVICE_ROLE_KEY = Deno.env.get("GUIDEBUOY_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction");

type SrfSignals = {
  overall_fit: "likely" | "possible" | "unlikely";
  reasoning: string;
  bank_path_relevant: boolean;
  telco_path_relevant: boolean;
  imda_relevant: boolean;
  missing_fields: string[];
};

type Tier0LLMResult = {
  summary: string;
  evidence_checklist?: string;
  srf_signals?: SrfSignals;
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

    const input = {
      case: {
        id: caseRow.id,
        jurisdiction: caseRow.jurisdiction,
        institution_name: caseRow.institution_name,
        claim_amount: caseRow.claim_amount,
        claim_currency: caseRow.claim_currency,
        incident_date: caseRow.incident_date,
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
    };

    const llm = await callOpenAITier0(input);

    const lang = intake?.language ?? "en";
    const intake_id = intake?.id ?? null;

    await upsertNarrative({
      supabase,
      case_id,
      narrative_type: "tier0_summary",
      title: "Incident summary (Tier-0)",
      text_content: llm.summary ?? "",
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
  return true;
}

function headingForFit(fit: SrfSignals["overall_fit"]): string {
  const cap = fit.charAt(0).toUpperCase() + fit.slice(1);
  return `Assessment: ${cap} SRF relevance`;
}

function yesNo(b: boolean): string {
  return b ? "Yes" : "No";
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
  lines.push(`- Bank-related SRF issues: ${yesNo(signals.bank_path_relevant)}`);
  lines.push(`- Telco-related SRF / IMDA issues: ${yesNo(signals.telco_path_relevant)}`);
  lines.push(`- IMDA may be relevant: ${yesNo(signals.imda_relevant)}`);
  if (signals.missing_fields.length > 0) {
    lines.push("");
    lines.push("Missing information:");
    for (const f of signals.missing_fields) {
      lines.push(`- ${f}`);
    }
  }
  return lines.join("\n");
}

async function callOpenAITier0(input: unknown): Promise<Tier0LLMResult> {
  const system = `You are generating a Tier-0 consumer dispute report: an early-stage, informational output for someone who may have experienced a scam or fraud. Help them structure what happened and give a preliminary, non-binding signal about whether the matter may relate to the Singapore Shared Responsibility Framework (SRF) or may warrant further review on an IMDA-related telco path. This is not a legal determination, not a final eligibility decision, and not compensation advice.

GROUND RULES
Use only facts explicitly present in the provided JSON. Do not infer, assume, invent facts, or introduce external knowledge (e.g. how scams usually work). If something is missing, write "not provided". Be neutral, factual, chronological, clear, and non-judgemental. Do not provide legal advice, do not determine liability, and do not state that the user is eligible or ineligible for compensation.

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

missing_fields: List only genuinely missing information the user could reasonably supply (e.g. whether an SMS showed a sender name, whether a message appeared in an existing thread, whether a transaction was authorised, whether and when the bank was contacted). Exclude telco-internal data, regulatory conclusions, and speculative items.

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
