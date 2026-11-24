// Loads the institutions list, the statement drafts and the server rules' citations.
//
//   npx tsx scripts/standards/seed.ts [--psql "<command>"] [--sql-out <file>]
//
// --psql     a psql command for a LOCAL database (given the SQL on stdin). Never a staging or production URL.
// --sql-out  write the SQL to a file instead of (or as well as) running it.
//
// Statements go in as drafts. Approving one is Elena's step (definition_statements.status, approved_by, approved_at,
// clauses_as_of), done after the versions it rests on are verified. A second run changes no row.

import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { buildSeedSql, readInstitutions, readStatements, ruleCitations } from "./seeds.ts"

const STAGING_OR_PRODUCTION = /yqqkkftfddxuxmpxwbcj|ottnvtqltxinxasedbjp|supabase\.co|pooler\.supabase\.com/i

function main(): void {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] ?? null : null
  }
  const psql = value("--psql")
  const sqlOut = value("--sql-out")
  if (!psql && !sqlOut) throw new Error("usage: seed.ts [--psql <cmd>] [--sql-out <file>]")
  if (psql && STAGING_OR_PRODUCTION.test(psql)) throw new Error("--psql points at a hosted Supabase project; run the seed against a local database only")

  const sql = buildSeedSql({ institutions: readInstitutions(), statements: readStatements(), citations: ruleCitations() })
  if (sqlOut) writeFileSync(sqlOut, sql, "utf8")
  if (!psql) return
  const run = spawnSync(psql, { shell: true, input: sql, encoding: "utf8" })
  if (run.status !== 0) {
    console.error((run.stderr ?? "").split("\n").filter((l) => /ERROR|DETAIL/.test(l)).join("\n") || run.stderr)
    process.exit(1)
  }
  console.log(/standards seed: .*/.exec(run.stderr ?? "")?.[0] ?? "seeded")
}

main()
