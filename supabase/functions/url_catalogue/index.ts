// supabase/functions/decision_url_inbox/index.ts
//
// Purpose: "URL inbox" for published decisions.
// - Upsert decision source URLs into `public.decision_sources_inbox`
// - Optionally return the next N items to process (status='new')
//
// Endpoints:
//   POST /decision_url_inbox?action=upsert     (default)
//   POST /decision_url_inbox?action=next
//   POST /decision_url_inbox?action=mark
//
// Auth:
// - Uses SUPABASE_SERVICE_ROLE_KEY (server-side only). Do NOT expose to client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
function stripTrackingParams(url) {
  const drop = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "mc_cid",
    "mc_eid",
    "session",
    "sid"
  ]);
  for (const key of [
    ...url.searchParams.keys()
  ]){
    if (drop.has(key.toLowerCase())) url.searchParams.delete(key);
  }
}
function canonicalizeUrl(input) {
  const u = new URL(input.trim());
  u.protocol = "https:"; // normalize
  stripTrackingParams(u);
  // sort query params for stable equality
  const params = [
    ...u.searchParams.entries()
  ].sort(([a], [b])=>a.localeCompare(b));
  u.search = "";
  for (const [k, v] of params)u.searchParams.append(k, v);
  // normalize trailing slash (keep as-is for root only)
  if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return {
    canonical: u.toString(),
    host: u.host,
    path: u.pathname
  };
}
function extractDocId(input) {
  // Common patterns: ?id=... or /decisions/<id>
  try {
    const u = new URL(input);
    const id = u.searchParams.get("id");
    if (id) return id;
    // Fallback: try last path segment if looks like id-ish
    const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
    if (seg.length >= 8 && seg.length <= 80) return seg;
  } catch  {
  // ignore
  }
  return null;
}
function requireString(v, field) {
  if (!v || typeof v !== "string" || !v.trim()) {
    throw new Error(`Missing or invalid '${field}'`);
  }
  return v.trim();
}
Deno.serve(async (req)=>{
  try {
    if (req.method !== "POST") {
      return jsonResponse({
        ok: false,
        error: "Use POST"
      }, 405);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var"
      }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false
      }
    });
    const url = new URL(req.url);
    const action = (url.searchParams.get("action") ?? "upsert").toLowerCase();
    const body = await req.json().catch(()=>({}));
    // ------------------------------------------------------------
    // action=upsert (default)
    // ------------------------------------------------------------
    if (action === "upsert") {
      const payload = body;
      const items = "items" in payload ? payload.items : [
        payload
      ];
      const rows = items.map((it)=>{
        const source_url_raw = requireString(it.source_url_raw ?? it.source_url, "source_url");
        const { canonical, host, path } = canonicalizeUrl(source_url_raw);
        const source_doc_id = extractDocId(canonical);
        return {
          source_system: requireString(it.source_system, "source_system"),
          source_url: canonical,
          source_url_raw: it.source_url_raw?.trim() ?? source_url_raw,
          source_host: host,
          source_path: path,
          source_doc_id,
          jurisdiction_code: requireString(it.jurisdiction_code, "jurisdiction_code"),
          forum_name: requireString(it.forum_name, "forum_name"),
          domain: requireString(it.domain, "domain"),
          notes: it.notes?.trim() ?? null,
          status: "new"
        };
      });
      const { data, error } = await supabase.from("decision_sources_inbox").upsert(rows, {
        onConflict: "source_url",
        ignoreDuplicates: false
      }).select("source_url,status,discovered_at");
      if (error) return jsonResponse({
        ok: false,
        error
      }, 500);
      return jsonResponse({
        ok: true,
        inserted_or_updated: data?.length ?? 0,
        items: data ?? []
      });
    }
    // ------------------------------------------------------------
    // action=next : return next N rows to process
    // ------------------------------------------------------------
    if (action === "next") {
      const payload = body;
      const limit = Math.min(Math.max(payload.limit ?? 10, 1), 50);
      const status = payload.status ?? "new";
      let q = supabase.from("decision_sources_inbox").select("source_system,source_url,source_url_raw,source_doc_id,source_host,source_path,jurisdiction_code,forum_name,domain,discovered_at,status,notes").eq("status", status).order("discovered_at", {
        ascending: true
      }).limit(limit);
      if (payload.source_system) q = q.eq("source_system", payload.source_system);
      if (payload.jurisdiction_code) q = q.eq("jurisdiction_code", payload.jurisdiction_code);
      if (payload.forum_name) q = q.eq("forum_name", payload.forum_name);
      if (payload.domain) q = q.eq("domain", payload.domain);
      const { data, error } = await q;
      if (error) return jsonResponse({
        ok: false,
        error
      }, 500);
      return jsonResponse({
        ok: true,
        count: data?.length ?? 0,
        items: data ?? []
      });
    }
    // ------------------------------------------------------------
    // action=mark : mark a URL as ingested/skipped/error
    // ------------------------------------------------------------
    if (action === "mark") {
      const payload = body;
      const source_url = requireString(payload.source_url, "source_url");
      const { canonical } = canonicalizeUrl(source_url);
      const status = payload.status;
      if (![
        "new",
        "ingested",
        "skipped",
        "error"
      ].includes(status)) {
        return jsonResponse({
          ok: false,
          error: "Invalid status"
        }, 400);
      }
      const { data, error } = await supabase.from("decision_sources_inbox").update({
        status,
        notes: payload.notes?.trim() ?? null
      }).eq("source_url", canonical).select("source_url,status,notes");
      if (error) return jsonResponse({
        ok: false,
        error
      }, 500);
      return jsonResponse({
        ok: true,
        updated: data?.length ?? 0,
        rows: data ?? []
      });
    }
    return jsonResponse({
      ok: false,
      error: `Unknown action '${action}'`
    }, 400);
  } catch (e) {
    return jsonResponse({
      ok: false,
      error: e.message
    }, 400);
  }
});
