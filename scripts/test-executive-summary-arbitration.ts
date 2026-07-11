import "./load-local-env.ts"

import { generateCasePackJson } from "../lib/server/fidrec/generate-case-pack-json.ts"

const cases = [
  "0ff50621-a170-4dc5-a877-40179cf27754",
  "688154e7-9cda-47ef-9cff-a27581766c3a",
]

async function main() {
  for (const caseId of cases) {
    const result = await generateCasePackJson({ caseId })
    const crit = result.internal_debug.executive_summary_critical_fact_diagnostics

    console.log(`\n======== CASE ${caseId} ========`)
    console.log("Executive Summary:", result.submission_pack.executive_summary.narrative)
    const overview = result.internal_debug.executive_summary_case_overview_diagnostics
    console.log("\n=== Executive Summary Case Overview Diagnostics ===")
    console.log("selected_claimant_name:", overview.selected_claimant_name)
    console.log("selected_loss_amount:", overview.selected_loss_amount)
    console.log("loss_breakdown:", overview.loss_breakdown)
    console.log("products:", overview.products)
    console.log("bank_rejection_basis:", overview.bank_rejection_basis)
    console.log("\n=== Executive Summary Critical Fact Diagnostics ===")
    console.log("customer_name candidates:")
    for (const candidate of crit.customer_name_candidates) {
      console.log(`- ${candidate}`)
    }
    console.log(`selected_customer_name: ${crit.selected_customer_name ?? "(none)"}`)
    if (crit.selected_customer_name_reason) {
      console.log(`selection_reason: ${crit.selected_customer_name_reason}`)
    }

    console.log("\nloss_amount candidates:")
    for (const candidate of crit.loss_amount_candidates) {
      console.log(`- ${candidate}`)
    }
    console.log(`selected_loss_amount: ${crit.selected_loss_amount ?? "(none)"}`)
    if (crit.selected_loss_amount_reason) {
      console.log(`selection_reason: ${crit.selected_loss_amount_reason}`)
    }

    console.log("\naccount/card candidates:")
    for (const candidate of crit.account_card_candidates) {
      console.log(`- ${candidate}`)
    }
    console.log(`selected_account_or_card: ${crit.selected_account_or_card ?? "(none)"}`)
    if (crit.selected_account_or_card_reason) {
      console.log(`selection_reason: ${crit.selected_account_or_card_reason}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
