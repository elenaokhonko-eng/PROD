// supabase/functions/run_report_selfserve_v1/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
function nowIso() {
  return new Date().toISOString();
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
function toStr(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try {
    return String(v);
  } catch  {
    return "";
  }
}
/** ---------------------------
 * Report schema (locked) v1
 * --------------------------- */ const REPORT_VERSION = "self_serve_report_v1";
const REPORT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    report_version: {
      type: "string",
      const: REPORT_VERSION
    },
    case_id: {
      type: "string"
    },
    generated_at: {
      type: "string"
    },
    title: {
      type: "string"
    },
    executive_summary: {
      type: "string"
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          at: {
            type: [
              "string",
              "null"
            ]
          },
          label: {
            type: "string"
          },
          detail: {
            type: [
              "string",
              "null"
            ]
          }
        },
        required: [
          "at",
          "label",
          "detail"
        ]
      }
    },
    scam_nature: {
      type: "string"
    },
    disputed_transactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: {
            type: "string"
          },
          amount: {
            type: [
              "number",
              "null"
            ]
          },
          currency: {
            type: [
              "string",
              "null"
            ]
          },
          authorised: {
            type: [
              "string",
              "null"
            ]
          },
          notes: {
            type: [
              "string",
              "null"
            ]
          }
        },
        required: [
          "label",
          "amount",
          "currency",
          "authorised",
          "notes"
        ]
      }
    },
    totals: {
      type: "object",
      additionalProperties: false,
      properties: {
        total_amount: {
          type: [
            "number",
            "null"
          ]
        },
        currency: {
          type: [
            "string",
            "null"
          ]
        }
      },
      required: [
        "total_amount",
        "currency"
      ]
    },
    key_responsibility_points: {
      type: "array",
      items: {
        type: "string"
      }
    },
    requested_resolution: {
      type: "array",
      items: {
        type: "string"
      }
    },
    evidence_checklist: {
      type: "array",
      items: {
        type: "string"
      }
    },
    disclaimers: {
      type: "array",
      items: {
        type: "string"
      }
    },
    limitations: {
      type: "array",
      items: {
        type: "string"
      }
    },
    missing_facts: {
      type: "array",
      items: {
        type: "string"
      }
    },
    regulatory_considerations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string"
          },
          summary: {
            type: "string"
          },
          source_name: {
            type: [
              "string",
              "null"
            ]
          },
          clause_ref: {
            type: [
              "string",
              "null"
            ]
          }
        },
        required: [
          "title",
          "summary",
          "source_name",
          "clause_ref"
        ]
      }
    }
  },
  required: [
    "report_version",
    "case_id",
    "generated_at",
    "title",
    "executive_summary",
    "timeline",
    "scam_nature",
    "disputed_transactions",
    "totals",
    "key_responsibility_points",
    "requested_resolution",
    "evidence_checklist",
    "disclaimers",
    "limitations",
    "missing_facts",
    "regulatory_considerations"
  ]
};
/** ---------------------------
 * OpenAI helper (Responses API)
 * --------------------------- */ async function openaiGenerateReport(apiKey, model, inputObj, promptVersion) {
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
                "Generate a SELF-SERVE complaint report in STRICT JSON matching the schema.",
                "Write in FIRST PERSON as the complainant (I / my).",
                "Do not invent facts; use only extract_json and decision_json.",
                "If something is unknown, use null/unclear and add it to missing_facts.",
                "Do NOT make legal conclusions or predictions (liability / reimbursement likelihood).",
                "Avoid asserting bank actions unless explicitly confirmed by extracted facts.",
                "Avoid asserting scammer actions unless explicitly confirmed by extracted facts.",
                "Avoid using the word 'unauthorized' — prefer 'disputed transfers' / 'loss due to scam'.",
                "If OTP/credentials/link involved: describe neutrally 'I was deceived into sharing details'.",
                "In disputed_transactions, set authorised to ONLY one of: yes, no, unclear, or null. Put explanations in notes.",
                "If payee was added but agent is unknown: write 'a new payee was added' (do not say who added it).",
                "Use: requested resolution = reversal/restoration + investigation details + confirmation of safeguards.",
                "Tone factual and respectful; audience is bank complaints team.",
                "Do not give legal advice; include disclaimers + limitations.",
                "Use regulatory_considerations ONLY from provided regulatory_context.",
                "For regulatory_considerations, keep each item concise, plain-English, and complaint-friendly.",
                "Do not state that any clause was breached; frame clauses as relevant considerations only.",
                "Do not invent regulatory references, source names, clause references, or summaries.",
                `PromptVersion=${promptVersion}`
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
          name: "self_serve_report_v1",
          schema: REPORT_JSON_SCHEMA
        }
      }
    })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI report failed (${res.status}): ${raw}`);
  const payload = JSON.parse(raw);
  const outText = payload?.output?.[0]?.content?.[0]?.text;
  if (!outText) throw new Error(`OpenAI report returned unexpected payload: ${raw.slice(0, 2000)}`);
  return JSON.parse(outText);
}
/** ---------------------------
 * Deep scrub helper (walk + rewrite all strings)
 * --------------------------- */ function scrubEverywhere(obj, transform) {
  const seen = new Set();
  const walk = (x)=>{
    if (x == null) return;
    if (typeof x !== "object") return;
    if (seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) {
      for(let i = 0; i < x.length; i++){
        const v = x[i];
        if (typeof v === "string") x[i] = transform(v);
        else walk(v);
      }
      return;
    }
    for (const k of Object.keys(x)){
      const v = x[k];
      if (typeof v === "string") x[k] = transform(v);
      else walk(v);
    }
  };
  walk(obj);
}
/** ---------------------------
 * Strong list dedupe + normalization
 * --------------------------- */ function normKey(s) {
  return s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").replace(/\bstatements\b/g, "statement").replace(/\btransactions\b/g, "transaction").replace(/\btransfers\b/g, "transfer").replace(/\bscreenshots\b/g, "screenshot").replace(/\brecords\b/g, "record").replace(/\bemails\b/g, "email").replace(/\bmessages\b/g, "message");
}
function dedupeList(items, max = 50) {
  const arr = Array.isArray(items) ? items : [];
  const seen = new Set();
  const out = [];
  for (const v of arr){
    const s = toStr(v).trim();
    if (!s) continue;
    const key = normKey(s);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
/** ---------------------------
 * Text guardrails
 * --------------------------- */ function removeLegalConclusions(s) {
  return s.replace(/\b(the bank|the institution)\s+is\s+not\s+liable\b/gi, "the bank’s liability should be assessed").replace(/\bthe bank\s+is\s+liable\b/gi, "the bank’s liability should be assessed").replace(/\bunlikely to be (reimbursed|refunded)\b/gi, "to be assessed").replace(/\blikely to be (reimbursed|refunded)\b/gi, "to be assessed");
}
function neutralizeUnauthorizedLanguage(s) {
  return s.replace(/\bunauthori[sz]ed\b/gi, "disputed").replace(/\bdisputed\s+loss\b/gi, "loss due to scam");
}
function softenUnauthorizedTransactionsPhrases(s) {
  return s.replace(/\bunauthori[sz]ed transactions?\b/gi, "disputed transfers").replace(/\bunauthori[sz]ed transfer(s)?\b/gi, "disputed transfer(s)");
}
/**
 * Prevent “bank did not attempt / no block / lack of...”
 * Always rewrite into confirmation requests.
 */ function neutralizeBankActionAssertions(s) {
  return s.replace(/\bbank actions?\s+including\b/gi, "information requested about").replace(/\black of\s+(a\s+)?transaction\s+block\s+attempt\b/gi, "Please confirm whether any transaction monitoring/blocks were triggered").replace(/\black of\s+(any\s+)?transaction\s+block(ing)?\b/gi, "Please confirm whether any transaction monitoring/blocks were triggered").replace(/\black of (any )?(transaction\s+block(ing)?|transaction\s+blocking)\s*(or|\/)\s*(step-?up|additional)\s+authentication\b/gi, "Please confirm whether any transaction monitoring/blocks or step-up authentication/additional verification were triggered").replace(/\b(did not|didn't)\s+(attempt|try)\s+to\s+block\b/gi, "Please confirm whether any transaction monitoring/blocks were triggered").replace(/\bno\s+(step-?up|additional)\s+authentication\s+(was|were)\s+(used|triggered|attempted)\b/gi, "Please confirm whether any step-up authentication/additional verification was triggered").replace(/\b(step-?up|additional)\s+authentication\s+(was|were)\s+not\s+(used|triggered|attempted)\b/gi, "Please confirm whether any step-up authentication/additional verification was triggered");
}
/**
 * If payee_added_agent is unknown, prevent "DBS/bank/institution added payee"
 * AND prevent "scammer added payee" phrasing.
 */ function neutralizePayeeAttributionClaims(s) {
  return s// bank/institution attribution
  .replace(/\b(the bank|the institution)\s+added\s+(the|a)\s+payee\b/gi, "a new payee was added").replace(/\b(bank|institution)\s+added\s+(the|a)\s+payee\b/gi, "a new payee was added").replace(/\b([A-Z][A-Z0-9&.\-]{1,20})\s+added\s+(the|a)\s+payee\b/g, "a new payee was added")// scammer attribution (your current regression)
  .replace(/\b(the )?(scammer|fraudster|attacker)\s+added\s+(the|a)\s+payee\b/gi, "a new payee was added").replace(/\benabling the scammer to add a payee\b/gi, "which resulted in a new payee being added");
}
/** Fix awkward artefacts like "transfer(s)(s)" */ function fixArtefacts(s) {
  return s.replace(/transfer\(s\)\(s\)/gi, "transfer(s)").replace(/disputed transfer\(s\)\(s\)/gi, "disputed transfer(s)").replace(/\btransfer\(s\)\s*\(s\)\b/gi, "transfer(s)").replace(/\s+/g, " ").trim();
}
/** Remove narrative that implies “authorised by me” in exec summary etc */ function neutralizeAuthorisedNarrative(s) {
  return s.replace(/\bled to the transaction being authorised\b/gi, "resulted in disputed transfer(s) and loss").replace(/\bwhich led to the transaction being authorised\b/gi, "which resulted in disputed transfer(s) and loss").replace(/\bbeing authorised by me\b/gi, "occurring after deception").replace(/\bwhich led to the transaction being authorised by me\b/gi, "which resulted in disputed transfer(s) and loss");
}
/** Normalize punctuation + spacing */ function normalizePunctuation(s) {
  if (!s) return s;
  s = s.replace(/\.{2,}/g, ".");
  s = s.replace(/\s+([.,;:!?])/g, "$1");
  s = s.replace(/\.\s*(?=[A-Za-z])/g, ". ");
  s = s.replace(/\s{2,}/g, " ");
  return s.trim();
}
/**
 * Fix “The bank please confirm …” and similar glue.
 * This is intentionally seeing more than just a single pattern.
 */ function fixPleaseConfirmGlue(s) {
  return s.replace(/\bthe bank please confirm\b/gi, "Please confirm").replace(/\bbank please confirm\b/gi, "Please confirm").replace(/\s+but\s+please confirm\b/gi, ". Please confirm").replace(/\s+and\s+please confirm\b/gi, ". Please confirm").replace(/\s+but\s+Please confirm\b/gi, ". Please confirm");
}
/** Evidence checklist has recurring glue: "Information on information requested..." */ function fixEvidenceChecklistSpecific(s) {
  return s.replace(/\bInformation on information requested about\b/gi, "Information requested about").replace(/\binformation on information requested about\b/gi, "Information requested about").replace(/\bInformation requested about payee addition\b/gi, "Information requested regarding payee addition").replace(/\bpayee addition\.?\s*Please confirm whether\b/gi, "payee addition. Please confirm whether");
}
/** Targeted garble cleanup you observed */ function fixGarbledSentences(s) {
  s = s.replace(/\ba new payee was added\s+involved\s+but\s+please confirm whether any transaction monitoring\/blocks were triggered for the transaction\s+or\s+apply\s+step-?up authentication\.?/gi, "A new payee was added; please confirm whether any transaction monitoring/blocks or step-up authentication/additional verification were triggered for the transaction.");
  s = s.replace(/\ba new payee was added\s+but\s+please confirm whether any transaction monitoring\/blocks were triggered for the transaction\s+or\s+apply\s+step-?up authentication\.?/gi, "A new payee was added; please confirm whether any transaction monitoring/blocks or step-up authentication/additional verification were triggered for the transaction.");
  s = s.replace(/\bwas added involved\b/gi, "was added");
  s = s.replace(/\bwere triggered the transaction\b/gi, "were triggered for the transaction");
  s = s.replace(/\bor apply step-?up authentication\b/gi, "or whether step-up authentication/additional verification was triggered");
  s = s.replace(/^\s*a new payee was added\b/, "A new payee was added");
  return s;
}
/**
 * Softens affirmative bank-control wording into bank-claim / confirmation style (deterministic, single-pass safe).
 */ function rewriteBankAssertionText(s) {
  if (typeof s !== "string" || !s) return s;
  let out = s;
  out = out.replace(/\bhas stated that\s+the bank\s+has stated that/gi, "the bank has stated that");
  out = out.replace(/\bhas stated that\s+([A-Z][A-Za-z0-9&.\-]{1,40})\s+has stated that/g, (_, n)=>`${n} has stated that`);
  out = out.replace(/step-up authentication was used and attempted to block the transaction/gi, "step-up authentication was used and that transaction blocking was attempted");
  out = out.replace(/has stated that step-up authentication was used and attempted to block/gi, "has stated that step-up authentication was used and that transaction blocking was attempted");
  out = out.replace(/\b([A-Z][A-Za-z0-9&.\-]{1,40})\s+applied\s+step-?up\s+authentication\b/g, (_, b)=>`${b} has stated that step-up authentication was used`);
  out = out.replace(/\bthe\s+bank\s+applied\s+step-?up\s+authentication\b/gi, "the bank has stated that step-up authentication was used");
  out = out.replace(/\b([A-Z][A-Za-z0-9&.\-]{1,40})\s+used\s+step-?up\s+authentication\b/g, (_, b)=>`${b} has stated that step-up authentication was used`);
  out = out.replace(/\bthe\s+bank\s+used\s+step-?up\s+authentication\b/gi, "the bank has stated that step-up authentication was used");
  out = out.replace(/\b([A-Z][A-Za-z0-9&.\-]{1,40})\s+attempted\s+to\s+block\s+the\s+transaction\b/g, (_, b)=>`${b} has stated that transaction blocking was attempted for the transaction`);
  out = out.replace(/\bthe\s+bank\s+attempted\s+to\s+block\s+the\s+transaction\b/gi, "the bank has stated that transaction blocking was attempted for the transaction");
  out = out.replace(/\b([A-Z][A-Za-z0-9&.\-]{1,40})\s+attempted\s+to\s+block\b/g, (_, b)=>`${b} has stated that transaction blocking was attempted`);
  out = out.replace(/\bthe\s+bank\s+attempted\s+to\s+block\b/gi, "the bank has stated that transaction blocking was attempted");
  out = out.replace(/\battempted\s+to\s+block\s+the\s+transaction\b/gi, (m, offset, full)=>{
    const before = full.slice(Math.max(0, offset - 80), offset);
    if (/\bhas stated that\b/i.test(before)) return m;
    return "the bank has stated that transaction blocking was attempted for the transaction";
  });
  out = out.replace(/\bstep-?up\s+authentication\s+was\s+used\b/gi, (m, offset, full)=>{
    const before = full.slice(Math.max(0, offset - 50), offset);
    if (/\bhas stated that\s*$/i.test(before.trimEnd())) return m;
    return "the bank has stated that step-up authentication was used";
  });
  out = out.replace(/\btransaction\s+blocking\s+was\s+attempted\b/gi, (m, offset, full)=>{
    const before = full.slice(Math.max(0, offset - 50), offset);
    if (/\bhas stated that\s*$/i.test(before.trimEnd())) return m;
    return "the bank has stated that transaction blocking was attempted";
  });
  if (out.includes("has stated that") && !/\b(the\s+bank|[A-Z][A-Za-z0-9&.\-]{1,40})\s+(used|applied)\s+step-?up\s+authentication\b/i.test(out) && !/\b(the\s+bank|[A-Z][A-Za-z0-9&.\-]{1,40})\s+attempted\s+to\s+block\b/i.test(out)) {
    const passive = /\bstep-?up\s+authentication\s+was\s+used\b/i.exec(out);
    const passiveTb = /\btransaction\s+blocking\s+was\s+attempted\b/i.exec(out);
    const passiveOk = (tok)=>{
      if (!tok) return true;
      const before = out.slice(Math.max(0, tok.index - 50), tok.index);
      return /\bhas stated that\s*$/i.test(before.trimEnd());
    };
    if (passiveOk(passive) && passiveOk(passiveTb)) return out;
  }
  return out;
}
/**
 * Deterministic cleanup of executive_summary from extract_json: hard merchant normalization when payee is known; one merchant mention.
 */ function fixExecutiveSummaryMerchantAndLoss(summary, extractJson) {
  let s = toStr(summary);
  const { disputedMerchant } = computeExtractDerivedTotals(extractJson);
  s = s.replace(/I transferred a total of ([A-Z]{3})\s?([\d,]+) to an unknown merchant\.?/gi, (_, cur, amt)=>{
    if (disputedMerchant) return `A total of ${cur} ${amt} was transferred to '${disputedMerchant}', a merchant I do not recognise.`;
    return `A total of ${cur} ${amt} was transferred to a merchant I do not recognise.`;
  });
  if (!disputedMerchant) return normalizePunctuation(s);
  const esc = disputedMerchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mq = `'${disputedMerchant}'`;
  const token = `merchant ${mq}`;
  s = s.replace(/I transferred a total of [\s\S]*?unknown merchant\.?/gi, "");
  s = s.replace(/unknown overseas merchant named ['"](.+?)['"]/gi, token);
  s = s.replace(/unknown merchant ['"](.+?)['"]/gi, token);
  s = s.replace(/\bto an unknown merchant\b/gi, `to ${token}`);
  s = s.replace(/\bto unknown merchant\b/gi, `to ${token}`);
  s = s.replace(/unknown merchant/gi, token);
  let seenTok = false;
  s = s.replace(new RegExp(`merchant\\s+['"]${esc}['"]`, "gi"), ()=>{
    if (!seenTok) {
      seenTok = true;
      return token;
    }
    return "";
  });
  const parts = s.split(/\n\n+/).map((p)=>p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const escRe = new RegExp(esc, "i");
    const kept = [];
    let haveMerchant = false;
    for (const p of parts){
      const mentions = escRe.test(p);
      if (mentions && /^I\s+transferred\s+a\s+total\s+of\b/i.test(p) && haveMerchant) continue;
      if (mentions) haveMerchant = true;
      kept.push(p);
    }
    s = kept.join("\n\n");
  }
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
  return normalizePunctuation(s);
}
/** ---------------------------
 * Authorised enum enforcement
 * --------------------------- */ function enforceAuthorisedEnum(reportJson) {
  const txs = reportJson?.disputed_transactions;
  if (!Array.isArray(txs)) return;
  const allowed = new Set([
    "yes",
    "no",
    "unclear",
    null
  ]);
  for (const tx of txs){
    if (!tx || typeof tx !== "object") continue;
    const a = tx.authorised;
    if (typeof a === "string") {
      const norm = a.trim().toLowerCase();
      if (!allowed.has(norm)) {
        const existingNotes = typeof tx.notes === "string" ? tx.notes : "";
        const moved = `Authorisation context: ${a}`;
        tx.notes = existingNotes ? `${existingNotes} ${moved}` : moved;
        tx.authorised = "unclear";
      } else {
        tx.authorised = norm;
      }
    } else if (a !== null && a !== undefined) {
      tx.authorised = "unclear";
    }
  }
}
/** Deep-walk and apply final sanitizers. Evidence checklist gets extra handling. */ function finalSanitizeReport(reportJson) {
  const walk = (v, path = [])=>{
    if (typeof v === "string") {
      let out = v;
      out = fixGarbledSentences(out);
      out = fixPleaseConfirmGlue(out);
      // evidence checklist items: extra fixes
      const isEvidenceChecklistItem = path.length >= 2 && path[path.length - 2] === "evidence_checklist" && /^\d+$/.test(path[path.length - 1]);
      if (isEvidenceChecklistItem) out = fixEvidenceChecklistSpecific(out);
      out = normalizePunctuation(out);
      return out;
    }
    if (Array.isArray(v)) return v.map((x, i)=>walk(x, [
        ...path,
        String(i)
      ]));
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v))out[k] = walk(val, [
        ...path,
        k
      ]);
      return out;
    }
    return v;
  };
  const out = walk(reportJson, []);
  enforceAuthorisedEnum(out);
  return out;
}
/** ---------------------------
 * Extract-derived totals + merchant (deterministic enrichment)
 * --------------------------- */ function safeReportNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function normalizeReportCurrency(v) {
  if (v === null || v === undefined) return null;
  const c = String(v).trim().toUpperCase();
  if (!c) return null;
  if (c === "S$" || c === "S") return "SGD";
  return c;
}
function sumLossesAmounts(losses) {
  if (!Array.isArray(losses)) return null;
  let sum = 0;
  let any = false;
  for (const L of losses){
    const a = safeReportNumber(L?.amount);
    if (a !== null) {
      sum += a;
      any = true;
    }
  }
  return any ? sum : null;
}
function extractRegulatoryClauseIds(decisionJson) {
  const out = [];
  const seen = new Set();
  const pushId = (v)=>{
    const s = toStr(v).trim();
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  const refs = decisionJson?.references ?? {};
  const refList = refs?.regulatory_clauses ?? refs?.regulatory_clause_ids ?? [];
  if (Array.isArray(refList)) {
    for (const r of refList){
      if (typeof r === "string") pushId(r);
      else if (r && typeof r === "object") pushId(r.id ?? r.clause_id ?? r.regulatory_clause_id);
    }
  }
  const maybeArrays = [
    decisionJson?.regulatory_clauses,
    decisionJson?.regulatory_clause_ids
  ];
  for (const arr of maybeArrays){
    if (!Array.isArray(arr)) continue;
    for (const r of arr){
      if (typeof r === "string") pushId(r);
      else if (r && typeof r === "object") pushId(r.id ?? r.clause_id ?? r.regulatory_clause_id);
    }
  }
  return out;
}
function shortClauseSummary(row) {
  const plain = toStr(row?.plain_english_summary).trim();
  if (plain) return plain;
  const excerpt = toStr(row?.excerpt).replace(/\s+/g, " ").trim();
  if (excerpt) {
    if (excerpt.length <= 280) return excerpt;
    return `${excerpt.slice(0, 277).trim()}...`;
  }
  const textContent = toStr(row?.text_content).replace(/\s+/g, " ").trim();
  if (!textContent) return "";
  if (textContent.length <= 280) return textContent;
  return `${textContent.slice(0, 277).trim()}...`;
}
function buildRegulatoryContext(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows){
    const title = toStr(row?.title).trim();
    const summary = shortClauseSummary(row);
    if (!title || !summary) continue;
    out.push({
      title,
      source_name: toStr(row?.source_name ?? row?.source_ref).trim() || null,
      clause_ref: toStr(row?.clause_ref).trim() || null,
      summary
    });
    if (out.length >= 5) break;
  }
  return out;
}
function neutralizeRegulatorySummaryText(s) {
  let out = toStr(s);
  out = out.replace(/\bthe bank is liable\b/gi, "liability should be assessed based on the available facts");
  out = out.replace(/\bthis proves\b/gi, "this may indicate");
  out = out.replace(/\bguarantees reimbursement\b/gi, "may support a reimbursement review");
  return normalizePunctuation(out);
}
function normalizeRegulatoryConsiderations(reportJson) {
  const arr = Array.isArray(reportJson?.regulatory_considerations) ? reportJson.regulatory_considerations : [];
  const out = [];
  const seen = new Set();
  for (const item of arr){
    const title = toStr(item?.title).trim();
    const summary = neutralizeRegulatorySummaryText(item?.summary).trim();
    const source_name = toStr(item?.source_name).trim() || null;
    const clause_ref = toStr(item?.clause_ref).trim() || null;
    if (!title || !summary) continue;
    const key = `${normKey(title)}|${normKey(clause_ref ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      summary,
      source_name,
      clause_ref
    });
    if (out.length >= 5) break;
  }
  reportJson.regulatory_considerations = out;
}
/**
 * Reads reported_loss → case_meta → sum(losses.amount); currency same order; merchant from transaction.
 */ function computeExtractDerivedTotals(extractJson) {
  const rl = extractJson?.reported_loss ?? {};
  let totalAmount = safeReportNumber(rl?.amount);
  let totalCurrency = normalizeReportCurrency(rl?.currency);
  const cm = extractJson?.case_meta ?? {};
  if (totalAmount === null) totalAmount = safeReportNumber(cm?.claim_amount);
  if (!totalCurrency) totalCurrency = normalizeReportCurrency(cm?.claim_currency);
  if (totalAmount === null) totalAmount = sumLossesAmounts(extractJson?.losses);
  if (!totalCurrency && Array.isArray(extractJson?.losses)) {
    for (const L of extractJson.losses){
      const c = normalizeReportCurrency(L?.currency);
      if (c) {
        totalCurrency = c;
        break;
      }
    }
  }
  if (!totalCurrency) totalCurrency = "SGD";
  const dm = extractJson?.transaction?.disputed_merchant ?? null;
  const disputedMerchant = typeof dm === "string" && dm.trim() ? dm.trim() : null;
  return {
    totalAmount,
    totalCurrency,
    disputedMerchant
  };
}
function patchDisputedTransactionsTotalRow(disputedTransactions, totalAmount, totalCurrency) {
  if (!Array.isArray(disputedTransactions) || disputedTransactions.length <= 1) return;
  const amt = typeof totalAmount === "number" && Number.isFinite(totalAmount) ? totalAmount : null;
  const cur = totalCurrency || "SGD";
  for(let i = disputedTransactions.length - 1; i >= 0; i--){
    const row = disputedTransactions[i];
    if (!row || typeof row !== "object") continue;
    const lab = toStr(row.label).trim();
    if (!lab) continue;
    if (/\btotal\b/i.test(lab)) {
      row.amount = amt;
      row.currency = cur;
      return;
    }
  }
  for(let i = 0; i < disputedTransactions.length; i++){
    const row = disputedTransactions[i];
    if (!row || typeof row !== "object") continue;
    const lab = toStr(row.label).trim().toLowerCase();
    if (lab === "total" || lab.startsWith("total ") || lab.includes("total amount")) {
      row.amount = amt;
      row.currency = cur;
      return;
    }
  }
}
/** Patch executive summary + totals + disputed_transactions from extract_json (no schema change). */ function applyExtractDerivedEnrichment(reportJson, extractJson) {
  const { totalAmount, totalCurrency, disputedMerchant } = computeExtractDerivedTotals(extractJson);
  const totalCurrencyResolved = totalCurrency || "SGD";
  const amountPhrase = typeof totalAmount === "number" && Number.isFinite(totalAmount) ? `${totalCurrencyResolved} ${totalAmount}` : `amount not confirmed (${totalCurrencyResolved})`;
  let es = toStr(reportJson?.executive_summary);
  const replacementClause = disputedMerchant ? `transferred a total of ${amountPhrase} as a disputed transfer to merchant '${disputedMerchant}'` : `transferred a total of ${amountPhrase} to an unknown merchant`;
  const reTransferred = /(\bI\s+)?transferred a total of\s+[^.!?\n]+([.!?]|$)/i;
  if (reTransferred.test(es)) {
    es = es.replace(reTransferred, (m, iPrefix, punct)=>{
      const lead = iPrefix ? "I " : "";
      const end = typeof punct === "string" && punct.match(/[.!?]/) ? punct : ".";
      return `${lead}${replacementClause}${end}`;
    });
  } else {
    es = `${es.trim()}\n\nI ${replacementClause}.`.trim();
  }
  reportJson.executive_summary = normalizePunctuation(es);
  reportJson.totals = reportJson.totals && typeof reportJson.totals === "object" ? reportJson.totals : {};
  reportJson.totals.total_amount = typeof totalAmount === "number" && Number.isFinite(totalAmount) ? totalAmount : null;
  reportJson.totals.currency = totalCurrencyResolved;
  const losses = Array.isArray(extractJson?.losses) ? extractJson.losses : [];
  if (losses.length === 1) {
    const prev = Array.isArray(reportJson.disputed_transactions) && reportJson.disputed_transactions[0] ? reportJson.disputed_transactions[0] : {};
    const amt = typeof totalAmount === "number" && Number.isFinite(totalAmount) ? totalAmount : safeReportNumber(losses[0]?.amount);
    const cur = totalCurrencyResolved;
    const label = disputedMerchant ? `Disputed transfer — ${disputedMerchant}` : toStr(prev?.label).trim() || "Disputed transfer(s) due to phishing scam";
    reportJson.disputed_transactions = [
      {
        label,
        amount: amt ?? null,
        currency: cur,
        authorised: prev.authorised != null ? prev.authorised : "unclear",
        notes: typeof prev.notes === "string" ? prev.notes : prev.notes != null ? toStr(prev.notes) : null
      }
    ];
  } else if (Array.isArray(reportJson.disputed_transactions)) {
    patchDisputedTransactionsTotalRow(reportJson.disputed_transactions, totalAmount, totalCurrencyResolved);
  }
}
/** ---------------------------
 * Facts-derived booleans for guardrails
 * --------------------------- */ function hasProvidedOtpOrCredsOrLink(extractJson) {
  const ca = extractJson?.customer_actions ?? {};
  return Boolean(ca.shared_otp === true || ca.provided_credentials === true || ca.clicked_phishing_link === true);
}
function forceNeutralAuthorised(reportJson, enabled) {
  if (!enabled) return;
  if (!Array.isArray(reportJson?.disputed_transactions)) return;
  for (const tx of reportJson.disputed_transactions){
    tx.authorised = "unclear";
    const existingNotes = typeof tx.notes === "string" ? tx.notes.trim() : "";
    const extra = "I did not intend these transfers; I was deceived during the phishing incident.";
    tx.notes = existingNotes ? `${existingNotes} ${extra}` : extra;
  }
}
/** ---------------------------
 * Final shaping + dedupe
 * --------------------------- */ function ensureDefaults(reportJson) {
  reportJson.title = toStr(reportJson.title) || "Complaint Report";
  reportJson.executive_summary = toStr(reportJson.executive_summary) || "";
  reportJson.timeline = Array.isArray(reportJson.timeline) ? reportJson.timeline : [];
  reportJson.disputed_transactions = Array.isArray(reportJson.disputed_transactions) ? reportJson.disputed_transactions : [];
  reportJson.key_responsibility_points = Array.isArray(reportJson.key_responsibility_points) ? reportJson.key_responsibility_points : [];
  reportJson.requested_resolution = Array.isArray(reportJson.requested_resolution) ? reportJson.requested_resolution : [];
  reportJson.evidence_checklist = Array.isArray(reportJson.evidence_checklist) ? reportJson.evidence_checklist : [];
  reportJson.disclaimers = Array.isArray(reportJson.disclaimers) ? reportJson.disclaimers : [];
  reportJson.limitations = Array.isArray(reportJson.limitations) ? reportJson.limitations : [];
  reportJson.missing_facts = Array.isArray(reportJson.missing_facts) ? reportJson.missing_facts : [];
  reportJson.regulatory_considerations = Array.isArray(reportJson.regulatory_considerations) ? reportJson.regulatory_considerations : [];
  // Final dedupe pass
  reportJson.key_responsibility_points = dedupeList(reportJson.key_responsibility_points, 25);
  reportJson.requested_resolution = dedupeList(reportJson.requested_resolution, 25);
  reportJson.evidence_checklist = dedupeList(reportJson.evidence_checklist, 25);
  reportJson.disclaimers = dedupeList(reportJson.disclaimers, 15);
  reportJson.limitations = dedupeList(reportJson.limitations, 15);
  reportJson.missing_facts = dedupeList(reportJson.missing_facts, 30);
  normalizeRegulatoryConsiderations(reportJson);
  // Keep disputed_transactions small + clean labels
  if (reportJson.disputed_transactions.length > 5) {
    reportJson.disputed_transactions = reportJson.disputed_transactions.slice(0, 5);
  }
  for (const tx of reportJson.disputed_transactions){
    const label = toStr(tx?.label).trim();
    if (!label) tx.label = "Disputed transfer(s) due to phishing scam";
    else tx.label = fixArtefacts(label);
    if (typeof tx.notes !== "string") tx.notes = toStr(tx.notes) || null;
    if (tx.authorised == null) tx.authorised = "unclear";
  }
}
/** ---------------------------
 * Main handler (NO JWT)
 * --------------------------- */ serve(async (req)=>{
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction") ?? "";
  const MODEL = Deno.env.get("SELF_SERVE_REPORT_MODEL") ?? "gpt-4.1-mini";
  const SIMULATION_KEY = Deno.env.get("SIMULATION_KEY") ?? "";
  if (!SUPABASE_URL) return textResp("Missing SUPABASE_URL", 500);
  if (!SUPABASE_SERVICE_ROLE_KEY) return textResp("Missing SUPABASE_SERVICE_ROLE_KEY", 500);
  if (!OPENAI_API_KEY) return textResp("Missing GuideBuoy_EdgeFunction secret", 500);
  if (!SIMULATION_KEY) return textResp("Missing SIMULATION_KEY secret", 500);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    if (req.method !== "POST") return textResp("POST only", 405);
    const body = await req.json().catch(()=>({}));
    if (body.simulation_key !== SIMULATION_KEY) {
      return jsonResp({
        ok: false,
        error: "missing_or_invalid_simulation_key"
      }, 401);
    }
    const case_id = body.case_id;
    const force = body.force ?? false;
    const promptVersion = body.prompt_version ?? "selfserve_v1.6_exec_summary_normalize_and_checklist_fix";
    if (!case_id) return jsonResp({
      ok: false,
      error: "Missing case_id"
    }, 400);
    const user_id = typeof body.user_id === "string" ? body.user_id : null;
    /** 1) Idempotency: reuse latest report for case_id */ if (!force) {
      const { data: existing, error: exErr } = await supabaseAdmin.from("reports").select("id, user_id, case_id, status, report_json, created_at, updated_at").eq("case_id", case_id).order("created_at", {
        ascending: false
      }).limit(1).maybeSingle();
      if (exErr) throw new Error(`reports select error: ${JSON.stringify(exErr)}`);
      if (existing?.report_json) {
        return jsonResp({
          ok: true,
          reused: true,
          report_id: existing.id,
          case_id,
          user_id: existing.user_id,
          status: existing.status,
          report_json: existing.report_json
        });
      }
    }
    /** 2) Fetch latest decision run for case */ const { data: decisionRun, error: decErr } = await supabaseAdmin.from("case_decision_runs").select("id, case_id, decision_json, extract_run_id, created_at").eq("case_id", case_id).order("created_at", {
      ascending: false
    }).limit(1).maybeSingle();
    if (decErr) throw new Error(`case_decision_runs query error: ${JSON.stringify(decErr)}`);
    if (!decisionRun) return jsonResp({
      ok: false,
      error: "No case_decision_runs found for case_id"
    }, 404);
    if (!decisionRun.extract_run_id) return jsonResp({
      ok: false,
      error: "Decision run missing extract_run_id"
    }, 500);
    /** 3) Fetch extract run using extract_run_id */ const { data: extractRun, error: erErr } = await supabaseAdmin.from("case_extract_runs").select("id, case_id, extract_json, missing_fields, created_at").eq("id", decisionRun.extract_run_id).maybeSingle();
    if (erErr) throw new Error(`case_extract_runs query error: ${JSON.stringify(erErr)}`);
    if (!extractRun) return jsonResp({
      ok: false,
      error: "No case_extract_run found for extract_run_id"
    }, 404);
    const extractJson = extractRun.extract_json ?? {};
    const decisionJson = decisionRun.decision_json ?? {};
    const missingFields = extractRun.missing_fields ?? null;
    const regulatoryClauseIds = extractRegulatoryClauseIds(decisionJson);
    let regulatoryContext = [];
    if (regulatoryClauseIds.length > 0) {
      const { data: regulatoryRows, error: rcErr } = await supabaseAdmin.from("regulatory_clauses").select("id, title, clause_ref, source_ref, text_content").in("id", regulatoryClauseIds).limit(10);
      if (rcErr) {
        console.warn("regulatory_clauses query warning:", JSON.stringify(rcErr));
      } else {
        regulatoryContext = buildRegulatoryContext(regulatoryRows ?? []);
      }
    }
    /** 4) Build model input */ const caseMeta = extractJson?.case_meta ?? {};
    const timeline = extractJson?.timeline ?? {};
    const losses = Array.isArray(extractJson?.losses) ? extractJson.losses : [];
    const institutionName = caseMeta?.institution_name ?? null;
    const currency = caseMeta?.claim_currency ?? losses?.[0]?.currency ?? null;
    const reportInput = {
      case_id,
      user_id,
      extract_run_id: extractRun.id,
      decision_run_id: decisionRun.id,
      extract_json: extractJson,
      decision_json: decisionJson,
      missing_fields: missingFields,
      regulatory_context: regulatoryContext,
      derived: {
        institution_name: institutionName,
        jurisdiction: caseMeta?.jurisdiction ?? null,
        claim_type: caseMeta?.claim_type ?? null,
        incident_at: timeline?.incident_at ?? null,
        discovered_at: timeline?.discovered_at ?? null,
        reported_to_institution_at: timeline?.reported_to_institution_at ?? null,
        losses,
        currency
      }
    };
    /** 5) Generate report JSON */ let reportJson = await openaiGenerateReport(OPENAI_API_KEY, MODEL, reportInput, promptVersion);
    /** 6) Server invariants */ reportJson.report_version = REPORT_VERSION;
    reportJson.case_id = case_id;
    reportJson.generated_at = nowIso();
    /**
     * ORDER MATTERS
     *  - broad scrubs (facts-safe)
     *  - OTP/creds enforcement
     *  - payee agent attribution neutralization
     *  - enrich missing facts
     *  - extract-derived enrichment → FINAL FIX (exec merchant + bank wording) → final sanitize
     *  - ensureDefaults + dedupe
     */ /** 7) Broad scrubs */ scrubEverywhere(reportJson, fixArtefacts);
    scrubEverywhere(reportJson, removeLegalConclusions);
    scrubEverywhere(reportJson, neutralizeUnauthorizedLanguage);
    scrubEverywhere(reportJson, softenUnauthorizedTransactionsPhrases);
    scrubEverywhere(reportJson, neutralizeBankActionAssertions);
    scrubEverywhere(reportJson, neutralizeAuthorisedNarrative);
    scrubEverywhere(reportJson, fixPleaseConfirmGlue);
    /** 8) OTP/creds/link => authorised="unclear" */ const providedOtpCredsLink = hasProvidedOtpOrCredsOrLink(extractJson);
    if (providedOtpCredsLink) {
      forceNeutralAuthorised(reportJson, true);
    }
    /** 9) Payee agent attribution safety */ const ia = extractJson?.institution_actions ?? {};
    const payeeAdded = ia?.payee_added === true;
    const agent = ia?.payee_added_agent;
    const agentKnown = typeof agent === "string" && agent.trim().length > 0;
    // If agent is unknown, strip *any* "X added payee" attribution (bank OR scammer)
    if (payeeAdded && !agentKnown) {
      scrubEverywhere(reportJson, neutralizePayeeAttributionClaims);
      reportJson.missing_facts = dedupeList([
        ...reportJson.missing_facts ?? [],
        "Please provide details on how and when the new payee was added, including channel, device, IP address, and time.",
        "Bank to confirm how the new payee was added (channel/device/IP/time) and whether any payee alerts were triggered."
      ], 30);
    }
    /** 10) Always enrich missing_facts for controls (confirm-only wording) */ reportJson.missing_facts = dedupeList([
      ...reportJson.missing_facts ?? [],
      "Bank to confirm whether any step-up authentication/additional verification was triggered for the payee addition and transfers (and if not, why not).",
      "Bank to confirm whether any transaction monitoring/blocks were triggered, and provide the investigation findings for why the transfers proceeded."
    ], 30);
    /** 10b) Deterministic totals / disputed_transactions / exec clause from extract_json */ applyExtractDerivedEnrichment(reportJson, extractJson);
    /** FINAL FIX (after all generation + enrichment; immediately before finalSanitizeReport) */ reportJson.executive_summary = fixExecutiveSummaryMerchantAndLoss(toStr(reportJson.executive_summary), extractJson);
    scrubEverywhere(reportJson, rewriteBankAssertionText);
    console.log("FINAL FIX APPLIED");
    /** 11) Final sanitization pass (glue/punctuation + enum enforcement) */ reportJson = finalSanitizeReport(reportJson);
    /** 12) Final shaping + dedupe */ ensureDefaults(reportJson);
    /** 12b) FINAL SAFETY NET: hard exec_summary merchant normalization after all other report processing */ reportJson.executive_summary = fixExecutiveSummaryMerchantAndLoss(toStr(reportJson.executive_summary), extractJson);
    /** 13) Insert report */ const { data: inserted, error: insErr } = await supabaseAdmin.from("reports").insert({
      user_id,
      case_id,
      status: "COMPLETED",
      report_json: reportJson,
      created_at: nowIso(),
      updated_at: nowIso()
    }).select("id, user_id, case_id, status, report_json, created_at, updated_at").single();
    if (insErr) throw new Error(`reports insert error: ${JSON.stringify(insErr)}`);
    /** 14) Return */ return jsonResp({
      ok: true,
      reused: false,
      report_id: inserted.id,
      case_id,
      user_id: inserted.user_id,
      status: inserted.status,
      report_json: inserted.report_json,
      debug: {
        decision_run_id: decisionRun.id,
        extract_run_id: extractRun.id,
        prompt_version: promptVersion,
        model: MODEL,
        derived: {
          payee_added: ia?.payee_added ?? null,
          payee_added_agent: ia?.payee_added_agent ?? null,
          provided_otp_or_creds_or_link: providedOtpCredsLink,
          step_up_authentication_used: ia?.step_up_authentication_used ?? null,
          transaction_block_attempted: ia?.transaction_block_attempted ?? null
        }
      }
    });
  } catch (e) {
    const errText = errToText(e);
    console.error("run_report_selfserve_v1 ERROR:", errText);
    return textResp(errText, 500);
  }
});
