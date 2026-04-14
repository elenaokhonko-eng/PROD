// supabase/functions/run_case_extract_v1/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
/**
 * v2.1.3 changes (institution first-report + type-aware preference):
 * - Institution keyword set now prioritises FIRST REPORT phrases (receive/report/submitted/reference no)
 * - De-prioritises "ACKNOWLEDG"/decision/outcome language for reported_to_institution_at
 * - Adds type-aware preference: BANK_COMMS + DISPUTE_FORM outrank late-stage letters
 * - Chooses EARLIEST date >= incident_date among "first_report" candidates (when available)
 * - Keeps: two-tier evidence (all-doc compute + prompt curation), txn dedupe/filter, loss override, atomic RPC + stages
 * v2.1.4: structured incident (channel, spoofing_indicator), transaction.disputed_merchant; case_meta claim normalize; missing_facts merge
 * v2.1.5: incident.channel = scam/fraud contact medium only (not reporting channels); no \"unknown\" channel value
 */ const VERSION = "run_case_extract_v3::v2.1.5::+incident-channel-scam-only+spoofing-align-null-channel::two-tier-evidence+loss-keyword-override+txn-dedupe-filter+reporting-dates(first-report+type-aware)::atomic-rpc+stages";
/* =========================================================
   HELPERS
   ========================================================= */ function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
function truncate(s, n) {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n) + "…" : t;
}
function normalizePgError(err) {
  if (!err) return null;
  return {
    message: err?.message,
    code: err?.code,
    details: err?.details,
    hint: err?.hint,
    status: err?.status,
    statusText: err?.statusText
  };
}
function normalizeError(e) {
  if (e instanceof Error) {
    return {
      name: e.name,
      message: e.message,
      stack: e.stack,
      code: e?.code,
      details: e?.details,
      hint: e?.hint,
      status: e?.status
    };
  }
  if (typeof e === "object" && e !== null) {
    return {
      name: e?.name ?? "ErrorObject",
      message: e?.message ?? JSON.stringify(e),
      ...normalizePgError(e),
      raw: e
    };
  }
  return {
    name: "UnknownError",
    message: String(e)
  };
}
function ensureOk(data, error, context) {
  if (error) throw new Error(`${context}: ${JSON.stringify(normalizePgError(error) ?? error)}`);
  if (!data) throw new Error(`${context}: no data returned`);
  return data;
}
function safeNumber(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const cleaned = x.replace(/[^0-9.\-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function normalizeCurrency(cur) {
  if (cur === null || cur === undefined) return null;
  const c = String(cur).trim().toUpperCase();
  if (!c) return null;
  if (c === "S$" || c === "S") return "SGD";
  return c;
}
function normalizeDocType(t) {
  const s = String(t ?? "").trim().toUpperCase();
  return s || "OTHER";
}
function toISODate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseIncidentISO(caseData) {
  // prefer incident_date, else timeline-ish fields
  const v = caseData?.incident_date ?? caseData?.incident_at ?? caseData?.incident_datetime ?? null;
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Keep YYYY-MM-DD if already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // try Date parse
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return toISODate(d);
}
/* =========================================================
   STAGES (diagnostic markers)
   ========================================================= */ function createStageMarker() {
  let stage = "00_init";
  const marks = [];
  function mark(next, meta) {
    stage = next;
    marks.push({
      stage,
      at: new Date().toISOString(),
      meta
    });
    console.log("[STAGE]", JSON.stringify({
      stage,
      meta
    }));
  }
  return {
    get stage () {
      return stage;
    },
    marks,
    mark
  };
}
/* =========================================================
   OPENAI RESPONSES (JSON mode + 1 retry)
   ========================================================= */ function extractOutputText(payload) {
  if (!payload || !Array.isArray(payload.output)) return "";
  return payload.output.flatMap((item)=>Array.isArray(item?.content) ? item.content : []).filter((c)=>(c?.type === "output_text" || c?.type === "output_text_delta") && typeof c?.text === "string").map((c)=>c.text).join("").trim();
}
function sanitizeToJsonObject(text) {
  let t = String(text ?? "").trim();
  t = t.replace(/```json/gi, "").replace(/```/g, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) throw new Error("No JSON object found in model output");
  return t.slice(first, last + 1);
}
async function callOpenAIResponses(openaiKey, body) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${openaiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text().catch(()=>"");
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch  {
    payload = null;
  }
  if (!res.ok) throw new Error(`OpenAI failed (${res.status}): ${payload ? JSON.stringify(payload) : raw}`);
  if (!payload) throw new Error(`OpenAI failed: empty/invalid JSON response (${res.status})`);
  return payload;
}
async function openaiExtract(args) {
  const { openaiKey, model, template, inputText, serverComputed } = args;
  const systemText = "You are an information extraction engine.\n" + "Return ONLY valid JSON.\n" + "It MUST match the TEMPLATE exactly:\n" + "- Do NOT add new keys.\n" + "- Use null when unknown.\n" + "- No legal conclusions.\n" + "- Do not invent documents beyond those provided.\n" + "\n" + "STRUCTURED FACTS (no narrative; facts only; null when not clearly supported):\n" + "\n" + "case_meta.institution_name:\n" + "- Set ONLY if a financial institution is explicitly named in the data (e.g. DBS, OCBC, UOB, Citibank, Standard Chartered, Wise, PayPal).\n" + "- Use a short canonical name (e.g. \"DBS\").\n" + "- Do NOT infer from country, product type, or context alone.\n" + "\n" + "incident.channel (scam / fraudulent contact ONLY, NOT reporting):\n" + "- Set ONLY how the scam or fraudulent first contact occurred: one of sms | phone_call | whatsapp | telegram | email | website | banking_app when clearly stated for that contact; otherwise null.\n" + "- Do NOT set incident.channel from later reporting or follow-up: e.g. calling the bank hotline, customer support, filing a police report, or submitting a dispute or complaint.\n" + "- If the only phone call described is to report the incident after discovery, keep incident.channel null.\n" + "- If how the victim was first approached is unclear, use null (do not use a placeholder string for channel).\n" + "\n" + "incident.spoofing_indicator (aligned with scam contact, not reporting):\n" + "- If incident.channel is null, set spoofing_indicator.type to null.\n" + "- status \"yes\" ONLY for clear sender-identity manipulation on the scam/fraud contact itself (e.g. SMS under bank sender name, message in existing legitimate thread, scam call showing official bank number).\n" + "- status \"no\" when the scam contact source is clearly an ordinary mobile number or normal sender with no masking.\n" + "- Impersonation in message content alone without spoofed sender identity is NOT spoofing — use \"no\" or \"unknown\", never \"yes\".\n" + "- status \"unknown\" when unclear or when only reporting/support/police channels are described without clear scam-channel spoofing facts (default when in doubt).\n" + "- type: \"sms\" or \"phone_call\" only when incident.channel is sms or phone_call and spoofing facts match that medium; otherwise null.\n" + "- basis: short factual strings only (e.g. \"message appeared under bank sender name\", \"ordinary mobile number described\", \"no sender identity details provided\").\n" + "\n" + "transaction.disputed_merchant:\n" + "- Payee / merchant / recipient explicitly named; null if unclear.\n" + "\n" + "evidence_status.missing_facts:\n" + "- Include dot-path strings for important gaps: case_meta.institution_name when null; incident.channel when null; transaction.disputed_merchant when null.\n" + "- Include incident.spoofing_indicator.status when the case clearly involves sms or phone_call and spoofing status remains unknown.\n" + "\n" + "SERVER OVERRIDES (MUST FOLLOW):\n" + "- If SERVER_COMPUTED.reported_loss.amount is not null, set reported_loss.amount to that exact value.\n" + "- If SERVER_COMPUTED.institution_name_guess is not null, set case_meta.institution_name to that value unless clearly contradicted.\n" + "- If SERVER_COMPUTED.reported_to_police_at is not null, set timeline.reported_to_police_at to that exact value.\n" + "- If SERVER_COMPUTED.reported_to_institution_at is not null, set timeline.reported_to_institution_at to that exact value.\n";
  const userText = "Fill this JSON template using only the provided case data.\n\n" + `TEMPLATE (JSON):\n${JSON.stringify(template)}\n\n` + `SERVER_COMPUTED:\n${JSON.stringify(serverComputed)}\n\n` + `DATA:\n${inputText}\n`;
  const payload1 = await callOpenAIResponses(openaiKey, {
    model,
    temperature: 0,
    text: {
      format: {
        type: "json_object"
      }
    },
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: systemText
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: userText
          }
        ]
      }
    ]
  });
  let outText = extractOutputText(payload1);
  try {
    return JSON.parse(sanitizeToJsonObject(outText));
  } catch  {
    const retryText = "The previous output was NOT valid JSON.\n" + "Re-output ONLY a valid JSON object that matches the TEMPLATE EXACTLY.\n" + "No markdown. No commentary. No trailing commas. No extra keys.\n\n" + `TEMPLATE (JSON):\n${JSON.stringify(template)}\n\n` + `SERVER_COMPUTED:\n${JSON.stringify(serverComputed)}\n\n` + `PREVIOUS OUTPUT:\n${outText}\n`;
    const payload2 = await callOpenAIResponses(openaiKey, {
      model,
      temperature: 0,
      text: {
        format: {
          type: "json_object"
        }
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemText
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: retryText
            }
          ]
        }
      ]
    });
    outText = extractOutputText(payload2);
    return JSON.parse(sanitizeToJsonObject(outText));
  }
}
/* =========================================================
   EVIDENCE: LOAD + CURATE
   ========================================================= */ const ALL_DOC_TEXT_CAP = 12_000; // per doc, for server compute safety
