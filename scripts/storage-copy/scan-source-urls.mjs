#!/usr/bin/env node
/**
 * Scans the *linked* Supabase project DB for lingering URLs pointing at the SOURCE project hostname:
 *   <SOURCE_REF>.supabase.co
 *
 * Notes:
 * - This runs locally (Node) and queries the linked DB via `supabase db query`.
 * - It reports table/column/hit_count only (no row data).
 *
 * Requirements:
 * - `supabase link` has been run in the current directory (or use `--project-ref` with the CLI yourself).
 * - Auth is available for the CLI (`SUPABASE_ACCESS_TOKEN` or `supabase login`).
 *
 * Env vars:
 * - SOURCE_REF
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SOURCE_REF = process.env.SOURCE_REF?.trim();
if (!SOURCE_REF) die("Missing env var SOURCE_REF (e.g. 'ujilatkjweudsptpoqyr').");

const needle = `%${SOURCE_REF}.supabase.co%`;

const columns = supabaseQueryJson(`
  select table_schema, table_name, column_name, data_type
  from information_schema.columns
  where table_schema = 'public'
    and data_type in ('text', 'character varying', 'character')
  order by table_name, column_name;
`).rows;

const hits = [];
for (const c of columns) {
  const tableIdent = `${quoteIdent(c.table_schema)}.${quoteIdent(c.table_name)}`;
  const colIdent = quoteIdent(c.column_name);
  const sql = `select count(*)::bigint as hit_count from ${tableIdent} where ${colIdent} like '${escapeSqlLiteral(needle)}';`;
  const out = supabaseQueryJson(sql);
  const count = Number(out.rows?.[0]?.hit_count ?? 0);
  if (count > 0) {
    hits.push({
      table_schema: c.table_schema,
      table_name: c.table_name,
      column_name: c.column_name,
      hit_count: count,
    });
  }
}

hits.sort((a, b) => b.hit_count - a.hit_count || a.table_name.localeCompare(b.table_name) || a.column_name.localeCompare(b.column_name));
console.log(JSON.stringify({ source_ref: SOURCE_REF, needle, hit_count_total: hits.reduce((s, h) => s + h.hit_count, 0), hits }, null, 2));

function supabaseQueryJson(sql) {
  const sqlFile = path.join(tmpdir(), `supabase-scan-source-urls-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  writeFileSync(sqlFile, sql, "utf8");
  const raw = runSupabase(["db", "query", "--linked", "-o", "json", "--file", sqlFile]);
  const idx = raw.indexOf("{");
  if (idx < 0) die(`Unexpected supabase output (expected JSON). Output:\n${raw}`);
  const jsonText = raw.slice(idx);
  return JSON.parse(jsonText);
}

function runSupabase(args) {
  try {
    return execFileSync("supabase", args, { stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
    if (process.platform === "win32") {
      // Avoid passing huge SQL strings through npx/cmd argument parsing; we already use --file above.
      const cmd = "cmd.exe";
      const command = ["npx", "supabase", ...args].map(winQuote).join(" ");
      return execFileSync(cmd, ["/d", "/s", "/c", command], { stdio: "pipe", encoding: "utf8" });
    }
    return execFileSync("npx", ["supabase", ...args], { stdio: "pipe", encoding: "utf8" });
  }
}

function winQuote(s) {
  const str = String(s);
  if (/^[A-Za-z0-9._:-]+$/.test(str)) return str;
  return `"${str.replaceAll('"', '""')}"`;
}

function quoteIdent(s) {
  // Double-quote identifier; escape embedded quotes.
  return `"${String(s).replaceAll('"', '""')}"`;
}

function escapeSqlLiteral(s) {
  return String(s).replaceAll("'", "''");
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}
