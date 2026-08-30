import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import {
  authorizeHarborEdgeRequest,
  HarborEdgeAuthError,
  verifyHarborEdgeRequest,
} from "../_shared/edge-auth.ts";
// ==================== EVIDENCE TYPES (EXACTLY YOUR LIST) ====================
const EVIDENCE_TYPES = [
  "PHISHING_EMAIL_COPY_OR_DESCRIPTION",
  "BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS",
  "CREDIT_CARD_STATEMENT_SHOWING_TRANSACTIONS",
  "SMS_LOG_ALL_TRANSACTION_NOTIFICATIONS",
  "SMS_LOG_TOKEN_BINDING_NOTIFICATIONS",
  "SMS_LOG_BANK_ACCOUNT_LIMIT_NOTIFICATIONS",
  "SMS_LOG_CREDIT_CARD_BLOCKING_NOTIFICATIONS",
  "BANK_SCAM_FRAUD_HOTLINE_CALL_LOG",
  "BANK_SCAM_FRAUD_HOTLINE_CALL_RECORDING",
  "POLICE_REPORT_OF_FRAUD_SCAM",
  "TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK",
  "BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY",
  "BANK_SRF_INVESTIGATION_REPORT_OR_OFFICIAL_RESPONSE",
  "BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL",
  "RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA",
  "TIMELINE_NOTES",
  "CYBER_EXPERT_REPORT",
  "OTHER"
];
const ALLOWED_TYPES = new Set(EVIDENCE_TYPES);
function normalizeEvidenceType(t) {
  const s = String(t ?? "OTHER").trim().toUpperCase();
  return ALLOWED_TYPES.has(s) ? s : "OTHER";
}
/**
 * Optional bridge while your UI still has older short enums.
 * If declared already matches the new enum, it passes through.
 * If declared is a legacy value, we map conservatively.
 */ function mapDeclaredToEvidenceType(declared) {
  if (declared == null) return null;
  const s = String(declared).trim().toUpperCase();
  if (!s) return null;
  // Already in new enum?
  if (ALLOWED_TYPES.has(s)) return s;
  // Common legacy mappings (conservative)
  const legacyMap = {
    // old buckets
    "BANK_STATEMENT": "BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS",
    "ACCOUNT_STATEMENT": "BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS",
    "CREDIT_CARD_STATEMENT": "CREDIT_CARD_STATEMENT_SHOWING_TRANSACTIONS",
    "POLICE_REPORT": "POLICE_REPORT_OF_FRAUD_SCAM",
    "CYBER_REPORT": "CYBER_EXPERT_REPORT",
    "DISPUTE_FORM": "TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK",
    "DISPUTE_REPORT": "TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK",
    "BANK_COMMS": "BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL",
    "BANK_EMAILS": "BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL",
    "EMAIL": "BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL",
    "USER_LOGS": "RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA",
    "LOGIN_LOGS": "RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA",
    "IP_LOGS": "RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA",
    // very ambiguous legacy bucket; keep conservative
    "FRAUD_SCREENSHOTS": "PHISHING_EMAIL_COPY_OR_DESCRIPTION"
  };
  return legacyMap[s] ?? null;
}
function mapToDutyCategory(type) {
  if (type === "SMS_LOG_ALL_TRANSACTION_NOTIFICATIONS" || type === "SMS_LOG_TOKEN_BINDING_NOTIFICATIONS" || type === "SMS_LOG_BANK_ACCOUNT_LIMIT_NOTIFICATIONS" || type === "SMS_LOG_CREDIT_CARD_BLOCKING_NOTIFICATIONS") return "FI_NOTIFICATION_DUTY";
  if (type === "BANK_SCAM_FRAUD_HOTLINE_CALL_LOG" || type === "BANK_SCAM_FRAUD_HOTLINE_CALL_RECORDING") return "FI_RESPONSE_DUTY";
  if (type === "BANK_SRF_INVESTIGATION_REPORT_OR_OFFICIAL_RESPONSE" || type === "BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY") return "FI_INVESTIGATION_DUTY";
  if (type === "RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA") return "FI_MONITORING_DUTY";
  if (type === "PHISHING_EMAIL_COPY_OR_DESCRIPTION") return "SCAM_ORIGIN_EVIDENCE";
  if (type === "POLICE_REPORT_OF_FRAUD_SCAM") return "LAW_ENFORCEMENT_EVIDENCE";
  if (type === "TIMELINE_NOTES") return "USER_ASSERTION_EVIDENCE";
  if (type === "CYBER_EXPERT_REPORT") return "EXPERT_EVIDENCE";
  return "GENERAL";
}
function computeTierFlags(type) {
  const critical = [
    "BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS",
    "CREDIT_CARD_STATEMENT_SHOWING_TRANSACTIONS",
    "POLICE_REPORT_OF_FRAUD_SCAM",
    "RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA",
    "TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK"
  ].includes(type);
  const escalation_grade = [
    "BANK_SRF_INVESTIGATION_REPORT_OR_OFFICIAL_RESPONSE",
    "BANK_SCAM_FRAUD_HOTLINE_CALL_RECORDING",
    "CYBER_EXPERT_REPORT",
    "BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY"
  ].includes(type);
  return {
    critical,
    escalation_grade
  };
}
// -------------------- Helpers --------------------
function log(stage, payload) {
  if (payload === undefined) console.log(`[${stage}]`);
  else console.log(`[${stage}]`, payload);
}
function toBase64(bytes) {
  if (bytes.toBase64) return bytes.toBase64();
  let binary = "";
  const chunkSize = 0x8000;
  for(let i = 0; i < bytes.length; i += chunkSize){
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
function safeParseGeminiJson(text) {
  const candidate = extractFirstJsonObject(text) ?? text;
  try {
    const obj = JSON.parse(candidate);
    return obj ?? {};
  } catch  {
    return {
      raw_text: text,
      predicted_document_type: "OTHER",
      confidence: null,
      evidence_spans: []
    };
  }
}
function decideVerification(declared, predicted, confidence) {
  const d = (declared ?? "").trim().toUpperCase();
  const p = (predicted ?? "").trim().toUpperCase();
  const c = typeof confidence === "number" ? confidence : 0;
  if (!d) return {
    decision: "needs_review",
    reason: "No declared document_type set"
  };
  if (!p) return {
    decision: "needs_review",
    reason: "No predicted_document_type returned"
  };
  if (d === p && c >= 0.8) return {
    decision: "accepted",
    reason: "Declared matches predicted with high confidence"
  };
  if (d !== p && c >= 0.8) return {
    decision: "rejected",
    reason: "Declared mismatches predicted with high confidence"
  };
  return {
    decision: "needs_review",
    reason: "Low confidence or ambiguous match"
  };
}
function chunkText(raw, targetChars = 1100) {
  const text = (raw ?? "").toString().trim();
  if (!text) return [];
  const paras = text.split(/\n\s*\n/g).map((p)=>p.trim()).filter(Boolean);
  const units = paras.length ? paras : text.split(/\n/g).map((p)=>p.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  for (const u of units){
    if (!u) continue;
    if (buf && buf.length + 2 + u.length > targetChars && buf.length >= 250) {
      chunks.push(buf.trim());
      buf = u;
    } else {
      buf = buf ? `${buf}\n\n${u}` : u;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}
function sniffMime(bytes, filename, existingMime) {
  const m = (existingMime ?? "").toLowerCase().trim();
  if (m && m !== "application/octet-stream") return m;
  // PDF: %PDF
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }
  // PNG
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  // JPEG
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  // Fallback by extension
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  // Safe default
  return "image/jpeg";
}
async function getExistingContentId(args) {
  const { supabase, document_id, model, prompt_version, pipeline_version } = args;
  const r = await supabase.from("case_documents_content").select("id").eq("document_id", document_id).eq("model", model).eq("prompt_version", prompt_version).eq("pipeline_version", pipeline_version).order("id", {
    ascending: false
  }).limit(1).maybeSingle();
  if (!r) throw new Error("Existing content lookup returned undefined");
  if (r.error) throw new Error(`Existing content lookup failed: ${r.error.message}`);
  return r.data?.id ?? null;
}
async function loadContentRow(args) {
  const { supabase, content_id } = args;
  const r = await supabase.from("case_documents_content").select("text_content, content_json").eq("id", content_id).single();
  if (!r) throw new Error("Content row read returned undefined");
  if (r.error || !r.data) throw new Error(`Failed to read content row: ${r.error?.message ?? "unknown"}`);
  const cj = r.data.content_json;
  if (cj && typeof cj === "object") {
    const parsed = cj;
    const rawText = String(parsed.raw_text ?? r.data.text_content ?? "");
    return {
      parsed,
      rawText
    };
  }
  const txt = String(r.data.text_content ?? "");
  const parsed = safeParseGeminiJson(txt);
  const rawText = String(parsed.raw_text ?? txt);
  return {
    parsed,
    rawText
  };
}
function evidenceTypesBullets() {
  return EVIDENCE_TYPES.join("\n");
}
function evidenceDefinitionsBlock() {
  // Keep it short but explicit so Gemini is less likely to confuse SMS types.
  return `
- PHISHING_EMAIL_COPY_OR_DESCRIPTION: phishing email content or a written description of it.
- BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS: bank account statement showing transfers/transactions.
- CREDIT_CARD_STATEMENT_SHOWING_TRANSACTIONS: credit card statement showing card transactions.
- SMS_LOG_ALL_TRANSACTION_NOTIFICATIONS: SMS messages notifying of transactions.
- SMS_LOG_TOKEN_BINDING_NOTIFICATIONS: SMS about device/token binding.
- SMS_LOG_BANK_ACCOUNT_LIMIT_NOTIFICATIONS: SMS about bank account limit changes.
- SMS_LOG_CREDIT_CARD_BLOCKING_NOTIFICATIONS: SMS about credit card blocking by the bank.
- BANK_SCAM_FRAUD_HOTLINE_CALL_LOG: call log/history details (date/time/duration).
- BANK_SCAM_FRAUD_HOTLINE_CALL_RECORDING: audio recording or transcript of hotline call.
- POLICE_REPORT_OF_FRAUD_SCAM: police report or reference for the scam.
- TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK: dispute form/report submitted to the bank.
- BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY: bank’s official dispute outcome response.
- BANK_SRF_INVESTIGATION_REPORT_OR_OFFICIAL_RESPONSE: bank SRF investigation report or official SRF response.
- BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL: other bank emails/comms not covered above.
- RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA: raw login logs, IP logs, session/device information.
- TIMELINE_NOTES: user timeline notes/narrative.
- CYBER_EXPERT_REPORT: report by cyber/security expert.
`.trim();
}

/** Default model for document classification. Override with secret `EVIDENCE_GEMINI_MODEL` after deploy. */
const DEFAULT_EVIDENCE_GEMINI_MODEL = Deno.env.get("EVIDENCE_GEMINI_MODEL") ?? "gemini-2.5-flash";

function isRetryableGeminiError(status: number, bodyText: string): boolean {
  if (status === 429 || status === 503) return true;
  const lower = bodyText.toLowerCase();
  if (lower.includes("resource_exhausted") || lower.includes("resource exhausted")) return true;
  if (lower.includes("quota") && lower.includes("exceeded")) return true;
  try {
    const j = JSON.parse(bodyText) as { error?: { status?: string; code?: number; message?: string } };
    if (j?.error?.status === "RESOURCE_EXHAUSTED") return true;
    if (j?.error?.code === 429) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** REST `generateContent` with backoff on rate limits / RESOURCE_EXHAUSTED (aligned with SDK retry semantics). */
async function geminiGenerateContentWithRetry(args: {
  endpoint: string;
  requestBody: string;
  /** Total attempts = 1 + retries (default 3 retries → 4 attempts). */
  retries?: number;
  initialDelayMs?: number;
}) {
  const { endpoint, requestBody } = args;
  let attemptsLeft = (args.retries ?? 3) + 1;
  let delayMs = args.initialDelayMs ?? 6500;

  while (attemptsLeft > 0) {
    attemptsLeft--;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });
    const rawErr = !resp.ok ? await resp.text().catch(() => "") : null;

    if (resp.ok) {
      return resp.json();
    }

    if (attemptsLeft > 0 && isRetryableGeminiError(resp.status, rawErr ?? "")) {
      console.warn(
        `[evidence_processed_v2] Gemini overloaded (${resp.status}). Retrying in ${delayMs / 1000}s… (${attemptsLeft} attempt(s) left)`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.floor(delayMs * 1.5);
      continue;
    }

    throw new Error(`Gemini failed: ${resp.status} ${rawErr ?? ""}`.trim());
  }

  throw new Error("Gemini failed after retries");
}

async function runGemini(args) {
  const { geminiKey, model, mime_type, base64, declared_document_type, file_name } = args;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const geminiPrompt = `
You are an evidence classifier for a financial scam dispute case.

Classify this document into EXACTLY ONE of the following evidence types:
${evidenceTypesBullets()}

Definitions:
${evidenceDefinitionsBlock()}

Your job:
1) Extract readable text as "raw_text" (preserve numbers exactly).
2) Choose EXACTLY ONE predicted_document_type from the list above.
3) Provide confidence score 0..1.
4) Provide 3-6 evidence_spans short quotes that justify the predicted type (include page if you can infer, else null).
5) If transaction-like entries exist, extract them into "transactions".

Return STRICT JSON only (no markdown, no commentary):
{
  "predicted_document_type": "TYPE_FROM_LIST",
  "confidence": 0.0,
  "evidence_spans": [{"quote":"...", "page": 1}],
  "raw_text": "...",
  "transactions": [{"date":"YYYY-MM-DD or null","merchant":"string or null","amount":123.45,"currency":"SGD|AUD|USD|... or null","status":"string or null"}],
  "notes": "optional"
}

Declared document_type from UI (may be wrong): ${(declared_document_type ?? "UNKNOWN").toString()}
File name: ${file_name}
`.trim();
  const requestBody = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: geminiPrompt,
          },
          {
            inline_data: {
              mime_type,
              data: base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: "application/json",
    },
  });

  const j = await geminiGenerateContentWithRetry({ endpoint, requestBody });
  const rawOutput = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const parsed = safeParseGeminiJson(String(rawOutput));
  const rawText = String(parsed.raw_text ?? rawOutput);
  return {
    parsed,
    rawText,
    rawOutput: String(rawOutput)
  };
}
// -------------------- Core Worker --------------------
async function processOneDocument(args) {
  const {
    supabase,
    document_id,
    case_id,
    job_id,
    job_lock_token,
    requestId,
    geminiKey,
    force
  } = args;
  const model = DEFAULT_EVIDENCE_GEMINI_MODEL;
  const prompt_version = "sota_v3_evidence_index_exact";
  const pipeline_version = "fanout_v3_evidence_index_exact";
  try {
    const begin = await supabase.rpc("begin_evidence_processing_v1", {
      p_job_id: job_id,
      p_case_id: case_id,
      p_job_locked_at: job_lock_token,
      p_document_id: document_id,
      p_request_id: requestId
    });
    if (begin.error || begin.data !== true) {
      throw new Error(`Failed to begin fenced evidence processing: ${begin.error?.message ?? "unknown"}`);
    }

    log("DOC_START", { requestId, document_id, force });
    const docRes = await supabase.from("case_documents")
      .select("id,case_id,document_type,mime_type,original_filename,filename,storage_bucket,storage_path")
      .eq("id", document_id)
      .eq("case_id", case_id)
      .single();
    if (!docRes) throw new Error("Doc query returned undefined");
    if (docRes.error || !docRes.data) {
      throw new Error(`Doc not found: ${docRes.error?.message ?? document_id}`);
    }
    const doc = docRes.data;
    if (!doc.storage_bucket || !doc.storage_path) {
      throw new Error("Missing storage_bucket/storage_path on case_documents row");
    }

    const existingContentId = await getExistingContentId({
      supabase,
      document_id,
      model,
      prompt_version,
      pipeline_version
    });
    let parsed;
    let rawText;
    let mime_used = null;
    let gemini_ran = false;
    if (existingContentId && !force) {
      const loaded = await loadContentRow({ supabase, content_id: existingContentId });
      parsed = loaded.parsed;
      rawText = loaded.rawText;
      log("CONTENT_REUSED", { document_id, content_id: existingContentId });
    } else {
      const dlRes = await supabase.storage.from(doc.storage_bucket).download(doc.storage_path);
      if (!dlRes) throw new Error("Storage download returned undefined");
      if (dlRes.error || !dlRes.data) {
        throw new Error(`Download failed: ${dlRes.error?.message ?? "unknown"}`);
      }
      const bytes = new Uint8Array(await dlRes.data.arrayBuffer());
      const fileName = String(doc.original_filename ?? doc.filename ?? doc.storage_path ?? "");
      mime_used = sniffMime(bytes, fileName, doc.mime_type ?? null);
      const gem = await runGemini({
        geminiKey,
        model,
        mime_type: mime_used,
        base64: toBase64(bytes),
        declared_document_type: doc.document_type ?? null,
        file_name: fileName
      });
      parsed = gem.parsed;
      rawText = gem.rawText;
      gemini_ran = true;
    }

    const predicted = normalizeEvidenceType(parsed.predicted_document_type);
    parsed.predicted_document_type = predicted;
    const conf = typeof parsed.confidence === "number" ? parsed.confidence : null;
    const tier_flags = computeTierFlags(predicted);
    const duty_category = mapToDutyCategory(predicted);
    const declaredMapped = mapDeclaredToEvidenceType(doc.document_type);
    const { decision, reason } = decideVerification(declaredMapped ?? null, predicted, conf);
    const verificationReason = declaredMapped
      ? `${reason} (declared mapped from '${String(doc.document_type)}' -> '${declaredMapped}')`
      : reason;
    const evidenceSpans = Array.isArray(parsed.evidence_spans) ? parsed.evidence_spans : [];
    const citations = evidenceSpans.map((item) => ({
      quote: item?.quote ?? null,
      page: item?.page ?? null
    }));
    const transactions = Array.isArray(parsed.transactions) ? parsed.transactions : [];
    const chunks = chunkText(rawText, 1100).map((chunk, index) => ({
      chunk_index: index,
      chunk_text: chunk,
      page_start: null,
      page_end: null,
      char_start: null,
      char_end: null,
      section_title: null,
      chunk_type: "paragraph",
      metadata: {
        request_id: requestId,
        created_at: new Date().toISOString(),
        evidence_type: predicted,
        duty_category,
        tier_flags
      }
    }));

    const contentPayload = existingContentId && !force ? null : {
      model,
      prompt_version,
      pipeline_version,
      text_content: rawText,
      content_json: {
        ...parsed,
        predicted_document_type: predicted,
        duty_category,
        tier_flags
      },
      language: parsed.language ?? null,
      page_count: parsed.page_count ?? null,
      parse_status: "success",
      parse_errors: null,
      content_sha256: null
    };
    const summaryExtraction = {
      extraction_type: "doc_summary_v3",
      schema_version: "v1",
      extracted_json: {
        predicted_document_type: predicted,
        confidence: conf,
        declared_document_type: doc.document_type ?? null,
        declared_document_type_mapped: declaredMapped,
        verification_decision: decision,
        verification_reason: verificationReason,
        evidence_spans: citations,
        has_transactions: transactions.length > 0,
        duty_category,
        tier_flags
      },
      extracted_text: parsed.notes ?? null,
      confidence: conf,
      citations,
      model,
      prompt_version: "extract_doc_summary_v3"
    };
    const transactionExtraction = transactions.length > 0 ? {
      extraction_type: "transactions_v1",
      schema_version: "v1",
      extracted_json: { transactions, predicted_document_type: predicted },
      extracted_text: null,
      confidence: conf,
      citations,
      model,
      prompt_version: "extract_transactions_v1"
    } : null;

    const commit = await supabase.rpc("commit_evidence_processing_v1", {
      p_job_id: job_id,
      p_case_id: case_id,
      p_job_locked_at: job_lock_token,
      p_document_id: document_id,
      p_request_id: requestId,
      p_existing_content_id: existingContentId && !force ? existingContentId : null,
      p_content: contentPayload,
      p_verification: {
        declared_document_type: doc.document_type,
        predicted_document_type: predicted,
        confidence: conf,
        decision,
        reason: verificationReason,
        evidence_spans: evidenceSpans,
        model,
        prompt_version
      },
      p_chunks: chunks,
      p_summary_extraction: summaryExtraction,
      p_transactions_extraction: transactionExtraction,
      p_document_patch: {
        verified_document_type: predicted,
        verification_status: decision,
        verification_confidence: conf
      }
    });
    if (commit.error || !commit.data) {
      throw new Error(`Fenced evidence commit failed: ${commit.error?.message ?? "no content id"}`);
    }
    const content_id = commit.data;

    log("DOC_DONE", {
      document_id,
      content_id,
      gemini_ran,
      mime_used,
      predicted,
      duty_category,
      tier_flags
    });
    return {
      ok: true,
      document_id,
      content_id,
      gemini_ran,
      mime_used,
      predicted_document_type: predicted,
      duty_category,
      tier_flags,
      verification_status: decision,
      chunks_created: chunks.length,
      transactions_extracted: transactions.length
    };
  } catch (error) {
    const failure = await supabase.rpc("fail_evidence_processing_v1", {
      p_job_id: job_id,
      p_case_id: case_id,
      p_job_locked_at: job_lock_token,
      p_document_id: document_id,
      p_request_id: requestId,
      p_error: String(error?.message ?? error ?? "unknown")
    });
    if (failure.error) {
      log("FAILURE_STATUS_SKIPPED", { document_id, error: failure.error.message });
    }
    throw error;
  }
}// -------------------- Serve --------------------
Deno.serve(async (req)=>{
  let requestId = "unverified";
  try {
    const verified = await verifyHarborEdgeRequest(req, "evidence_processed_v2");
    requestId = verified.context.requestId;

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!serviceKey || !supabaseUrl || !geminiKey) {
      return new Response(JSON.stringify({
        ok: false,
        requestId,
        error: "Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY"
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch }
    });
    await authorizeHarborEdgeRequest(supabase, verified.context);

    const body = verified.body;
    const document_id = verified.context.documentId;
    const case_id = verified.context.caseId;
    const job_id = verified.context.jobId;
    const job_lock_token = verified.context.jobLockedAt;
    if (!document_id || !case_id || !job_id || !job_lock_token) {
      throw new HarborEdgeAuthError("Evidence worker context is incomplete", 403);
    }

    const result = await processOneDocument({
      supabase,
      document_id,
      case_id,
      job_id,
      job_lock_token,
      requestId,
      geminiKey,
      force: body.force === true
    });
    return new Response(JSON.stringify({ ok: true, requestId, mode: "single", result }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    const message = String(error?.message ?? error);
    log("GLOBAL_ERROR", { requestId, message });
    const status = error instanceof HarborEdgeAuthError ? error.status : 500;
    return new Response(JSON.stringify({ ok: false, requestId, error: message }), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }
});