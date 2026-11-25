// Applies a person's recorded confirmations of the standards corpus.
//
//   npx tsx scripts/standards/confirm.ts [--psql "<command>"] [--sql-out <file>] [--check]
//
// With no option it prints what the records in supabase/standards/confirmations allow: which versions can be
// verified, which statements can be approved, and what each of the others is still waiting on.
//
// --psql     a psql command for a LOCAL database (given the SQL on stdin). Never a staging or production URL.
// --sql-out  write the SQL to a file instead of (or as well as) running it. A hosted database is only ever given
//            this file by a person, after Elena's OK.
// --check    exit 1 when a record is malformed or no longer covers what the repo holds.
//
// The loader and the seed step never verify or approve. This step does, and only from a record that names who
// checked, when, and the exact content they checked (hashes). A record whose content has changed is skipped and
// reported; it is never applied to the new content.

import { spawnSync } from "node:child_process"
import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildConfirmSql } from "./confirm-sql.ts"
import { describePlan, type NamedManifest, planConfirmations, readConfirmations } from "./confirmations.ts"
import { readManifest } from "./manifest.ts"
import { MANIFEST_DIR, readStatements, ruleCitations } from "./seeds.ts"

const STAGING_OR_PRODUCTION = /yqqkkftfddxuxmpxwbcj|ottnvtqltxinxasedbjp|supabase\.co|pooler\.supabase\.com/i

function main(): void {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] ?? null : null
  }
  const psql = value("--psql")
  const sqlOut = value("--sql-out")
  const check = args.includes("--check")
  if (psql && STAGING_OR_PRODUCTION.test(psql)) {
    throw new Error("--psql points at a hosted Supabase project; apply confirmations to a local database only, or write the SQL with --sql-out")
  }

  const manifests: NamedManifest[] = readdirSync(MANIFEST_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, manifest: readManifest(join(MANIFEST_DIR, file)) }))
  const plan = planConfirmations({ files: readConfirmations(), manifests, statements: readStatements(), citations: ruleCitations() })
  console.log(describePlan(plan))

  if (plan.errors.length) process.exit(1)
  const sql = buildConfirmSql(plan)
  if (sql && sqlOut) writeFileSync(sqlOut, sql, "utf8")
  if (sql && psql) {
    const run = spawnSync(psql, { shell: true, input: sql, encoding: "utf8" })
    const notices = (run.stderr ?? "").split("\n").filter((l) => /NOTICE|ERROR|DETAIL|HINT/.test(l)).join("\n")
    if (notices) console.error(notices)
    if (run.status !== 0) {
      if (!notices) console.error(run.stderr)
      process.exit(1)
    }
  }
  if (check && plan.stale.length) process.exit(1)
}

main()