const PROMPT_DOC_LIMIT = 16;
const PROMPT_DOC_SNIPPET = 900;
async function fetchAllEvidenceSignals(supabase, case_id) {
  // Docs
  const docsRes = await supabase.from("case_documents").select("id, filename, verified_document_type, processing_status, is_processed").eq("case_id", case_id);
  const docs = ensureOk(docsRes.data ?? [], docsRes.error, "Fetch case_documents");
  const docMap = new Map();
  for (const d of docs){
    docMap.set(d.id, d);
  }
  // Extractions
  const extrRes = await supabase.from("case_document_extractions").select("id, document_id, confidence, extracted_json, extracted_text, created_at").eq("case_id", case_id).order("confidence", {
    ascending: false
  }).order("created_at", {
    ascending: false
  });
  const extr = ensureOk(extrRes.data ?? [], extrRes.error, "Fetch case_document_extractions");
  // Keep 1 extraction per doc: highest confidence, latest
  const bestByDoc = new Map();
  for (const r of extr){
    const docId = String(r.document_id);
    if (!docId) continue;
    if (!docMap.has(docId)) continue;
    const prev = bestByDoc.get(docId);
    if (!prev) {
      bestByDoc.set(docId, r);
      continue;
    }
    const c1 = Number(r.confidence ?? 0);
    const c0 = Number(prev.confidence ?? 0);
    const t1 = r.created_at ? Date.parse(r.created_at) : 0;
    const t0 = prev.created_at ? Date.parse(prev.created_at) : 0;
    if (c1 > c0 || c1 === c0 && t1 > t0) bestByDoc.set(docId, r);
  }
  const out = [];
  for (const [docId, r] of bestByDoc.entries()){
    const d = docMap.get(docId);
    const rawText = r.extracted_text ?? r.extracted_json?.raw_text ?? r.extracted_json?.text ?? null;
    out.push({
      document_id: docId,
      filename: d?.filename ?? null,
      verified_document_type: d?.verified_document_type ?? null,
      extraction_confidence: Number(r.confidence ?? 0),
      extracted_text: rawText ? truncate(String(rawText), ALL_DOC_TEXT_CAP) : null,
      extracted_json: r.extracted_json ?? null,
      created_at: r.created_at ?? null
    });
  }
  return out;
}
function docTypePriorityForPrompt(docType) {
  const t = normalizeDocType(docType);
  // favour “summary-ish” comms and statements for prompt; the server uses all docs anyway
  if (t.includes("POLICE")) return 90;
  if (t.includes("BANK") || t.includes("STATEMENT")) return 85;
  if (t.includes("DISPUTE") || t.includes("FORM")) return 80;
  if (t.includes("SMS") || t.includes("NOTIFICATION")) return 70;
  if (t.includes("PHISH") || t.includes("EMAIL")) return 65;
  return 50;
}
function selectEvidenceForPrompt(allEvidence) {
  const scored = allEvidence.map((e)=>{
    const pr = docTypePriorityForPrompt(e.verified_document_type ?? "OTHER");
    const conf = Number(e.extraction_confidence ?? 0);
    return {
      e,
      score: pr + conf * 10
    };
  }).sort((a, b)=>b.score - a.score);
  const chosen = [];
  const usedDocIds = new Set();
  for (const x of scored){
    if (chosen.length >= PROMPT_DOC_LIMIT) break;
    if (usedDocIds.has(x.e.document_id)) continue;
    usedDocIds.add(x.e.document_id);
    chosen.push({
      document_id: x.e.document_id,
      filename: x.e.filename,
      verified_document_type: x.e.verified_document_type,
      confidence: x.e.extraction_confidence,
      snippet: truncate(x.e.extracted_text ?? JSON.stringify(x.e.extracted_json ?? {}), PROMPT_DOC_SNIPPET)
    });
  }
  return chosen;
}
function extractTransactionsFromEvidence(e) {
  const out = [];
  const j = e.extracted_json;
  if (j && Array.isArray(j.transactions)) {
    for (const t of j.transactions){
      const amt = safeNumber(t?.amount);
      const cur = normalizeCurrency(t?.currency);
      const d = t?.date ? String(t.date).slice(0, 10) : null;
      out.push({
        date: d,
        amount: amt,
        currency: cur,
        merchant: t?.merchant ? String(t.merchant) : null,
        status: t?.status ? String(t.status) : null
      });
    }
  }
  return out;
}
function txnKey(t) {
  return [
    t.date ?? "",
    t.currency ?? "",
    String(t.amount ?? ""),
    (t.merchant ?? "").slice(0, 40).toUpperCase()
  ].join("|");
}
function isLikelyNoiseTxn(t) {
  // drop obvious non-unauthorized items if flagged
  const st = (t.status ?? "").toUpperCase();
  if (st.includes("DECLINED") || st.includes("REVERSED") || st.includes("REFUND")) return true;
  return false;
}
function scoreDocTypeForPolice(docType) {
  const t = normalizeDocType(docType);
  if (t.includes("POLICE")) return 30;
  if (t.includes("CYBER")) return 18;
  if (t.includes("BANK")) return 8; // sometimes police ref appears in bank comms
  return 0;
}
// TYPE-AWARE preference for FIRST REPORT to institution:
function scoreDocTypeForInstitutionFirstReport(docType) {
  const t = normalizeDocType(docType);
  // Strongly prefer comms + dispute forms for "first report" semantics
  if (t.includes("BANK_COMMS") || t.includes("BANK EMAIL") || t.includes("EMAIL") || t.includes("COMM")) return 28;
  if (t.includes("DISPUTE") || t.includes("FORM")) return 26;
  if (t.includes("FRAUD") || t.includes("SCAM") || t.includes("REPORT")) return 18;
  if (t.includes("STATEMENT")) return 6;
  // De-prioritise official response copies / investigation outcomes for "reported_to_institution_at"
  if (t.includes("OFFICIAL_RESPONSE") || t.includes("DECISION") || t.includes("OUTCOME")) return -6;
  return 0;
}
function scoreDocTypeForInstitutionFallback(docType) {
  const t = normalizeDocType(docType);
  if (t.includes("BANK")) return 14;
  if (t.includes("DISPUTE") || t.includes("FORM")) return 12;
  if (t.includes("EMAIL") || t.includes("COMM")) return 10;
  return 0;
}
// Extract a small "context window" around a keyword hit
function contextAround(text, idx, window = 160) {
  const start = Math.max(0, idx - window);
  const end = Math.min(text.length, idx + window);
  return text.slice(start, end);
}
// Date patterns we handle:
// - YYYY-MM-DD
// - DD/MM/YYYY
// - "16 octobre 2025" (French month) / "16 Oct 2025" / "16 October 2025"
const MONTHS = {
  JAN: 1,
  JANUARY: 1,
  JANVIER: 1,
  FEB: 2,
  FEBRUARY: 2,
  FEV: 2,
  FÉV: 2,
  FEVRIER: 2,
  FÉVRIER: 2,
  MAR: 3,
  MARCH: 3,
  MARS: 3,
  APR: 4,
  APRIL: 4,
  AVR: 4,
  AVRIL: 4,
  MAY: 5,
  MAI: 5,
  JUN: 6,
  JUNE: 6,
  JUIN: 6,
  JUL: 7,
  JULY: 7,
  JUIL: 7,
  JUILLET: 7,
  AUG: 8,
  AUGUST: 8,
  AOUT: 8,
  AOÛT: 8,
  SEP: 9,
  SEPT: 9,
  SEPTEMBER: 9,
  SEPTEMBRE: 9,
  OCT: 10,
  OCTOBER: 10,
  OCTOBRE: 10,
  NOV: 11,
  NOVEMBER: 11,
  NOVEMBRE: 11,
  DEC: 12,
  DECEMBER: 12,
  DÉC: 12,
  DECEMBRE: 12,
  DÉCEMBRE: 12
};
function parseBestDateFromContext(ctx) {
  const s = ctx;
  // ISO yyyy-mm-dd
  const mIso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (mIso) {
    const iso = `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
    return {
      iso,
      hasTime: false
    };
  }
  // dd/mm/yyyy
  const mDMY = s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (mDMY) {
    const dd = String(mDMY[1]).padStart(2, "0");
    const mm = String(mDMY[2]).padStart(2, "0");
    const yy = mDMY[3];
    return {
      iso: `${yy}-${mm}-${dd}`,
      hasTime: false
    };
  }
  // e.g. "16 octobre 2025" / "16 Oct 2025"
  const mWord = s.match(/\b(\d{1,2})\s+([A-Za-zÀ-ÿ\.]{3,})\s+(20\d{2})\b/);
  if (mWord) {
    const dd = String(mWord[1]).padStart(2, "0");
    const monRaw = String(mWord[2]).replace(/\./g, "").toUpperCase();
    const monKey = monRaw.length > 3 ? monRaw : monRaw; // allow short keys like OCT
    const mmNum = MONTHS[monKey] ?? MONTHS[monKey.slice(0, 3)];
    if (mmNum) {
      const mm = String(mmNum).padStart(2, "0");
      const yy = mWord[3];
      return {
        iso: `${yy}-${mm}-${dd}`,
        hasTime: false
      };
    }
  }
  return null;
}
function buildReportingCandidates(args) {
  const { allEvidence, mode } = args;
  const POLICE_KW = [
    "POLICE REPORT",
    "REPORT TO POLICE",
    "SPF",
    "SINGAPORE POLICE",
    "E/",
    "E-REPORT",
    "E REPORT",
    "POLICE CASE"
  ];
  // Institution: FIRST REPORT phrases (high priority)
  const INST_FIRST_REPORT_KW = [
    "WE RECEIVED YOUR SCAM REPORT",
    "WE HAVE RECEIVED YOUR SCAM REPORT",
    "WE RECEIVED YOUR REPORT",
    "THANK YOU FOR REPORTING",
    "YOUR SCAM REPORT",
    "SCAM REPORT SUBMITTED",
    "SUBMITTED",
    "SUBMISSION",
    "CASE CREATED",
    "REFERENCE NUMBER",
    "REFERENCE NO",
    "REF NO",
    "CONTACT US FORM",
    "REPORT RECEIVED",
    "DISPUTE SUBMITTED",
    "CHARGEBACK REQUEST",
    "TRANSACTION DISPUTE"
  ];
  // Institution: ACK / reply language (medium)
  const INST_ACK_KW = [
    "ACKNOWLEDG",
    "WE ARE WORKING ON YOUR",
    "WE ARE LOOKING INTO",
    "UNDER INVESTIGATION",
    "IN PROGRESS",
    "RECEIPT",
    "CONFIRMATION"
  ];
  // Institution: decision/outcome (low for reported_to_institution_at)
  const INST_DECISION_KW = [
    "DECISION",
    "OUTCOME",
    "FINAL",
    "REJECT",
    "DECLINE",
    "CLOSED",
    "CONCLUSION",
    "RESULT"
  ];
  const candidates = [];
  for (const e of allEvidence){
    const docType = normalizeDocType(e.verified_document_type);
    const text = String(e.extracted_text ?? e.extracted_json?.raw_text ?? "").trim();
    if (!text) continue;
    const upper = text.toUpperCase();
    const kwList = mode === "police" ? POLICE_KW : [
      ...INST_FIRST_REPORT_KW,
      ...INST_ACK_KW,
      ...INST_DECISION_KW
    ];
    for (const kw of kwList){
      const kwU = kw.toUpperCase();
      const idx = upper.indexOf(kwU);
      if (idx === -1) continue;
      const ctx = contextAround(text, idx, 220);
      const parsed = parseBestDateFromContext(ctx);
      if (!parsed) continue;
      let tier = "generic";
      let kwWeight = 0;
      if (mode === "police") {
        tier = "generic";
        kwWeight = 22;
      } else {
        if (INST_FIRST_REPORT_KW.some((x)=>kwU.includes(x.toUpperCase()) || kwU === x.toUpperCase())) {
          tier = "first_report";
          kwWeight = 35;
        } else if (INST_ACK_KW.some((x)=>kwU.includes(x.toUpperCase()) || kwU.startsWith(x.toUpperCase()))) {
          tier = "ack_or_reply";
          kwWeight = 14;
        } else if (INST_DECISION_KW.some((x)=>kwU.includes(x.toUpperCase()) || kwU.startsWith(x.toUpperCase()))) {
          tier = "decision_or_outcome";
          kwWeight = 4;
        } else {
          tier = "generic";
          kwWeight = 10;
        }
      }
      const typeScore = mode === "police" ? scoreDocTypeForPolice(docType) : tier === "first_report" ? scoreDocTypeForInstitutionFirstReport(docType) : scoreDocTypeForInstitutionFallback(docType);
      const confScore = Math.max(0, Math.min(1, Number(e.extraction_confidence ?? 0))) * 10;
      // slight bonus if keyword is earlier in the doc (subject lines etc)
      const positionBonus = Math.max(0, 8 - Math.floor(idx / 1200));
      const score = kwWeight + typeScore + confScore + positionBonus;
      candidates.push({
        iso: parsed.iso,
        hasTime: parsed.hasTime,
        score,
        document_id: e.document_id,
        filename: e.filename,
        doc_type: docType,
        keyword: kw,
        tier,
        context: truncate(ctx, 520)
      });
    }
  }
  return candidates;
}
function chooseReportingDate(args) {
  const { candidates, incidentISO, mode } = args;
  if (!candidates.length) return {
    iso: null,
    sources: [],
    debug: null
  };
  const incidentTime = incidentISO ? Date.parse(incidentISO) : null;
  // Filter obviously impossible dates if incident is known
  const plausible = candidates.filter((c)=>{
    const t = Date.parse(c.iso);
    if (Number.isNaN(t)) return false;
    if (incidentTime === null) return true;
    // allow same-day and after; also allow 1-day-before (timezones / formatting)
    return t >= incidentTime - 24 * 3600 * 1000;
  });
  const pool = plausible.length ? plausible : candidates;
  if (mode === "institution") {
    // FIRST: if any first_report candidates exist, choose EARLIEST date (>= incident) among them.
    const first = pool.filter((c)=>c.tier === "first_report");
    if (first.length) {
      const sorted = first.slice().sort((a, b)=>{
        const ta = Date.parse(a.iso);
        const tb = Date.parse(b.iso);
        if (ta !== tb) return ta - tb; // earliest first
        return b.score - a.score; // tie-breaker
      });
      const chosen = sorted[0];
      return {
        iso: chosen.iso,
        sources: [
          chosen
        ],
        debug: {
          strategy: "first_report_earliest",
          candidateCount: pool.length,
          firstReportCount: first.length,
          topScore: Math.max(...first.map((x)=>x.score)),
          chosen
        }
      };
    }
    // SECOND: if only ack/reply candidates exist, choose earliest among them (still closer to "first report")
    const ack = pool.filter((c)=>c.tier === "ack_or_reply");
    if (ack.length) {
      const sorted = ack.slice().sort((a, b)=>{
        const ta = Date.parse(a.iso);
        const tb = Date.parse(b.iso);
        if (ta !== tb) return ta - tb;
        return b.score - a.score;
      });
      const chosen = sorted[0];
      return {
        iso: chosen.iso,
        sources: [
          chosen
        ],
        debug: {
          strategy: "ack_earliest",
          candidateCount: pool.length,
          ackCount: ack.length,
          topScore: Math.max(...ack.map((x)=>x.score)),
          chosen
        }
      };
    }
    // LAST: fallback to best score (decision/outcome etc)
    const sorted = pool.slice().sort((a, b)=>b.score - a.score);
    const chosen = sorted[0];
    return {
      iso: chosen.iso,
      sources: [
        chosen
      ],
      debug: {
        strategy: "fallback_top_score",
        candidateCount: pool.length,
        topScore: chosen.score,
        chosen
      }
    };
  }
  // Police: highest score
  const sorted = pool.slice().sort((a, b)=>b.score - a.score);
  const chosen = sorted[0];
  return {
    iso: chosen.iso,
    sources: [
      chosen
    ],
    debug: {
      strategy: "police_top_score",
      candidateCount: pool.length,
      topScore: chosen.score,
      chosen
    }
  };
}
/* =========================================================
   SERVER FACTS COMPUTE
   ========================================================= */ function guessInstitutionName(allEvidence) {
  const hits = [];
  const patterns = [
    {
      re: /\bDBS\b|\bPOSB\b|\bDBS\/POSB\b/gi,
      name: "DBS/POSB",
      score: 20
    },
    {
      re: /\bOCBC\b/gi,
      name: "OCBC",
      score: 18
    },
    {
      re: /\bUOB\b/gi,
      name: "UOB",
      score: 18
    },
    {
      re: /\bCITI\b|\bCITIBANK\b/gi,
      name: "Citibank",
      score: 16
    }
  ];
  for (const e of allEvidence){
    const text = String(e.extracted_text ?? "").slice(0, 6000);
    if (!text) continue;
    for (const p of patterns){
      const m = text.match(p.re);
      if (m && m.length) {
        hits.push({
          name: p.name,
          score: p.score + Math.min(12, m.length * 2) + Math.min(10, (e.extraction_confidence ?? 0) * 10),
          doc: e,
          ctx: truncate(text, 320)
        });
      }
    }
  }
  if (!hits.length) return {
    name: null,
    sources: []
  };
  hits.sort((a, b)=>b.score - a.score);
  const top = hits[0];
  return {
    name: top.name,
    sources: [
      {
        document_id: top.doc.document_id,
        filename: top.doc.filename,
        doc_type: normalizeDocType(top.doc.verified_document_type),
        context: top.ctx
      }
    ]
  };
}
function computeReportedLoss(allEvidence, caseCurrency, claimAmount) {
  // 1) Try sum of txns (dedupe + filter)
  const txns = [];
  for (const e of allEvidence)txns.push(...extractTransactionsFromEvidence(e));
  const dropped = [];
  const seen = new Set();
  const kept = [];
  for (const t of txns){
    if (isLikelyNoiseTxn(t)) {
      dropped.push(t);
      continue;
    }
    const k = txnKey(t);
    if (seen.has(k)) {
      dropped.push(t);
      continue;
    }
    seen.add(k);
    kept.push(t);
  }
  const totals = {};
  for (const t of kept){
    const cur = normalizeCurrency(t.currency) ?? caseCurrency ?? "UNKNOWN";
    const amt = safeNumber(t.amount);
    if (!amt) continue;
    totals[cur] = (totals[cur] ?? 0) + amt;
  }
  let bestCur = caseCurrency ?? null;
  if (!bestCur || bestCur === "UNKNOWN") {
    const entries = Object.entries(totals).sort((a, b)=>b[1] - a[1]);
    bestCur = entries[0]?.[0] ?? null;
  }
  const sum = bestCur ? totals[bestCur] ?? 0 : 0;
  // 2) If claimAmount exists and seems more reliable (e.g., non-zero), prefer it as amount override
  const finalAmt = (claimAmount && claimAmount > 0 ? claimAmount : null) ?? (sum > 0 ? sum : null);
  return {
    reported_loss: {
      amount: finalAmt,
      currency: normalizeCurrency(bestCur) ?? normalizeCurrency(caseCurrency) ?? null,
      source: claimAmount && claimAmount > 0 ? "case_claim_amount" : sum > 0 ? "sum_transactions_deduped_filtered" : "unknown"
    },
    txn_totals_by_currency: totals,
    txn_unique_count: kept.length,
    txn_dropped_count: dropped.length
  };
}
function computeServerFacts(allEvidence, caseCurrency, claimAmount, incidentISO) {
  const inst = guessInstitutionName(allEvidence);
  const loss = computeReportedLoss(allEvidence, caseCurrency, claimAmount);
  // Reporting dates from ALL docs
  const policeCandidates = buildReportingCandidates({
    allEvidence,
    mode: "police"
  });
  const policeChosen = chooseReportingDate({
    candidates: policeCandidates,
    incidentISO,
    mode: "police"
  });
  const instCandidates = buildReportingCandidates({
    allEvidence,
    mode: "institution"
  });
  const instChosen = chooseReportingDate({
    candidates: instCandidates,
    incidentISO,
    mode: "institution"
  });
  return {
    institution_name_guess: inst.name,
    institution_name_sources: inst.sources,
    reported_loss: loss.reported_loss,
    reported_loss_sources: [],
    txn_totals_by_currency: loss.txn_totals_by_currency,
    txn_unique_count: loss.txn_unique_count,
    txn_dropped_count: loss.txn_dropped_count,
    txn_count_seen: Object.values(loss.txn_totals_by_currency).length,
    reported_to_police_at: policeChosen.iso,
    reported_to_police_sources: policeChosen.sources,
    reported_to_institution_at: instChosen.iso,
    reported_to_institution_sources: instChosen.sources,
    debug_reporting: {
      police: policeChosen.debug,
      institution: instChosen.debug
    }
  };
}
/* =========================================================
   POSTPROCESS: validator compat + enforce server facts
   ========================================================= */ const ALLOWED_INCIDENT_CHANNELS = new Set([
  "sms",
  "phone_call",
  "whatsapp",
  "telegram",
  "email",
  "website",
  "banking_app"
]);
const ALLOWED_SPOOFING_STATUS = new Set([
  "yes",
  "no",
  "unknown"
]);
const ALLOWED_SPOOFING_TYPE = new Set([
  "sms",
  "phone_call"
]);
function mergeStructuredMissingFacts(ej) {
  const mf = ej.evidence_status.missing_facts;
  if (!Array.isArray(mf)) return;
  const add = (path)=>{
    if (!mf.includes(path)) mf.push(path);
  };
  if (ej?.case_meta?.institution_name == null) add("case_meta.institution_name");
  const ch = ej?.incident?.channel;
  if (ch == null) add("incident.channel");
  if (ej?.transaction?.disputed_merchant == null) add("transaction.disputed_merchant");
  const sp = ej?.incident?.spoofing_indicator?.status;
  if ((ch === "sms" || ch === "phone_call") && sp === "unknown") add("incident.spoofing_indicator.status");
}
function applyValidationCompatibilityAndEnforce(ejRaw, serverFacts, caseRecord) {
  const ej = ejRaw && typeof ejRaw === "object" ? ejRaw : {};
  // Ensure required objects exist
  ej.timeline = ej.timeline ?? {};
  ej.case_meta = ej.case_meta ?? {};
  ej.incident = ej.incident && typeof ej.incident === "object" ? ej.incident : {};
  ej.incident.spoofing_indicator = ej.incident.spoofing_indicator && typeof ej.incident.spoofing_indicator === "object" ? ej.incident.spoofing_indicator : {};
  ej.transaction = ej.transaction && typeof ej.transaction === "object" ? ej.transaction : {};
  ej.evidence_status = ej.evidence_status ?? {};
  ej.customer_actions = ej.customer_actions ?? {};
  ej.institution_actions = ej.institution_actions ?? {};
  // Validator compatibility keys:
  // incident_date (YYYY-MM-DD)
  const incidentAt = ej?.timeline?.incident_at ?? null;
  if (incidentAt && typeof incidentAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(incidentAt)) {
    ej.incident_date = incidentAt.slice(0, 10);
  } else {
    ej.incident_date = null;
  }
  // reported_loss: ensure object exists
  ej.reported_loss = ej.reported_loss ?? {
    amount: null,
    currency: null
  };
  // Enforce server facts
  const sLossAmt = safeNumber(serverFacts?.reported_loss?.amount);
  if (sLossAmt !== null) ej.reported_loss.amount = sLossAmt;
  const sLossCur = normalizeCurrency(serverFacts?.reported_loss?.currency);
  if (sLossCur) ej.reported_loss.currency = sLossCur;
  if (serverFacts?.institution_name_guess) {
    // Only fill if missing
    if (!ej.case_meta.institution_name) ej.case_meta.institution_name = serverFacts.institution_name_guess;
  }
  // case_meta.institution_name: string | null
  if (ej.case_meta.institution_name != null) {
    if (typeof ej.case_meta.institution_name === "string") {
      const t = ej.case_meta.institution_name.trim();
      ej.case_meta.institution_name = t || null;
    } else {
      ej.case_meta.institution_name = null;
    }
  }
  // case_meta claim fields: normalize types (consistent with reported_loss handling)
  ej.case_meta.claim_amount = safeNumber(ej.case_meta.claim_amount);
  ej.case_meta.claim_currency = normalizeCurrency(ej.case_meta.claim_currency);
  if (caseRecord) {
    const rowAmt = safeNumber(caseRecord.claim_amount);
    const rowCur = normalizeCurrency(caseRecord.claim_currency);
    if (rowAmt !== null) ej.case_meta.claim_amount = rowAmt;
    if (rowCur) ej.case_meta.claim_currency = rowCur;
  }
  // incident.channel
  if (typeof ej.incident.channel === "string") {
    const c = ej.incident.channel.trim().toLowerCase().replace(/[\s-]+/g, "_");
    ej.incident.channel = ALLOWED_INCIDENT_CHANNELS.has(c) ? c : null;
  } else {
    ej.incident.channel = null;
  }
  // incident.spoofing_indicator
  const si = ej.incident.spoofing_indicator;
  si.status = ALLOWED_SPOOFING_STATUS.has(si.status) ? si.status : "unknown";
  si.type = ALLOWED_SPOOFING_TYPE.has(si.type) ? si.type : null;
  if (ej.incident.channel !== "sms" && ej.incident.channel !== "phone_call") si.type = null;
  else if (ej.incident.channel === "sms" && si.type === "phone_call") si.type = null;
  else if (ej.incident.channel === "phone_call" && si.type === "sms") si.type = null;
  if (!Array.isArray(si.basis)) si.basis = [];
  si.basis = si.basis.filter((x)=>typeof x === "string").map((s)=>s.trim()).filter(Boolean);
  // transaction.disputed_merchant
  if (typeof ej.transaction.disputed_merchant === "string") {
    const m = ej.transaction.disputed_merchant.trim();
    ej.transaction.disputed_merchant = m || null;
  } else {
    ej.transaction.disputed_merchant = null;
  }
  if (serverFacts?.reported_to_police_at) {
    ej.timeline.reported_to_police_at = serverFacts.reported_to_police_at;
  }
  if (serverFacts?.reported_to_institution_at) {
    ej.timeline.reported_to_institution_at = serverFacts.reported_to_institution_at;
  }
  // loss list: keep as model-provided; but if empty, we can provide a single summary loss item
  if (!Array.isArray(ej.losses)) ej.losses = [];
  if (ej.losses.length === 0 && sLossAmt !== null && (ej.reported_loss.currency || sLossCur)) {
    ej.losses = [
      {
        amount: sLossAmt,
        currency: ej.reported_loss.currency ?? sLossCur ?? null,
        description: "Total loss (server-computed)."
      }
    ];
  }
  // evidence_status defaults
  if (typeof ej.evidence_status.confidence !== "number") ej.evidence_status.confidence = 0.5;
  if (!Array.isArray(ej.evidence_status.missing_facts)) ej.evidence_status.missing_facts = [];
  if (!Array.isArray(ej.evidence_status.documents_missing)) ej.evidence_status.documents_missing = [];
  if (!Array.isArray(ej.evidence_status.documents_present)) ej.evidence_status.documents_present = [];
  mergeStructuredMissingFacts(ej);
  return ej;
}
/* =========================================================
   MAIN
   ========================================================= */ serve(async (req)=>{
  const request_id = crypto.randomUUID();
  const { stage, marks, mark } = createStageMarker();
  try {
    mark("01_env");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction");
    const EXTRACT_MODEL = Deno.env.get("CASE_EXTRACT_MODEL") ?? "gpt-4.1-mini";
    if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
    if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    if (!OPENAI_API_KEY) throw new Error("Missing GuideBuoy_EdgeFunction secret");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Healthcheck
    if (req.method === "GET") return jsonResp({
      ok: true,
      version: VERSION,
      request_id
    }, 200);
    // Parse request
    mark("02_parse");
    if (req.method !== "POST") {
      return jsonResp({
        ok: false,
        version: VERSION,
        request_id,
        stage,
        error: "POST only"
      }, 405);
    }
    const body = await req.json().catch(()=>({}));
    const case_id = body.case_id;
    const skip_validation = body.skip_validation === true;
    if (!case_id) return jsonResp({
      ok: false,
      version: VERSION,
      request_id,
      stage,
      error: "Missing case_id"
    }, 400);
    // Fetch case
    mark("03_case");
    const caseRes = await supabase.from("cases").select("*").eq("id", case_id).single();
    const caseData = ensureOk(caseRes.data, caseRes.error, "Fetch cases row");
    // Latest intake
    mark("04_intake");
    const intakeRes = await supabase.from("case_intake").select("*").eq("case_id", case_id).order("version", {
      ascending: false
    }).order("created_at", {
      ascending: false
    }).limit(1);
    ensureOk(intakeRes.data, intakeRes.error, "Fetch latest case_intake");
    const intake = intakeRes.data?.[0] ?? null;
    // Latest narrative (optional)
    mark("05_narrative");
    const narrativeRes = await supabase.from("case_narratives").select("*").eq("case_id", case_id).order("created_at", {
      ascending: false
    }).limit(1);
    if (narrativeRes.error) console.log("[WARN] narrative fetch", JSON.stringify(normalizePgError(narrativeRes.error)));
    const narrative = narrativeRes.data?.[0] ?? null;
    // Evidence: ALL docs (compute) + curated subset (prompt)
    mark("06_evidence_all_start");
    const allEvidence = await fetchAllEvidenceSignals(supabase, case_id);
    mark("06_evidence_all_ok", {
      all_unique_docs: allEvidence.length
    });
    const caseCur = normalizeCurrency(caseData?.claim_currency);
    const claimAmt = safeNumber(caseData?.claim_amount);
    const incidentISO = parseIncidentISO(caseData);
    mark("06b_server_compute_start");
    const serverFacts = computeServerFacts(allEvidence, caseCur, claimAmt, incidentISO);
    mark("06b_server_compute_ok", {
      institution_name_guess: serverFacts.institution_name_guess,
      reported_loss: serverFacts.reported_loss,
      reported_to_police_at: serverFacts.reported_to_police_at,
      reported_to_institution_at: serverFacts.reported_to_institution_at
    });
    mark("06c_evidence_prompt_select_start");
    const evidenceForPrompt = selectEvidenceForPrompt(allEvidence);
    mark("06c_evidence_prompt_select_ok", {
      prompt_docs: evidenceForPrompt.length
    });
    // Build template + OpenAI input
    mark("07_build_input");
    const schemaTemplate = {
      losses: [],
      timeline: {
        incident_at: caseData.incident_date ?? null,
        discovered_at: null,
        reported_to_police_at: null,
        reported_to_institution_at: null
      },
      case_meta: {
        claim_type: caseData.claim_type ?? null,
        claim_amount: caseData.claim_amount ?? null,
        jurisdiction: caseData.jurisdiction ?? null,
        claim_currency: caseData.claim_currency ?? null,
        institution_name: caseData.institution_name ?? null
      },
      incident: {
        channel: null,
        spoofing_indicator: {
          status: "unknown",
          type: null,
          basis: []
        }
      },
      transaction: {
        disputed_merchant: null
      },
      evidence_status: {
        confidence: 0.5,
        missing_facts: [],
        documents_missing: [],
        documents_present: evidenceForPrompt.map((d)=>`${d.verified_document_type ?? "UNKNOWN"}: ${d.filename ?? d.document_id}`)
      },
      customer_actions: {
        shared_otp: null,
        provided_credentials: null,
        clicked_phishing_link: null,
        approved_push_notification: null,
        installed_remote_access_software: null
      },
      institution_actions: {
        payee_added: null,
        limits_changed: null,
        step_up_authentication_used: null,
        transaction_block_attempted: null
      },
      // validator compat keys
      incident_date: null,
      reported_loss: {
        amount: null,
        currency: null
      }
    };
    const inputText = [
      `CASE: ${JSON.stringify(caseData)}`,
      `INTAKE: ${JSON.stringify(intake)}`,
      `NARRATIVE: ${JSON.stringify(narrative)}`,
      `EVIDENCE_DIGEST: ${JSON.stringify(evidenceForPrompt)}`
    ].join("\n\n");
    mark("08_openai_start", {
      input_len: inputText.length
    });
    const ejRaw = await openaiExtract({
      openaiKey: OPENAI_API_KEY,
      model: EXTRACT_MODEL,
      template: schemaTemplate,
      inputText,
      serverComputed: serverFacts
    });
    mark("08_openai_ok");
    // Post-process + enforce server facts + insert extract_run
    mark("09_postprocess");
    const ej = applyValidationCompatibilityAndEnforce(ejRaw, serverFacts, caseData);
    // Required list (for case_extract_runs.missing_fields)
    const missing_fields = [];
    const requiredFields = [
      [
        "incident_date",
        ej.incident_date
      ],
      [
        "reported_loss.amount",
        ej?.reported_loss?.amount
      ],
      [
        "case_meta.institution_name",
        ej?.case_meta?.institution_name
      ]
    ];
    for (const [k, v] of requiredFields)if (v === null || v === undefined) missing_fields.push(k);
    mark("09_insert_extract_run_start");
    const runIns = await supabase.from("case_extract_runs").insert({
      case_id,
      extract_json: ej,
      missing_fields,
      model_name: EXTRACT_MODEL,
      prompt_version: VERSION,
      intake_id: intake?.id ?? null
    }).select("*").single();
    const extract_run = ensureOk(runIns.data, runIns.error, "Insert case_extract_runs");
    mark("09_insert_extract_run_ok", {
      extract_run_id: extract_run.id
    });
    // Atomic RPC wrapper (NO schema prefix)
    mark("10_rpc_start", {
      skip_validation
    });
    const evidence_docs_used_unique = Array.from(new Set((evidenceForPrompt ?? []).map((d)=>String(d.document_id)).filter(Boolean)));
    if (skip_validation) {
      mark("10_rpc_skipped");
      return jsonResp({
        ok: true,
        version: VERSION,
        request_id,
        stage,
        extract_run,
        validation_run_id: null,
        rpc_error: null,
        evidence_docs_used: evidence_docs_used_unique,
        server_computed: serverFacts,
        debug_counts: {
          all_unique_docs: allEvidence.length,
          prompt_docs: evidenceForPrompt.length
        },
        warning: "Validation skipped (skip_validation=true)."
      }, 200);
    }
    const rpcRes = await supabase.rpc("run_validation_v1", {
      p_extract_run_id: extract_run.id
    });
    console.log("RPC RAW:", JSON.stringify({
      status: rpcRes?.status,
      statusText: rpcRes?.statusText,
      data: rpcRes.data,
      error: normalizePgError(rpcRes.error)
    }));
    if (rpcRes.error) {
      mark("10_rpc_failed", {
        rpc_error: normalizePgError(rpcRes.error)
      });
      return jsonResp({
        ok: true,
        version: VERSION,
        request_id,
        stage,
        extract_run,
        validation_run_id: null,
        rpc_error: normalizePgError(rpcRes.error),
        evidence_docs_used: evidence_docs_used_unique,
        server_computed: serverFacts,
        debug_counts: {
          all_unique_docs: allEvidence.length,
          prompt_docs: evidenceForPrompt.length
        },
        warning: "Extraction succeeded but validation RPC failed or timed out."
      }, 200);
    }
    if (!rpcRes.data) {
      mark("10_rpc_failed", {
        rpc_error: {
          message: "RPC returned null validation_run_id"
        }
      });
      return jsonResp({
        ok: true,
        version: VERSION,
        request_id,
        stage,
        extract_run,
        validation_run_id: null,
        rpc_error: {
          message: "RPC returned null validation_run_id"
        },
        evidence_docs_used: evidence_docs_used_unique,
        server_computed: serverFacts,
        debug_counts: {
          all_unique_docs: allEvidence.length,
          prompt_docs: evidenceForPrompt.length
        },
        warning: "Extraction succeeded but validation returned null."
      }, 200);
    }
    mark("10_rpc_ok", {
      validation_run_id: rpcRes.data
    });
    return jsonResp({
      ok: true,
      version: VERSION,
      request_id,
      stage,
      extract_run,
      validation_run_id: rpcRes.data,
      rpc_error: null,
      evidence_docs_used: evidence_docs_used_unique,
      server_computed: serverFacts,
      debug_counts: {
        all_unique_docs: allEvidence.length,
        prompt_docs: evidenceForPrompt.length
      },
      debug_marks: marks
    }, 200);
  } catch (e) {
    const details = normalizeError(e);
    console.log("[ERROR]", JSON.stringify({
      request_id,
      version: VERSION,
      stage,
      details
    }));
    return jsonResp({
      ok: false,
      version: VERSION,
      request_id,
      stage,
      error: details
    }, 500);
  }
});
