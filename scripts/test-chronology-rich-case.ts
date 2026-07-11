import "./load-local-env.ts"

import { generateCasePackJson } from "../lib/server/fidrec/generate-case-pack-json.ts"

const CASE_ID = "688154e7-9cda-47ef-9cff-a27581766c3a"

async function main() {
  const result = await generateCasePackJson({ caseId: CASE_ID })
  const events = result.submission_pack.chronology_of_events
  const diagnostics = result.internal_debug.chronology_diagnostics

  console.log(`\n======== Chronology for ${CASE_ID} ========\n`)
  console.log("Diagnostics:", JSON.stringify(diagnostics, null, 2))
  console.log(`\nEvents (${events.length}):\n`)

  for (const event of events) {
    console.log(`[${event.event_type}] ${event.status}`)
    console.log(`  datetime: ${event.event_datetime ?? "undated"}`)
    console.log(`  text: ${event.event_text}`)
    console.log(`  evidence: ${event.supporting_evidence.join(", ") || "(none)"}`)
    if (event.claimant_questions.length) {
      console.log("  Please confirm:")
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
