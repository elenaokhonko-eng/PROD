// Loads the institutions list, the statement drafts and the server rules' citations.
//
//   npx tsx scripts/standards/seed.ts [--psql "<command>"] [--sql-out <file>] [--no-confirm]
//
// --psql     a psql command for a LOCAL database (given the SQL on stdin). Never a staging or production URL.
// --sql-out  write the SQL to a file instead of (or as well as) running it.
//
// Statements go in as drafts. Approving one is Elena's step (definition_statements.status, approved_by, approved_at,
// clauses_as_of), done after the versions it rests on are verified. A second run changes no row.
//
// After seeding a database (--psql), the recorded confirmations (supabase/standards/confirmations) are applied, so a
// reloaded database gets its verified versions and approved statements back. --no-confirm leaves that step out.

import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { applyConfirmations, currentPlan } from "./confirm-run.ts"
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
  if (args.includes("--no-confirm")) return

  const plan = currentPlan()
  if (plan.errors.length || plan.stale.length) {
    console.error(`seeded, but the recorded confirmations were not applied: ${[...plan.errors, ...plan.stale].join("; ")}`)
    process.exit(1)
  }
  const result = applyConfirmations(plan, psql)
  if (result.output) console.error(result.output)
  if (!result.ok) {
    console.error("seeded, but the recorded confirmations were not applied (see above). Load every confirmed version first, or pass --no-confirm.")
    process.exit(1)
  }
  const ready = plan.versions.filter((v) => !v.waitingOn.length).length
  const approved = plan.approvals.filter((a) => !a.waitingOn.length).length
  console.log(`confirmations: ${ready} version(s) verified, ${approved} statement(s) approved, from the records; ${plan.versions.length - ready + plan.approvals.length - approved} still waiting`)
}

main()
