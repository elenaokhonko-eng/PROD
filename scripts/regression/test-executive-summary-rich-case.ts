/**
 * Regression guard for Executive Summary case-overview facts on the rich DBS case.
 *
 * Usage:
 *   npx tsx scripts/regression/test-executive-summary-rich-case.ts
 *
 * Requires local env (.env.local) with Supabase + OpenAI credentials because
 * generateCasePackJson loads live tier-2 artefacts for the case.
 */

import "../load-local-env.ts"

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { generateCasePackJson } from "../../lib/server/fidrec/generate-case-pack-json.ts"

type ExecutiveSummaryRegressionBaseline = {
  case_id: string
  claimant_name: string
  loss_amount: string
  deposit_loss: string
  card_loss: string
  institution: string
  bank_decision: string
  must_not_contain: string[]
}

const BASELINE_PATH = resolve(
  process.cwd(),
  "scripts/regression/executive-summary-baseline-rich-case.json",
)

function assertCondition(condition: boolean, message: string, failures: string[]): void {
  if (!condition) failures.push(message)
}

async function main() {
  const baselineRaw = await readFile(BASELINE_PATH, "utf8")
  const baseline = JSON.parse(baselineRaw) as ExecutiveSummaryRegressionBaseline

  const result = await generateCasePackJson({ caseId: baseline.case_id })
  const narrative = result.submission_pack.executive_summary.narrative
  const overview = result.internal_debug.executive_summary_case_overview_diagnostics
  const failures: string[] = []

  assertCondition(
    overview.selected_claimant_name === baseline.claimant_name,
    `claimant_name: expected "${baseline.claimant_name}", got "${overview.selected_claimant_name ?? "(none)"}"`,
    failures,
  )

  assertCondition(
    overview.selected_loss_amount === baseline.loss_amount,
    `loss_amount: expected "${baseline.loss_amount}", got "${overview.selected_loss_amount ?? "(none)"}"`,
    failures,
  )

  const breakdownText = overview.loss_breakdown.join(" ")
  assertCondition(
    breakdownText.includes(baseline.deposit_loss),
    `deposit_loss: expected "${baseline.deposit_loss}" in loss_breakdown, got ${JSON.stringify(overview.loss_breakdown)}`,
    failures,
  )
  assertCondition(
    breakdownText.includes(baseline.card_loss),
    `card_loss: expected "${baseline.card_loss}" in loss_breakdown, got ${JSON.stringify(overview.loss_breakdown)}`,
    failures,
  )

  assertCondition(
    narrative.includes(baseline.institution) ||
      overview.products.some((product) => product.includes(baseline.institution)),
    `institution: expected "${baseline.institution}" in narrative or products`,
    failures,
  )

  assertCondition(
    narrative.toLowerCase().includes(baseline.bank_decision),
    `bank_decision: expected narrative to mention "${baseline.bank_decision}"`,
    failures,
  )

  for (const forbidden of baseline.must_not_contain) {
    assertCondition(
      !narrative.includes(forbidden),
      `must_not_contain: narrative must not include "${forbidden}"`,
      failures,
    )
  }

  if (failures.length) {
    console.error("Executive Summary rich-case regression FAILED\n")
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    console.error("\nNarrative:\n", narrative)
    process.exit(1)
  }

  console.log("Executive Summary rich-case regression passed.")
  console.log(`case_id: ${baseline.case_id}`)
  console.log(`claimant_name: ${overview.selected_claimant_name}`)
  console.log(`loss_amount: ${overview.selected_loss_amount}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
