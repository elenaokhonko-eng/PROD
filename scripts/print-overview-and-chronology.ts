import "./load-local-env.ts"

import { generateCasePackJson } from "../lib/server/fidrec/generate-case-pack-json.ts"

const CASE_ID = "688154e7-9cda-47ef-9cff-a27581766c3a"

async function main() {
  const result = await generateCasePackJson({ caseId: CASE_ID })
  const pack = result.submission_pack
  const overview = result.internal_debug.executive_summary_case_overview_diagnostics

  console.log(`\n======== Case Overview / Executive Summary ========`)
  console.log(`Case: ${CASE_ID}`)
  console.log(`Generated: ${pack.generated_at}\n`)
  console.log(pack.executive_summary.narrative)

  console.log(`\n--- Overview diagnostics ---`)
  console.log(`Claimant: ${overview.selected_claimant_name ?? "(none)"}`)
  console.log(`Loss: ${overview.selected_loss_amount ?? "(none)"}`)
  if (overview.loss_breakdown.length) {
    console.log(`Breakdown: ${overview.loss_breakdown.join("; ")}`)
  }
  if (overview.products.length) {
    console.log(`Products: ${overview.products.join("; ")}`)
  }

  const events = pack.chronology_of_events
  const chronologyDiagnostics = result.internal_debug.chronology_diagnostics

  console.log(`\n======== Chronology of Events (${events.length}) ========\n`)
  console.log("Diagnostics:", JSON.stringify(chronologyDiagnostics, null, 2))
  console.log("")

  for (const event of events) {
    const when = event.event_datetime
      ? new Date(event.event_datetime).toISOString().replace("T", " ").replace(".000Z", " UTC")
      : "undated"
    console.log(`${event.event_id}  [${event.event_type}]  ${event.status}`)
    console.log(`  When: ${when}`)
    console.log(`  ${event.event_text}`)
    console.log(`  Evidence: ${event.supporting_evidence.join(", ") || "(none)"}`)
    if (event.claimant_questions.length) {
      console.log(`  Please confirm:`)
      for (const question of event.claimant_questions) {
        console.log(`    - ${question}`)
      }
    }
    console.log("")
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
