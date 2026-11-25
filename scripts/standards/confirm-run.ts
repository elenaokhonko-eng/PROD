// Shared by confirm.ts and seed.ts: read the records, plan, and apply what is ready to a local database.

import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { buildConfirmSql } from "./confirm-sql.ts"
import { type ConfirmationPlan, type NamedManifest, planConfirmations, readConfirmations, unloadedStatementKeys } from "./confirmations.ts"
import { readManifest } from "./manifest.ts"
import { MANIFEST_DIR, readStatements, ruleCitations } from "./seeds.ts"

const HOSTED = /yqqkkftfddxuxmpxwbcj|ottnvtqltxinxasedbjp|supabase\.co|pooler\.supabase\.com/i
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"])

/**
 * Throws unless the psql command points at this machine. Every host the command names (-h, --host, host=, or a
 * postgres:// URL) must be a local one; a command that names none (a socket, or docker exec) is local.
 */
export function assertLocalPsql(command: string): void {
  if (HOSTED.test(command)) throw new Error("--psql points at a hosted Supabase project; apply to a local database only, or write the SQL with --sql-out")
  const hosts: string[] = []
  for (const m of command.matchAll(/(?:^|\s)(?:-h\s*|--host[=\s]+)["']?([^\s"']+)/g)) hosts.push(m[1])
  for (const m of command.matchAll(/\bhost(?:addr)?=["']?([^\s"']+)/g)) hosts.push(m[1])
  for (const m of command.matchAll(/postgres(?:ql)?:\/\/(?:[^@\s/]*@)?(\[[^\]]+\]|[^:/?\s"']+)/g)) hosts.push(m[1])
  if (/\bPGHOST(?:ADDR)?=/.test(command)) for (const m of command.matchAll(/\bPGHOST(?:ADDR)?=["']?([^\s"']+)/g)) hosts.push(m[1])
  const remote = hosts.filter((h) => !LOCAL_HOSTS.has(h.toLowerCase()) && !h.startsWith("/"))
  if (remote.length) throw new Error(`--psql names a host that is not this machine (${remote.join(", ")}); apply to a local database only, or write the SQL with --sql-out`)
}

export function currentPlan(): ConfirmationPlan {
  const manifests: NamedManifest[] = readdirSync(MANIFEST_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, manifest: readManifest(join(MANIFEST_DIR, file)) }))
  return planConfirmations({ files: readConfirmations(), manifests, statements: readStatements(), citations: ruleCitations(), notLoaded: unloadedStatementKeys() })
}

/** Applies what the plan calls ready. Returns the database's notices and errors; ok is false when psql failed. */
export function applyConfirmations(plan: ConfirmationPlan, psql: string): { ok: boolean; applied: boolean; output: string } {
  assertLocalPsql(psql)
  const sql = buildConfirmSql(plan)
  if (!sql) return { ok: true, applied: false, output: "" }
  const run = spawnSync(psql, { shell: true, input: sql, encoding: "utf8" })
  const notices = (run.stderr ?? "").split("\n").filter((l) => /NOTICE|ERROR|DETAIL|HINT/.test(l)).join("\n")
  return { ok: run.status === 0, applied: run.status === 0, output: notices || (run.status === 0 ? "" : run.stderr ?? "") }
}
