// Applies a person's recorded confirmations of the standards corpus.
//
//   npx tsx scripts/standards/confirm.ts [--psql "<command>"] [--sql-out <file>] [--require-ready]
//
// With no option it prints what the records in supabase/standards/confirmations allow: which versions can be
// verified, which statements can be approved, and what each of the others is still waiting on.
//
// --psql           a psql command for a database on THIS machine (given the SQL on stdin). Any other host is refused.
// --sql-out        write the SQL to a file instead of (or as well as) running it. A hosted database is only ever
//                  given this file by a person, after Elena's OK.
// --require-ready  exit 1 when any recorded item is still waiting, so a release step cannot pass with part applied.
//
// Exit 1, with nothing written or applied, when a record is malformed, contradicts another, or no longer covers what
// the repo holds (a manifest or statement changed after it was confirmed). scripts/standards/seed.ts runs this step
// after seeding, so a reloaded database gets its confirmations back.
//
// The loader and the seed step never verify or approve. This step does, and only from a record that names who
// checked, when, and the exact content they checked (hashes).

import { writeFileSync } from "node:fs"
import { buildConfirmSql } from "./confirm-sql.ts"
import { applyConfirmations, assertLocalPsql, currentPlan } from "./confirm-run.ts"
import { describePlan } from "./confirmations.ts"

function main(): void {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] ?? null : null
  }
  const psql = value("--psql")
  const sqlOut = value("--sql-out")
  if (psql) assertLocalPsql(psql)

  const plan = currentPlan()
  console.log(describePlan(plan))
  if (plan.errors.length || plan.stale.length) {
    console.error("Nothing was written or applied: fix or remove the records marked ERROR or STALE first.")
    process.exit(1)
  }
  const sql = buildConfirmSql(plan)
  if (sql && sqlOut) writeFileSync(sqlOut, sql, "utf8")
  if (psql) {
    const result = applyConfirmations(plan, psql)
    if (result.output) console.error(result.output)
    if (!result.ok) process.exit(1)
  }
  const waiting = plan.versions.filter((v) => v.waitingOn.length).length + plan.approvals.filter((a) => a.waitingOn.length).length
  if (args.includes("--require-ready") && waiting) {
    console.error(`${waiting} recorded item(s) are still waiting.`)
    process.exit(1)
  }
}

main()
