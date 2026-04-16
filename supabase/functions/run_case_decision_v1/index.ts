// supabase/functions/run_case_decision_v1/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
function nowIso() {
  return new Date().toISOString();
}
function clampInt(v, min, max, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
function clampFloat(v, min, max, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function toVectorLiteral(v) {
  return "[" + v.join(",") + "]";
}
function textResp(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
function errToText(e) {
  if (e instanceof Error) return `${e.name}: ${e.message}\n${e.stack ?? ""}`.trim();
  try {
    return `Non-Error thrown:\n${JSON.stringify(e, null, 2)}`;
  } catch  {
    return `Non-Error thrown (unstringifiable): ${String(e)}`;
  }
}
/** ---------------------------
 * Locked decision schema v1
 * --------------------------- */ const DECISION_VERSION = "case_decision_v1";
const DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision_version: {
      type: "string",
      const: DECISION_VERSION
    },
    case_id: {
      type: "string"
    },
    generated_at: {
      type: "string"
    },
    summary: {
      type: "string"
    },
    eligibility: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: [
            "low",
            "medium",
            "high"
          ]
        },
        score: {
          type: "integer",
          minimum: 0,
          maximum: 100
        },
        rationale: {
          type: "string"
        }
      },
      required: [
        "status",
        "score",
        "rationale"
      ]
    },
    critical_flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: {
            type: "string"
          },
          severity: {
            type: "string",
            enum: [
              "info",
              "warning",
              "critical"
            ]
          },
          title: {
            type: "string"
          },
          detail: {
            type: [
              "string",
              "null"
            ]
          },
          evidence_refs: {
            type: "array",
            items: {
              type: "string"
            }
          }
        },
        required: [
          "code",
          "severity",
          "title",
          "detail",
          "evidence_refs"
        ]
      }
    },
    gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: {
            type: "string"
          },
          question: {
            type: "string"
          },
          why_needed: {
            type: "string"
          },
          priority: {
            type: "string",
            enum: [
              "p0",
              "p1",
              "p2"
            ]
          },
          expected_type: {
            type: "string",
            enum: [
              "string",
              "number",
              "date",
              "boolean",
              "enum",
              "object",
              "array"
            ]
          },
          allowed_values: {
            type: "array",
            items: {
              type: "string"
            }
          },
          example_answer: {
            type: [
              "string",
              "null"
            ]
          }
        },
        required: [
          "field",
          "question",
          "why_needed",
          "priority",
          "expected_type",
          "allowed_values",
          "example_answer"
        ]
      }
    },
    recommended_actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: {
            type: "string"
          },
          why: {
            type: "string"
          },
          priority: {
            type: "string",
            enum: [
              "p0",
              "p1",
              "p2"
            ]
          },
          depends_on_gaps: {
            type: "array",
            items: {
              type: "string"
            }
          },
          reference_refs: {
            type: "array",
            items: {
              type: "string"
            }
          }
        },
        required: [
          "action",
          "why",
          "priority",
          "depends_on_gaps",
          "reference_refs"
        ]
      }
    },
    references: {
      type: "object",
      additionalProperties: false,
      properties: {
        regulatory_clauses: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: {
                type: "string"
              },
              clause_ref: {
                type: [
                  "string",
                  "null"
                ]
              },
              source_ref: {
                type: [
                  "string",
                  "null"
                ]
              },
              excerpt: {
                type: "string"
              },
              relevance: {
                type: "string"
              }
            },
            required: [
              "id",
              "clause_ref",
              "source_ref",
              "excerpt",
              "relevance"
            ]
          }
        },
        public_decisions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: {
                type: "string"
              },
              forum_name: {
                type: [
                  "string",
                  "null"
                ]
              },
              case_number: {
                type: [
                  "string",
                  "null"
                ]
              },
              decision_at: {
                type: [
                  "string",
                  "null"
                ]
              },
              excerpt: {
                type: "string"
              },
              relevance: {
                type: "string"
              },
              outcome: {
                type: [
                  "string",
                  "null"
                ]
              }
            },
            required: [
              "id",
              "forum_name",
              "case_number",
              "decision_at",
              "excerpt",
              "relevance",
              "outcome"
            ]
          }
        },
        evidence: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              source_type: {
                type: "string",
                enum: [
                  "case_document_extraction",
                  "case_extract_run"
                ]
              },
              source_id: {
                type: "string"
              },
              quote: {
                type: "string"
              },
              page: {
                type: [
                  "integer",
                  "null"
                ]
              },
              confidence: {
                type: [
                  "number",
                  "null"
                ]
              }
            },
            required: [
              "source_type",
              "source_id",
              "quote",
              "page",
              "confidence"
            ]
          }
        }
      },
      required: [
        "regulatory_clauses",
        "public_decisions",
        "evidence"
      ]
    },
    diagnostics: {
      type: "object",
      additionalProperties: false,
      properties: {
        assumptions: {
          type: "array",
          items: {
            type: "string"
          }
        },
        limits: {
          type: "array",
          items: {
            type: "string"
          }
        }
      },
      required: [
        "assumptions",
        "limits"
      ]
    }
  },
  required: [
    "decision_version",
    "case_id",
    "generated_at",
    "summary",
    "eligibility",
    "critical_flags",
    "gaps",
    "recommended_actions",
    "references",
    "diagnostics"
  ]
};
/** ---------------------------
 * OpenAI helpers
 * --------------------------- */ async function openaiEmbed(apiKey, text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text
    })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI embeddings failed (${res.status}): ${raw}`);
  const j = JSON.parse(raw);
  const emb = j?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) throw new Error("OpenAI embeddings returned no embedding array.");
  return emb;
}
async function openaiDecision(apiKey, model, inputObj) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are GuideBuoy AI.",
                "Output STRICT JSON matching the provided schema.",
                "Do not invent facts. Use only the inputs.",
                "Only create gaps for values that are null/unknown/missing.",
                "Do NOT create gaps for fields that are explicitly present (true/false).",
                "Do not write negative claims like 'no indication', 'no evidence', 'not present' unless you cite an evidence quote that explicitly says so.",
                "If regulatory/public decision candidates are provided, cite them in references with UUIDs and excerpts pulled ONLY from provided candidates.",
                "For any reference fields not available in candidates (forum_name/case_number/decision_at), output null (do not omit keys).",
                "If a case is in SG but decisions are from other jurisdictions, treat them as weaker guidance and say so in relevance text.",
                "Ccross-jurisdiction decisions are weak guidance, and require relevance to explicitly say whether it’s “bank-favouring” or “customer-favouring”, based only on the candidate outcome fields you pass in.",
                "Follow scoring guidance provided in input (if present). If you score below the suggested minimum, explain specific contradictory evidence from inputs."
              ].join(" ")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(inputObj)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "case_decision_v1",
          schema: DECISION_JSON_SCHEMA
        }
      }
    })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI decision failed (${res.status}): ${raw}`);
  const payload = JSON.parse(raw);
  const outText = payload?.output?.[0]?.content?.[0]?.text;
  if (!outText) throw new Error(`OpenAI decision returned unexpected payload: ${raw.slice(0, 2000)}`);
  return JSON.parse(outText);
}
/** ---------------------------
 * Gaps inferred ONLY from null/undefined
 * --------------------------- */ function getPath(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts){
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}
function inferGapsFromNulls(extractJson) {
  const candidates = [
    {
      path: "customer_actions.clicked_phishing_link",
      question: "Did you click the phishing link (or open a fake bank login page)?",
      why: "This affects whether the scam required customer action and how liability is assessed.",
      expected_type: "boolean",
      priority: "p0",
      example: "No, I did not click any links."
    },
    {
      path: "customer_actions.provided_credentials",
      question: "Did you enter or share your banking credentials (username/password) on any site/app?",
      why: "Credential compromise is a key fact for dispute outcomes.",
      expected_type: "boolean",
      priority: "p0",
      example: "No, I did not share credentials."
    },
    {
      path: "customer_actions.approved_push_notification",
      question: "Did you approve any push notification / in-app authorisation prompt?",
      why: "Authorisation method affects whether the transaction is considered customer-authorised.",
      expected_type: "boolean",
      priority: "p0",
      example: "No, I did not approve any prompts."
    },
    {
      path: "customer_actions.installed_remote_access_software",
      question: "Did you install any remote access software (AnyDesk/TeamViewer/etc.)?",
      why: "Remote access is a strong indicator of device compromise and changes the escalation path.",
      expected_type: "boolean",
      priority: "p1",
      example: "No, I did not install remote access software."
    },
    {
      path: "institution_actions.limits_changed",
      question: "Were any transfer limits changed prior to the fraudulent transaction?",
      why: "Limit changes can indicate account takeover and control failures.",
      expected_type: "boolean",
      priority: "p1",
      example: "No, limits were not changed by me."
    }
  ];
  const gaps = [];
  for (const c of candidates){
    const val = getPath(extractJson, c.path);
    if (val === null || typeof val === "undefined") {
      gaps.push({
        field: c.path,
        question: c.question,
        why_needed: c.why,
        priority: c.priority,
        expected_type: c.expected_type,
        allowed_values: c.expected_type === "boolean" ? [
          "true",
          "false"
        ] : [],
        example_answer: c.example ?? null
      });
    }
  }
  return gaps;
}
/** ---------------------------
 * Score guidance (server-side)
 * --------------------------- */ function computeScoreGuidance(extractJson) {
  const ca = extractJson?.customer_actions ?? {};
  const ia = extractJson?.institution_actions ?? {};
  const conf = typeof extractJson?.evidence_status?.confidence === "number" ? extractJson.evidence_status.confidence : 0.5;
  const noCustomerFault = ca.shared_otp === false && ca.provided_credentials === false && ca.clicked_phishing_link === false && ca.approved_push_notification === false && ca.installed_remote_access_software === false;
  const onlyInstitutionGap = ia?.limits_changed == null;
  let suggestedScore = 50;
  if (conf >= 0.8 && noCustomerFault) suggestedScore = 75;
  if (conf >= 0.8 && noCustomerFault && !onlyInstitutionGap) suggestedScore = 85;
  if (conf < 0.6) suggestedScore = Math.min(suggestedScore, 55);
  const suggestedMin = conf >= 0.8 && noCustomerFault ? 70 : 0;
  return {
    evidence_confidence: conf,
    no_customer_fault: noCustomerFault,
    institution_limits_unknown: onlyInstitutionGap,
    suggested_score: suggestedScore,
    suggested_min_score: suggestedMin,
    rule: "If no_customer_fault=true and evidence_confidence>=0.8, do not score below 70 unless you cite concrete contradictory evidence from inputs."
  };
}
function asUpper(x) {
  return (x ?? "").toString().trim().toUpperCase();
}
function isUnauthorisedTransactionCase(extractJson) {
  const text = JSON.stringify(extractJson || {}).toLowerCase();
  return text.includes("transaction") && (text.includes("fraud") || text.includes("scam") || text.includes("phishing") || text.includes("unauthorised") || text.includes("unauthorized"));
}
function isEUPGClause(c: any): boolean {
  const text = `${c?.source_name || ""} ${c?.source_ref || ""} ${c?.title || ""}`.toLowerCase();
  return text.includes("e-payments") || text.includes("user protection") || text.includes("eupg") || text.includes("epug");
}
function scoreEUPGClauseForCase(c: any, extractJson: any): number {
  const text = `${c?.title || ""} ${c?.excerpt || ""} ${c?.plain_english_summary || ""} ${c?.source_ref || ""}`.toLowerCase();
  const customer = extractJson?.customer_actions ?? {};
  const institution = extractJson?.institution_actions ?? {};
  const noOtpCredsLink = customer?.shared_otp === false && customer?.provided_credentials === false && customer?.clicked_phishing_link === false;
  const payeeAdded = institution?.payee_added === true;
  const txBlockNotAttempted = institution?.transaction_block_attempted === false;
  let score = 0;
  if (text.includes("unauthorised transaction") || text.includes("unauthorized transaction")) score += 7;
  if (text.includes("bank liability") || text.includes("liability")) score += 5;
  if (text.includes("security safeguard") || text.includes("security safeguards") || text.includes("safeguard")) score += 4;
  if (text.includes("payee control") || text.includes("payee controls")) score += 4;
  if (text.includes("alert") || text.includes("notification")) score += 3;
  if (text.includes("transaction monitoring")) score += 4;
  if (text.includes("fraud detection")) score += 4;
  if (noOtpCredsLink) {
    if (text.includes("unauthorised transaction") || text.includes("unauthorized transaction")) score += 5;
    if (text.includes("bank liability") || text.includes("liability")) score += 4;
    if (text.includes("security safeguard") || text.includes("security safeguards") || text.includes("safeguard")) score += 3;
  }
  if (payeeAdded) {
    if (text.includes("payee control") || text.includes("payee controls")) score += 5;
    if (text.includes("alert") || text.includes("notification")) score += 4;
  }
  if (txBlockNotAttempted) {
    if (text.includes("transaction monitoring")) score += 5;
    if (text.includes("fraud detection")) score += 5;
  }
  return score;
}
function mapEupgFallbackRow(c) {
  const doc = c.regulatory_documents;
  const docObj = Array.isArray(doc) ? doc[0] : doc;
  const label = (docObj?.document_title || docObj?.source || c.source_ref || "").toString().trim() || null;
  const body = (c.text_content ?? "").toString();
  return {
    id: String(c.id),
    clause_ref: c.clause_ref ?? null,
    source_ref: label,
    excerpt: body.slice(0, 2000),
    relevance: "Prioritized MAS E-Payments User Protection Guidelines clause for unauthorised transaction/scam case.",
    title: c.title ?? null,
    source_name: label,
    plain_english_summary: body.slice(0, 2000)
  };
}
async function fetchFallbackEUPGClauses(supabase) {
  const clauseSelect = "id, title, clause_ref, text_content, source_ref, document_id";
  const docSelect = "id, document_title, source";
  const orOnClause = [
    "title.ilike.%e-payments%",
    "title.ilike.%user protection%",
    "title.ilike.%mas e-payments%",
    "title.ilike.%unauthorised%",
    "title.ilike.%unauthorized%",
    "source_ref.ilike.%e-payments%",
    "source_ref.ilike.%user protection%",
    "text_content.ilike.%e-payments%",
    "text_content.ilike.%user protection%"
  ].join(",");
  const { data: byClauseFields, error: errClause } = await supabase.from("regulatory_clauses").select(clauseSelect).or(orOnClause).order("id", {
    ascending: true
  }).limit(2);
  const { data: byJoinedDoc, error: errJoin } = await supabase.from("regulatory_clauses").select(`${clauseSelect}, regulatory_documents!inner(${docSelect})`).or([
    "document_title.ilike.%e-payments%",
    "document_title.ilike.%user protection%",
    "document_title.ilike.%e payments%",
    "document_title.ilike.%unauthorised%",
    "document_title.ilike.%unauthorized%",
    "source.ilike.%e-payments%",
    "source.ilike.%user protection%"
  ].join(","), {
    foreignTable: "regulatory_documents"
  }).order("id", {
    ascending: true
  }).limit(2);
  const merged = new Map();
  for (const row of byClauseFields ?? []){
    merged.set(String(row.id), row);
  }
  for (const row of byJoinedDoc ?? []){
    merged.set(String(row.id), row);
  }
  let usedDocumentIdFallback = false;
  let documentIdsQueried = 0;
  let errDocs = null;
  let errByDoc = null;
  if (merged.size === 0) {
    usedDocumentIdFallback = true;
    const res = await supabase.from("regulatory_documents").select("id").or([
      "document_title.ilike.%e-payments%",
      "document_title.ilike.%user protection%",
      "document_title.ilike.%e payments%",
      "source.ilike.%e-payments%",
      "source.ilike.%user protection%"
    ].join(",")).order("id", {
      ascending: true
    }).limit(20);
    errDocs = res.error;
    const docIds = (res.data ?? []).map((d)=>d.id).filter(Boolean);
    documentIdsQueried = docIds.length;
    if (docIds.length > 0) {
      const res2 = await supabase.from("regulatory_clauses").select(clauseSelect).in("document_id", docIds).order("id", {
        ascending: true
      }).limit(2);
      errByDoc = res2.error;
      for (const row of res2.data ?? []){
        merged.set(String(row.id), row);
      }
    }
  }
  const rows = Array.from(merged.values()).sort((a, b)=>String(a.id).localeCompare(String(b.id))).slice(0, 2);
  const errs = {
    clause_or: errClause ?? null,
    join_or: errJoin ?? null,
    documents: errDocs ?? null,
    by_document_id: errByDoc ?? null
  };
  const hasErr = Object.values(errs).some(Boolean);
  console.log("EUPG_FALLBACK_RESULT", {
    merged_count: rows.length,
    clause_ids: rows.map((r)=>r.id),
    used_document_id_fallback: usedDocumentIdFallback,
    document_ids_matched: documentIdsQueried,
    errors: hasErr ? errs : null
  });
  return rows;
}
function getDocType(d) {
  return asUpper(d.declared_document_type || d.predicted_document_type || "");
}
function getBestConfidence(d) {
  const a = typeof d.extraction_confidence === "number" ? d.extraction_confidence : null;
  const b = typeof d.verification_confidence === "number" ? d.verification_confidence : null;
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}
function extractSpans(d) {
  // Prefer verification_spans (already curated)
  const v = d.verification_spans;
  if (Array.isArray(v) && v.length) return v;
  // Fallback: extracted_json.evidence_spans
  const ej = d.extracted_json;
  const e = ej?.evidence_spans;
  if (Array.isArray(e) && e.length) return e;
  return [];
}
function docHasUsefulContent(d) {
  const spans = extractSpans(d);
  const hasSpans = Array.isArray(spans) && spans.length > 0;
  const textLen = (d.extracted_text ?? "").toString().trim().length;
  return hasSpans || textLen >= 80;
}
function scoreDoc(d) {
  const txt = (d.extracted_text ?? "").toString().toLowerCase();
  const conf = getBestConfidence(d) ?? 0;
  let boost = 0;
  const dt = getDocType(d);
  if (dt === "CYBER_REPORT") boost += 5;
  if (txt.includes("cyber") || txt.includes("forensic") || txt.includes("expert") || txt.includes("malware")) boost += 2;
  if (txt.includes("did not provide credentials") || txt.includes("no credentials") || txt.includes("did not share otp")) boost += 2;
  if (txt.includes("no otp") || txt.includes("not authorise") || txt.includes("unauthorised")) boost += 1;
  // Prefer verified docs slightly
  if ((d.verification_decision ?? "").toString().toLowerCase() === "verified") boost += 1;
  // Prefer docs with spans
  const spans = extractSpans(d);
  if (spans.length) boost += 1;
  return conf + boost;
}
function buildEvidenceFromDoc(d, maxItems = 6) {
  const items = [];
  const conf = getBestConfidence(d);
  const dt = getDocType(d);
  const spans = extractSpans(d);
  // 1) Spans-first (page-aware)
  if (Array.isArray(spans) && spans.length) {
    for (const s of spans.slice(0, maxItems)){
      const quote = (s?.quote ?? "").toString().trim();
      if (!quote) continue;
      const page = typeof s?.page === "number" ? s.page : null;
      items.push({
        source_type: "case_document_extraction",
        source_id: d.extraction_id,
        quote: dt ? `[${dt}] ${quote}` : quote,
        page,
        confidence: typeof conf === "number" ? conf : null
      });
    }
  }
  // 2) Fallback: extracted_text
  if (items.length === 0) {
    const t = (d.extracted_text ?? "").toString().trim();
    if (t) {
      items.push({
        source_type: "case_document_extraction",
        source_id: d.extraction_id,
        quote: dt ? `[${dt}] ${t.slice(0, 1600)}` : t.slice(0, 1600),
        page: null,
        confidence: typeof conf === "number" ? conf : null
      });
    }
  }
  return items;
}
/** ---------------------------
 * Main handler
 * --------------------------- */ serve(async (req)=>{
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction") ?? "";
  const MODEL = Deno.env.get("CASE_DECISION_MODEL") ?? "gpt-4.1-mini";
  if (!SUPABASE_URL) return textResp("Missing SUPABASE_URL", 500);
  if (!SUPABASE_SERVICE_ROLE_KEY) return textResp("Missing SUPABASE_SERVICE_ROLE_KEY", 500);
  if (!OPENAI_API_KEY) return textResp("Missing GuideBuoy_EdgeFunction secret", 500);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    if (req.method !== "POST") return textResp("POST only", 405);
    const body = await req.json().catch(()=>({}));
    const case_id = body.case_id;
    const force = body.force ?? false;
    const topKClauses = clampInt(body.top_k_clauses, 1, 20, 10);
    const topKDecisions = clampInt(body.top_k_decisions, 1, 20, 10);
    const clauseThreshold = clampFloat(body.clause_similarity_threshold, 0, 1, 0.12);
    const promptVersion = body.prompt_version ?? "decision_v1.2_spans_doc_types";
    if (!case_id) return textResp("Missing case_id", 400);
    /** 1) Latest extract run */ const { data: extractRun, error: erErr } = await supabase.from("case_extract_runs").select("id, case_id, extract_json, missing_fields, created_at").eq("case_id", case_id).order("created_at", {
      ascending: false
    }).limit(1).maybeSingle();
    if (erErr) throw new Error(`case_extract_runs query error: ${JSON.stringify(erErr)}`);
    if (!extractRun) return textResp("No case_extract_runs found for case_id", 404);
    /** 2) Check existing decision for this (case_id, extract_run_id) */ const { data: existing, error: exErr } = await supabase.from("case_decision_runs").select("id, decision_json, eligibility_status, strength_score_value, created_at").eq("case_id", case_id).eq("extract_run_id", extractRun.id).limit(1).maybeSingle();
    if (exErr) throw new Error(`case_decision_runs select error: ${JSON.stringify(exErr)}`);
    if (existing && !force) {
      return jsonResp({
        ok: true,
        reused: true,
        decision_run_id: existing.id,
        case_id,
        extract_run_id: extractRun.id,
        eligibility_status: existing.eligibility_status,
        strength_score_value: existing.strength_score_value,
        decision_json: existing.decision_json
      });
    }
    /** 3) Pull enriched docs from view */ const { data: docs, error: docsErr } = await supabase.from("case_documents_enriched").select(`
        extraction_id,
        case_id,
        document_id,
        content_id,
        extracted_text,
        extracted_json,
        extraction_confidence,
        extraction_created_at,
        declared_document_type,
        predicted_document_type,
        verification_confidence,
        verification_decision,
        verification_reason,
        verification_spans,
        verified_at
      `).eq("case_id", case_id).order("extraction_created_at", {
      ascending: false
    }).limit(120);
    if (docsErr) throw new Error(`case_documents_enriched query error: ${JSON.stringify(docsErr)}`);
    const enrichedDocs = docs ?? [];
    const rankedDocs = enrichedDocs.filter(docHasUsefulContent).sort((a, b)=>scoreDoc(b) - scoreDoc(a));
    /** 4) Evidence list */ const extractJson = extractRun.extract_json ?? {};
    const extractText = JSON.stringify(extractJson);
    const evidence = [];
    evidence.push({
      source_type: "case_extract_run",
      source_id: extractRun.id,
      quote: extractText.slice(0, 1600),
      page: null,
      confidence: null
    });
    // Add top documents; each doc can contribute multiple span evidence items
    const chosen = rankedDocs.slice(0, 6);
    for (const d of chosen){
      evidence.push(...buildEvidenceFromDoc(d, 6));
    }
    /** 5) Normalized facts */ const facts = {
      jurisdiction: extractJson?.case_meta?.jurisdiction ?? null,
      institution_name: extractJson?.case_meta?.institution_name ?? null,
      claim_type: extractJson?.case_meta?.claim_type ?? null,
      claim_amount: extractJson?.case_meta?.claim_amount ?? null,
      claim_currency: extractJson?.case_meta?.claim_currency ?? null,
      incident_at: extractJson?.timeline?.incident_at ?? null,
      reported_to_institution_at: extractJson?.timeline?.reported_to_institution_at ?? null,
      reported_to_police_at: extractJson?.timeline?.reported_to_police_at ?? null,
      customer_shared_otp: extractJson?.customer_actions?.shared_otp ?? null,
      customer_provided_credentials: extractJson?.customer_actions?.provided_credentials ?? null,
      customer_clicked_link: extractJson?.customer_actions?.clicked_phishing_link ?? null,
      customer_approved_push: extractJson?.customer_actions?.approved_push_notification ?? null,
      installed_remote_access: extractJson?.customer_actions?.installed_remote_access_software ?? null,
      payee_added: extractJson?.institution_actions?.payee_added ?? null,
      limits_changed: extractJson?.institution_actions?.limits_changed ?? null,
      step_up_authentication_used: extractJson?.institution_actions?.step_up_authentication_used ?? null,
      transaction_block_attempted: extractJson?.institution_actions?.transaction_block_attempted ?? null,
      evidence_confidence: extractJson?.evidence_status?.confidence ?? null
    };
    /** 6) Retrieval text includes doc type tags (better embeddings) */ const evidenceLines = evidence.slice(0, 18).map((e)=>{
      const tag = e.source_type === "case_document_extraction" ? "DOC" : "EXTRACT";
      const page = typeof e.page === "number" ? `p.${e.page}` : "";
      const c = typeof e.confidence === "number" ? `conf=${e.confidence}` : "";
      return `- [${tag}] ${e.source_type}:${e.source_id} ${page} ${c} ${e.quote.slice(0, 360)}`.trim();
    }).join("\n");
    const retrievalText = `CASE_FACTS:\n${JSON.stringify(facts, null, 2)}\n\n` + `EVIDENCE_SNIPPETS:\n${evidenceLines}`;
    /** 7) Embed + vector literal */ const embArr = await openaiEmbed(OPENAI_API_KEY, retrievalText);
    const query_embedding = toVectorLiteral(embArr);
    /** 8) RPC matches */ const { data: clauseMatches, error: cmErr } = await supabase.rpc("match_regulatory_clauses_threshold", {
      query_embedding,
      match_count: topKClauses,
      similarity_threshold: clauseThreshold
    });
    if (cmErr) throw new Error(`match_regulatory_clauses_threshold RPC error: ${JSON.stringify(cmErr)}`);
    const { data: decisionMatches, error: dmErr } = await supabase.rpc("match_public_decisions", {
      query_embedding,
      match_count: topKDecisions
    });
    if (dmErr) {
      throw new Error(`match_public_decisions RPC error: ${JSON.stringify(dmErr)}\n` + `NOTE: Your match_public_decisions function must accept exactly (query_embedding, match_count).`);
    }
    /** 9) Server inferred gaps + scoring guidance */ const inferredGaps = inferGapsFromNulls(extractJson);
    const scoringGuidance = computeScoreGuidance(extractJson);
    /** 10) Model input */ const modelInput = {
      case_id,
      extract_run_id: extractRun.id,
      facts,
      extract_json: extractJson,
      evidence,
      server_inferred_gaps: inferredGaps,
      scoring_guidance: scoringGuidance,
      regulatory_candidates: (clauseMatches ?? []).map((c)=>({
          id: String(c.id),
          clause_ref: c.clause_ref ?? null,
          source_ref: c.source_ref ?? null,
          excerpt: (c.text_content ?? "").slice(0, 600),
          similarity: c.similarity ?? null
        })),
      public_decision_candidates: (decisionMatches ?? []).map((p)=>({
          id: String(p.id),
          excerpt: ((p.summary ?? "") + "\n" + (p.issues ?? "")).slice(0, 800),
          outcome: p.outcome ?? null,
          outcome_favours: p.outcome_favours ?? null,
          similarity: p.similarity ?? null
        })),
      constraints: {
        only_gap_null_unknown: true,
        clause_threshold: clauseThreshold
      }
    };
    /** 11) Generate decision */ const decisionJson = await openaiDecision(OPENAI_API_KEY, MODEL, modelInput);
    /** 12) Server-side invariants */ decisionJson.decision_version = DECISION_VERSION;
    decisionJson.case_id = case_id;
    decisionJson.generated_at = nowIso();
    /** 13) Merge gaps (dedupe by field) */ const modelGaps = Array.isArray(decisionJson.gaps) ? decisionJson.gaps : [];
    const gapByField = new Map();
    for (const g of modelGaps)if (g?.field) gapByField.set(String(g.field), g);
    for (const g of inferredGaps)if (!gapByField.has(g.field)) gapByField.set(g.field, g);
    decisionJson.gaps = Array.from(gapByField.values());
    /** 14) Ensure required arrays/objects exist */ decisionJson.critical_flags = Array.isArray(decisionJson.critical_flags) ? decisionJson.critical_flags : [];
    decisionJson.recommended_actions = Array.isArray(decisionJson.recommended_actions) ? decisionJson.recommended_actions : [];
    decisionJson.references = decisionJson.references ?? {
      regulatory_clauses: [],
      public_decisions: [],
      evidence: []
    };
    decisionJson.references.regulatory_clauses = Array.isArray(decisionJson.references.regulatory_clauses) ? decisionJson.references.regulatory_clauses : [];
    decisionJson.references.public_decisions = Array.isArray(decisionJson.references.public_decisions) ? decisionJson.references.public_decisions : [];
    decisionJson.references.evidence = Array.isArray(decisionJson.references.evidence) ? decisionJson.references.evidence : [];
    // MAS EUPG: include and front-load for disputed/unauthorised transaction cases (independent of OTP/credentials/phishing flags).
    const isUnauthorisedCase = isUnauthorisedTransactionCase(extractJson);
    const selectedClauseById = new Map<string, any>((clauseMatches ?? []).map((c)=>[
        String(c.id),
        c
      ]));
    let selectedClauses = decisionJson.references.regulatory_clauses.map((c)=>{
      const matched: any = selectedClauseById.get(String(c.id)) ?? {};
      return {
        ...c,
        title: matched.title ?? null,
        source_name: matched.source_name ?? matched.source_ref ?? null,
        source_ref: matched.source_ref ?? c.source_ref ?? null,
        plain_english_summary: matched.plain_english_summary ?? null
      };
    });
    if (isUnauthorisedCase) {
      const hasEUPG = selectedClauses.some(isEUPGClause);
      let fallbackRows: any[] = [];
      if (!hasEUPG) {
        fallbackRows = await fetchFallbackEUPGClauses(supabase);
        if (fallbackRows && fallbackRows.length > 0) {
          selectedClauses = [
            ...fallbackRows.map(mapEupgFallbackRow),
            ...selectedClauses
          ];
        }
      }
      console.log("EUPG_ENFORCEMENT", {
        hasEUPG_before: hasEUPG,
        final_eupg_count: selectedClauses.filter(isEUPGClause).length
      });
      const eupg = selectedClauses.filter(isEUPGClause);
      const rest = selectedClauses.filter((c)=>!isEUPGClause(c));
      selectedClauses = [
        ...eupg,
        ...rest
      ];
      // GUARANTEE at least one EUPG survives
      const finalHasEUPG = selectedClauses.some(isEUPGClause);
      if (!finalHasEUPG) {
        const fallbackRows = await fetchFallbackEUPGClauses(supabase);
        if (fallbackRows && fallbackRows.length > 0) {
          const first = mapEupgFallbackRow(fallbackRows[0]);
          selectedClauses = [
            first,
            ...selectedClauses
          ];
        }
      }
    }
    const eupg = selectedClauses.filter(isEUPGClause).sort((a, b)=>scoreEUPGClauseForCase(b, extractJson) - scoreEUPGClauseForCase(a, extractJson));
    const rest = selectedClauses.filter((c)=>!isEUPGClause(c));
    const topRelevantEUPG = eupg.slice(0, 2);
    selectedClauses = [
      ...topRelevantEUPG,
      ...rest
    ].slice(0, 5);
    console.log("EUPG_FINAL_CHECK", {
      total: selectedClauses.length,
      eupg_count: selectedClauses.filter(isEUPGClause).length,
      titles: selectedClauses.map((c)=>c.title)
    });
    decisionJson.references.regulatory_clauses = selectedClauses.map((c)=>({
        id: String(c.id),
        clause_ref: c.clause_ref ?? null,
        source_ref: c.source_ref ?? null,
        excerpt: (c.excerpt ?? "").toString(),
        relevance: (c.relevance ?? "").toString()
      }));
    console.log("REGULATORY_SELECTION_DEBUG", {
      isUnauthorisedCase,
      selected_count: selectedClauses.length,
      eupg_present: selectedClauses.some(isEUPGClause)
    });
    decisionJson.diagnostics = decisionJson.diagnostics ?? {
      assumptions: [],
      limits: []
    };
    decisionJson.diagnostics.assumptions = Array.isArray(decisionJson.diagnostics.assumptions) ? decisionJson.diagnostics.assumptions : [];
    decisionJson.diagnostics.limits = Array.isArray(decisionJson.diagnostics.limits) ? decisionJson.diagnostics.limits : [];
    // If model forgot evidence list, inject ours
    if ((decisionJson.references.evidence?.length ?? 0) === 0) {
      decisionJson.references.evidence = evidence;
      decisionJson.diagnostics.limits.push("Server added evidence list because model returned empty references.evidence.");
    }
    /** 15) Enforce score guidance floor (soft clamp) */ const modelScore = Number(decisionJson?.eligibility?.score ?? 50);
    const suggestedMin = Number(scoringGuidance?.suggested_min_score ?? 0);
    if (suggestedMin > 0 && Number.isFinite(modelScore) && modelScore < suggestedMin) {
      decisionJson.eligibility.score = suggestedMin;
      decisionJson.diagnostics.limits.push(`Server adjusted eligibility.score from ${modelScore} to ${suggestedMin} due to scoring_guidance (no_customer_fault + high confidence).`);
    }
    // Clamp score (always server authoritative)
    const finalScore = Math.max(0, Math.min(100, Math.trunc(Number(decisionJson?.eligibility?.score ?? 50))));
    decisionJson.eligibility.score = finalScore;
    // Force eligibility.status to be consistent with score (prevents "high/75")
    let finalStatus;
    if (finalScore < 40) finalStatus = "low";
    else if (finalScore < 85) finalStatus = "medium";
    else finalStatus = "high";
    decisionJson.eligibility.status = finalStatus;
    function enforceStatusLanguage(status, s) {
      if (!s) return s;
      // normalize a few common phrases that cause contradiction
      if (status === "medium") {
        return s.replace(/high eligibility/gi, "moderate to strong eligibility").replace(/assessed as high/gi, "assessed as medium").replace(/very likely/gi, "plausible");
      }
      if (status === "low") {
        return s.replace(/high eligibility/gi, "low eligibility").replace(/assessed as high/gi, "assessed as low").replace(/very likely/gi, "unlikely");
      }
      // status === "high"
      return s.replace(/medium eligibility/gi, "high eligibility").replace(/assessed as medium/gi, "assessed as high");
    }
    decisionJson.summary = enforceStatusLanguage(finalStatus, decisionJson.summary);
    decisionJson.eligibility.rationale = enforceStatusLanguage(finalStatus, decisionJson.eligibility.rationale);
    // DB columns
    const eligibility_status = finalStatus;
    const strength_score_value = finalScore;
    /** 16) Write to DB */ let savedRow;
    if (existing) {
      const { data: updated, error: upErr } = await supabase.from("case_decision_runs").update({
        decision_json: decisionJson,
        eligibility_status,
        strength_score_value,
        model_name: MODEL,
        prompt_version: promptVersion
      }).eq("id", existing.id).select("id, case_id, extract_run_id, eligibility_status, strength_score_value, decision_json, created_at").single();
      if (upErr) throw new Error(`case_decision_runs update error: ${JSON.stringify(upErr)}`);
      savedRow = updated;
    } else {
      const { data: inserted, error: insErr } = await supabase.from("case_decision_runs").insert({
        case_id,
        extract_run_id: extractRun.id,
        decision_json: decisionJson,
        eligibility_status,
        strength_score_value,
        model_name: MODEL,
        prompt_version: promptVersion,
        created_at: nowIso()
      }).select("id, case_id, extract_run_id, eligibility_status, strength_score_value, decision_json, created_at").single();
      if (insErr) throw new Error(`case_decision_runs insert error: ${JSON.stringify(insErr)}`);
      savedRow = inserted;
    }
    const clauseSims = (clauseMatches ?? []).map((x)=>x.similarity).filter((x)=>typeof x === "number").sort((a, b)=>b - a).slice(0, 5);
    const decisionSims = (decisionMatches ?? []).map((x)=>x.similarity).filter((x)=>typeof x === "number").sort((a, b)=>b - a).slice(0, 5);
    return jsonResp({
      ok: true,
      reused: false,
      updated_existing: Boolean(existing),
      decision_run_id: savedRow.id,
      case_id,
      extract_run_id: extractRun.id,
      eligibility_status: savedRow.eligibility_status,
      strength_score_value: savedRow.strength_score_value,
      decision_json: savedRow.decision_json,
      debug: {
        clause_threshold: clauseThreshold,
        retrieved_clause_count: (clauseMatches ?? []).length,
        retrieved_decision_count: (decisionMatches ?? []).length,
        top_clause_similarity: clauseSims,
        top_decision_similarity: decisionSims,
        evidence_doc_ids_used: Array.from(new Set(evidence.filter((e)=>e.source_type === "case_document_extraction").map((e)=>e.source_id))),
        top_ranked_doc_types: rankedDocs.slice(0, 6).map((d)=>({
            extraction_id: d.extraction_id,
            doc_type: getDocType(d) || null,
            best_confidence: getBestConfidence(d),
            verification_decision: d.verification_decision ?? null
          })),
        scoring_guidance: scoringGuidance
      }
    });
  } catch (e) {
    const errText = errToText(e);
    console.error("run_case_decision_v1 ERROR:", errText);
    return textResp(errText, 500);
  }
});
