import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const PROJECT_URL = Deno.env.get("GUIDEBUOY_URL");
const SERVICE_ROLE_KEY = Deno.env.get("GUIDEBUOY_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction");
Deno.serve(async (req)=>{
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", {
      status: 405
    });
    if (!PROJECT_URL) throw new Error("Missing GUIDEBUOY_URL secret");
    if (!SERVICE_ROLE_KEY) throw new Error("Missing GUIDEBUOY_SERVICE_ROLE_KEY secret");
    if (!OPENAI_API_KEY) throw new Error("Missing GuideBuoy_EdgeFunction secret (OpenAI key)");
    const body = await req.json();
    const case_id = body.case_id;
    const prompt_version = body.prompt_version ?? "v0.1";
    const source_ref = `tier0:${prompt_version}`;
    if (!case_id) return json({
      ok: false,
      error: "Missing case_id"
    }, 400);
    const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);
    // Load case
    const { data: caseRow, error: caseErr } = await supabase.from("cases").select("id, jurisdiction, institution_name, claim_amount, claim_currency, incident_date, incident_datetime, primary_narrative").eq("id", case_id).single();
    if (caseErr) throw caseErr;
    // Load latest intake
    const { data: intakeRows, error: intakeErr } = await supabase.from("case_intake").select("id, narrative_text, answers_json, language, created_at").eq("case_id", case_id).order("created_at", {
      ascending: false
    }).limit(1);
    if (intakeErr) throw intakeErr;
    const intake = intakeRows?.[0] ?? null;
    // Load timeline_raw if present
    const { data: timelineRows, error: timelineErr } = await supabase.from("case_narratives").select("text_content").eq("case_id", case_id).eq("narrative_type", "timeline_raw").order("created_at", {
      ascending: false
    }).limit(1);
    if (timelineErr) throw timelineErr;
    const timeline_raw = timelineRows?.[0]?.text_content ?? null;
    // Input snapshot (facts only)
    const input = {
      case: {
        id: caseRow.id,
        jurisdiction: caseRow.jurisdiction,
        institution_name: caseRow.institution_name,
        claim_amount: caseRow.claim_amount,
        claim_currency: caseRow.claim_currency,
        incident_date: caseRow.incident_date,
        incident_datetime: caseRow.incident_datetime
      },
      intake: intake ? {
        intake_id: intake.id,
        narrative_text: intake.narrative_text,
        answers_json: intake.answers_json,
        language: intake.language ?? "en"
      } : null,
      primary_narrative: caseRow.primary_narrative,
      timeline_raw
    };
    // LLM call
    const llm = await callOpenAITier0(input);
    // Write outputs to case_narratives (update-if-exists, else insert)
    const lang = intake?.language ?? "en";
    const intake_id = intake?.id ?? null;
    await upsertNarrative({
      supabase,
      case_id,
      narrative_type: "tier0_summary",
      title: "Incident summary (Tier-0)",
      text_content: llm.summary,
      source_ref,
      version: 1,
      language: lang,
      audience: "user",
      intake_id
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
      intake_id
    });
    return json({
      ok: true,
      case_id,
      source_ref
    }, 200);
  } catch (e) {
    return json({
      ok: false,
      error: String(e)
    }, 500);
  }
});
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
async function upsertNarrative(args) {
  const { supabase, case_id, narrative_type, title, text_content, source_ref, version, language, audience, intake_id } = args;
  const upd = await supabase.from("case_narratives").update({
    title,
    text_content,
    language,
    audience,
    intake_id,
    version
  }).eq("case_id", case_id).eq("narrative_type", narrative_type).eq("source_ref", source_ref).select("id");
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
      intake_id
    });
    if (ins.error) throw ins.error;
  }
}
async function callOpenAITier0(input) {
  const system = `
You are generating a Tier-0 consumer dispute report.
RULES:
- Use ONLY facts in the provided JSON.
- Do NOT invent dates, amounts, actions, parties, or outcomes.
- If information is missing, write "not provided".
- Be neutral and chronological. No legal conclusions.

Return STRICT JSON:
{
  "summary": "string",
  "evidence_checklist": "string"
}
`;
  const user = `INPUT JSON:\n${JSON.stringify(input, null, 2)}`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: system
        },
        {
          role: "user",
          content: user
        }
      ]
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return JSON.parse(content);
}
