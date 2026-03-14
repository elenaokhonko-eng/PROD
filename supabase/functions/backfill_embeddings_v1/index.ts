// supabase/functions/backfill_embeddings_v1/index.ts
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
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
function textResp(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}
async function openaiEmbed(apiKey, model, input) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      input
    })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI embeddings failed (${res.status}): ${raw}`);
  const j = JSON.parse(raw);
  const emb = j?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) throw new Error("OpenAI embeddings returned no embedding array.");
  return emb;
}
function buildTextForRegulatoryClause(row) {
  // Keep this stable + rich: best retrieval later
  const parts = [];
  if (row.clause_ref) parts.push(`ClauseRef: ${row.clause_ref}`);
  if (row.title) parts.push(`Title: ${row.title}`);
  if (row.clause_type) parts.push(`Type: ${row.clause_type}`);
  if (row.source_ref) parts.push(`Source: ${row.source_ref}`);
  if (row.text_content) parts.push(`Text: ${row.text_content}`);
  return parts.join("\n").slice(0, 6000);
}
function buildTextForPublicDecision(row) {
  const parts = [];
  if (row.forum_name) parts.push(`Forum: ${row.forum_name}`);
  if (row.case_number) parts.push(`Case: ${row.case_number}`);
  if (row.decision_at) parts.push(`DecisionAt: ${row.decision_at}`);
  if (row.outcome) parts.push(`Outcome: ${row.outcome}`);
  if (row.outcome_favours) parts.push(`Favours: ${row.outcome_favours}`);
  if (row.issues) parts.push(`Issues: ${row.issues}`);
  if (row.summary) parts.push(`Summary: ${row.summary}`);
  return parts.join("\n").slice(0, 6000);
}
serve(async (req)=>{
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const OPENAI_API_KEY = Deno.env.get("GuideBuoy_EdgeFunction") ?? "";
  if (!SUPABASE_URL) return textResp("Missing SUPABASE_URL", 500);
  if (!SUPABASE_SERVICE_ROLE_KEY) return textResp("Missing SUPABASE_SERVICE_ROLE_KEY", 500);
  if (!OPENAI_API_KEY) return textResp("Missing GuideBuoy_EdgeFunction secret", 500);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    if (req.method !== "POST") return textResp("POST only", 405);
    const body = await req.json().catch(()=>({}));
    const table = body.table;
    if (!table) return textResp('Missing "table". Use "regulatory_clauses" or "public_decisions".', 400);
    const limit = clampInt(body.limit, 1, 200, 50);
    const force = body.force ?? false;
    const embedModel = body.model ?? "text-embedding-3-small";
    // Select candidates
    let query = supabase.from(table).select("*").order("created_at", {
      ascending: true
    }).limit(limit);
    if (!force) query = query.is("embedding", null);
    const { data: rows, error: selErr } = await query;
    if (selErr) throw new Error(`Select error: ${JSON.stringify(selErr)}`);
    const items = rows ?? [];
    if (items.length === 0) {
      return jsonResp({
        ok: true,
        table,
        processed: 0,
        updated: 0,
        note: "No rows to embed (embedding already filled?)"
      });
    }
    let updated = 0;
    const updatedIds = [];
    const failed = [];
    for (const r of items){
      const id = String(r.id);
      try {
        const text = table === "regulatory_clauses" ? buildTextForRegulatoryClause(r) : buildTextForPublicDecision(r);
        if (!text || text.trim().length < 20) {
          failed.push({
            id,
            error: "Skip: text too short"
          });
          continue;
        }
        const emb = await openaiEmbed(OPENAI_API_KEY, embedModel, text);
        const { error: upErr } = await supabase.from(table).update({
          embedding: toPgvectorLiteral(emb)
        }).eq("id", id);
        if (upErr) throw new Error(JSON.stringify(upErr));
        updated++;
        updatedIds.push(id);
      } catch (e) {
        failed.push({
          id,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }
    return jsonResp({
      ok: true,
      table,
      processed: items.length,
      updated,
      updated_ids_sample: updatedIds.slice(0, 10),
      failed_count: failed.length,
      failed_sample: failed.slice(0, 5),
      embedding_model: embedModel,
      ran_at: nowIso(),
      tip: "Call again until processed=0. Then your match_* RPCs will return results."
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e);
    return textResp(msg, 500);
  }
});
/**
 * Supabase pgvector expects a vector literal string like: "[0.1,0.2,...]"
 * (same as your decision function)
 */ function toPgvectorLiteral(v) {
  return "[" + v.join(",") + "]";
}
