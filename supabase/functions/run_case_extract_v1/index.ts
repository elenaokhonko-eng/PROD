// supabase/functions/run_case_extract_v1/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction") ?? "";
const EXTRACT_MODEL = Deno.env.get("CASE_EXTRACT_MODEL") ?? "gpt-4.1-mini";
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!OPENAI_API_KEY) throw new Error("Missing GuideBuoy_EdgeFunction secret");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function isBool(v) {
  return v === true || v === false;
}
/**
 * Map free-text / user-stated doc strings into evidence buckets
 * so confidence can be deterministic and consistent.
 */ function classifyDocLabel(labelRaw) {
  const s = labelRaw.toLowerCase();
  if (s.includes("police") || s.includes("report no") || s.includes("g/20")) return "police_report";
  if (s.includes("bank statement") || s.includes("statement")) return "bank_statement";
  if (s.includes("call log") || s.includes("call logs") || s.includes("call history")) return "call_logs";
  if (s.includes("screenshot") || s.includes("screenshots")) return "screenshots";
  if (s.includes("sms") || s.includes("message")) return "sms_screenshot";
  if (s.includes("auth") || s.includes("otp") || s.includes("mfa")) return "auth_log";
  if (s.includes("cyber") || s.includes("forensic") || s.includes("expert")) return "cyber_expert_report";
  return "other";
}
/**
 * Deterministic confidence based on:
 * - presence of specific document buckets
 * - completeness of explicit customer action answers
 * - penalties for unknown institution-side controls
 *
 * This produces a stable confidence that the decision loop can trust.
 */ function computeDeterministicConfidence(ej) {
  let conf = 0.4; // base
  const docs = Array.isArray(ej?.evidence_status?.documents_present) ? ej.evidence_status.documents_present.map((x)=>String(x)) : [];
  const buckets = new Set();
  for (const d of docs)buckets.add(classifyDocLabel(d));
  // Evidence boosts
  if (buckets.has("police_report")) conf += 0.2;
  if (buckets.has("bank_statement")) conf += 0.15;
  if (buckets.has("call_logs")) conf += 0.15;
  if (buckets.has("screenshots")) conf += 0.1;
  if (buckets.has("auth_log")) conf += 0.1;
  if (buckets.has("cyber_expert_report")) conf += 0.2;
  // Customer action completeness: reward explicit true/false (not null)
  const ca = ej?.customer_actions ?? {};
  const customerFields = [
    "shared_otp",
    "provided_credentials",
    "clicked_phishing_link",
    "approved_push_notification",
    "installed_remote_access_software"
  ];
  let explicitCount = 0;
  for (const f of customerFields){
    if (isBool(ca?.[f])) explicitCount += 1;
  }
  // up to +0.25 (5 fields * 0.05)
  conf += 0.05 * explicitCount;
  // Institution-side uncertainty penalty (keep small)
  const ia = ej?.institution_actions ?? {};
  if (ia?.limits_changed === null || ia?.limits_changed === undefined) conf -= 0.1;
  // Clamp
  conf = clamp(conf, 0.3, 0.95);
  // Round to 2dp for stability
  return Math.round(conf * 100) / 100;
}
/**
 * OpenAI Responses API call (returns JSON text we parse).
 * We keep your “no extra keys” contract by instructing the model
 * and enforcing post-processing.
 */ async function openaiExtract(template, inputText) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      temperature: 0,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are an information extraction engine.\n" + "Return ONLY valid JSON that matches the TEMPLATE exactly:\n" + "- Do NOT add new keys.\n" + "- Use null when unknown.\n" + "- No legal conclusions.\n" + "- Do not invent documents; leave documents_present/documents_missing empty unless explicitly stated.\n"
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Fill this JSON template using only the provided case data.\n\n` + `TEMPLATE:\n${JSON.stringify(template)}\n\n` + `DATA:\n${inputText}\n`
            }
          ]
        }
      ]
    })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI extract failed (${res.status}): ${raw}`);
  const payload = JSON.parse(raw);
  const outText = payload?.output?.[0]?.content?.[0]?.text;
  if (!outText) throw new Error("OpenAI extract: no output text returned");
  let ej;
  try {
    ej = JSON.parse(outText);
  } catch  {
    throw new Error("OpenAI extract: model did not return valid JSON");
  }
  return ej;
}
serve(async (req)=>{
  try {
    if (req.method !== "POST") return jsonResp({
      ok: false,
      error: "POST only"
    }, 405);
    const body = await req.json().catch(()=>({}));
    const case_id = body.case_id;
    if (!case_id) return jsonResp({
      ok: false,
      error: "Missing case_id"
    }, 400);
    // 1) Fetch case
    const { data: caseRow, error: caseErr } = await supabase.from("cases").select("*").eq("id", case_id).single();
    if (caseErr) throw caseErr;
    // 2) Fetch latest intake
    const { data: intakeRows, error: intakeErr } = await supabase.from("case_intake").select("*").eq("case_id", case_id).order("created_at", {
      ascending: false
    }).limit(1);
    if (intakeErr) throw intakeErr;
    const intake = intakeRows?.[0] ?? null;
    // 3) Fetch latest narrative (optional)
    const { data: narrativeRows, error: narrativeErr } = await supabase.from("case_narratives").select("*").eq("case_id", case_id).order("created_at", {
      ascending: false
    }).limit(1);
    if (narrativeErr) throw narrativeErr;
    const narrative = narrativeRows?.[0] ?? null;
    // 4) Locked template (keep stable)
    const schemaTemplate = {
      case_meta: {
        jurisdiction: caseRow.jurisdiction ?? null,
        institution_name: caseRow.institution_name ?? null,
        claim_type: caseRow.claim_type ?? null,
        claim_currency: caseRow.claim_currency ?? null,
        claim_amount: caseRow.claim_amount ?? null
      },
      timeline: {
        incident_at: caseRow.incident_datetime ?? caseRow.incident_date ?? null,
        discovered_at: null,
        reported_to_institution_at: null,
        reported_to_police_at: null
      },
      losses: [],
      customer_actions: {
        clicked_phishing_link: null,
        provided_credentials: null,
        shared_otp: null,
        approved_push_notification: null,
        installed_remote_access_software: null
      },
      institution_actions: {
        payee_added: null,
        limits_changed: null,
        step_up_authentication_used: null,
        transaction_block_attempted: null
      },
      evidence_status: {
        documents_present: [],
        documents_missing: [],
        confidence: 0.5,
        missing_facts: []
      }
    };
    const inputText = [
      `CASE ROW: ${JSON.stringify(caseRow)}`,
      `INTAKE: ${JSON.stringify(intake)}`,
      `NARRATIVE: ${JSON.stringify(narrative)}`
    ].join("\n\n");
    // 5) OpenAI extraction
    let ej = await openaiExtract(schemaTemplate, inputText);
    // =========================
    // POST-PROCESS (DETERMINISTIC)
    // =========================
    // A) Deterministic claim amount + institution name
    const lossSum = Array.isArray(ej.losses) ? ej.losses.reduce((s, x)=>s + (Number(x?.amount) || 0), 0) : 0;
    ej.case_meta = ej.case_meta ?? {};
    ej.case_meta.claim_amount = caseRow.claim_amount ?? (lossSum || null);
    ej.case_meta.institution_name = caseRow.institution_name ?? ej.case_meta.institution_name ?? null;
    // B) Deterministic missing_fields (define ONCE)
    const missing_fields = [];
    const requiredFields = [
      [
        "timeline.incident_at",
        ej.timeline?.incident_at
      ],
      [
        "timeline.reported_to_institution_at",
        ej.timeline?.reported_to_institution_at
      ],
      [
        "case_meta.institution_name",
        ej.case_meta?.institution_name
      ],
      [
        "customer_actions.shared_otp",
        ej.customer_actions?.shared_otp
      ]
    ];
    for (const [k, v] of requiredFields){
      if (v === null || v === undefined) missing_fields.push(k);
    }
    // C) Normalize evidence_status and attach missing_facts
    ej.evidence_status = ej.evidence_status ?? {};
    ej.evidence_status.missing_facts = missing_fields;
    // Keep documents_missing constrained (no freestyle)
    const allowedMissingDocs = new Set([
      "bank_statement",
      "police_report",
      "bank_dispute_reference",
      "sms_screenshot",
      "auth_log",
      "cyber_expert_report",
      "call_logs",
      "screenshots"
    ]);
    ej.evidence_status.documents_missing = Array.isArray(ej.evidence_status.documents_missing) ? ej.evidence_status.documents_missing.map((x)=>String(x)).filter((x)=>allowedMissingDocs.has(x)) : [];
    // D) Deterministic confidence overwrite (KEY FIX)
    ej.evidence_status.confidence = computeDeterministicConfidence(ej);
    // 6) Insert extract run
    const { data: runRow, error: runErr } = await supabase.from("case_extract_runs").insert({
      case_id,
      extract_json: ej,
      missing_fields,
      model_name: EXTRACT_MODEL,
      prompt_version: "extract_v1.2_deterministic_confidence",
      intake_id: intake?.id ?? null
    }).select("*").single();
    if (runErr) throw runErr;
    return jsonResp({
      ok: true,
      extract_run: runRow
    }, 200);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return jsonResp({
      ok: false,
      error: err
    }, 500);
  }
});
