// Runs the fact reconcile runner against a local Supabase (CI database job) with a stand-in for the model.
// Checks: candidates per source, a conflict between story and journey answer, no model call when nothing
// changed, cached sources on a partial change, a resolution carried over, and a reopened finding.
// Synthetic data only; refuses any host other than localhost.

import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"

import { ensureReconciled } from "@/lib/server/facts/run-reconcile"

const url = process.env.LOCAL_SUPABASE_URL ?? ""
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ?? ""
const host = url ? new URL(url).hostname : ""
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error("test-facts-reconcile-local runs only against a local Supabase (LOCAL_SUPABASE_URL)")
}
if (!serviceKey) throw new Error("LOCAL_SUPABASE_SERVICE_ROLE_KEY is required")

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const profileId = "10000000-0000-4000-8000-0000000000aa"
const caseId = "a0000000-0000-4000-8000-0000000000aa"
const documentId = "d0000000-0000-4000-8000-0000000000aa"
const storyV1 = "On 3 October 2026 an SMS from Synthetic Bank asked me to log in. I reported it to the police."
const storyV2 = "On 3 October 2026 an SMS from Synthetic Bank asked me to log in. I reported it to the police on 9 October 2026."
const statement = "Synthetic Bank statement. 03 Oct 2026 Transfer S$2,400.00"

let modelCalls = 0
async function stubModel(prompt: string): Promise<unknown> {
  modelCalls++
  if (prompt.includes(statement)) {
    return {
      institutions: [{ name: "Synthetic Bank", quote: "Synthetic Bank statement" }],
      transactions: [{ date: "2026-10-03", amount: 2400, currency: "SGD", instrument: "account_transfer", quote: "03 Oct 2026 Transfer S$2,400.00" }],
    }
  }
  if (prompt.includes(storyV2)) {
    return {
      phishing_channel: { value: "sms", quote: "an SMS from Synthetic Bank" },
      reported_to_police: { value: "yes", date: "2026-10-09", quote: "I reported it to the police on 9 October 2026" },
    }
  }
  return {
    phishing_channel: { value: "sms", quote: "an SMS from Synthetic Bank" },
    reported_to_police: { value: "yes", quote: "I reported it to the police" },
  }
}

async function check<T>(result: { data: T; error: unknown }): Promise<T> {
  if (result.error) throw new Error(JSON.stringify(result.error))
  return result.data
}

async function main() {
  await service.from("cases").delete().eq("id", caseId)
  await service.from("profiles").delete().eq("id", profileId)
  await check(await service.from("profiles").insert({ id: profileId, email: "facts-local@example.invalid" }))
  await check(await service.from("cases").insert({ id: caseId, user_id: profileId, claim_type: "phishing_scam", primary_narrative: storyV1 }))
  await check(await service.from("case_responses").insert([
    { case_id: caseId, question_key: "institution_name", response_value: "Synthetic Bank", response_type: "text" },
    { case_id: caseId, question_key: "journey_police_report", response_value: "no", response_type: "text" },
  ]))
  await check(await service.from("case_documents").insert({
    id: documentId, case_id: caseId, filename: "synthetic-statement.pdf", original_filename: "synthetic-statement.pdf", processing_status: "ready",
  }))
  await check(await service.from("case_document_extractions").insert({
    case_id: caseId, document_id: documentId, extraction_type: "text", schema_version: "v1", extracted_json: {},
    extracted_text: statement, model: "synthetic", prompt_version: "synthetic",
  }))

  try {
    const run1 = await ensureReconciled(service, caseId, stubModel)
    assert.equal(modelCalls, 2, "one call for the story, one for the document")
    const police1 = run1.findings.find((f) => f.factKey === "reported_to_police")!
    assert.equal(police1.findingType, "conflict", "story yes vs journey no")
    assert.equal(police1.status, "open")
    assert.equal(run1.findings.find((f) => f.factKey === "institution_names")!.findingType, "agreed")

    const again = await ensureReconciled(service, caseId, stubModel)
    assert.equal(again.runId, run1.runId, "nothing changed: same run")
    assert.equal(modelCalls, 2, "nothing changed: no model call")

    await check(await service.from("case_fact_findings")
      .update({ status: "resolved", resolution: { kind: "choice", index: 0 }, resolved_at: new Date().toISOString() })
      .eq("id", police1.id))

    await check(await service.from("case_responses").insert(
      { case_id: caseId, question_key: "journey_fidrec_filed", response_value: "no", response_type: "text" },
    ))
    const run2 = await ensureReconciled(service, caseId, stubModel)
    assert.notEqual(run2.runId, run1.runId)
    assert.equal(modelCalls, 2, "unchanged story and document are not re-extracted")
    assert.equal(run2.findings.find((f) => f.factKey === "reported_to_police")!.status, "resolved", "resolution carried over")

    await check(await service.from("cases").update({ primary_narrative: storyV2 }).eq("id", caseId))
    const run3 = await ensureReconciled(service, caseId, stubModel)
    assert.equal(modelCalls, 3, "only the edited story is extracted again")
    assert.equal(run3.findings.find((f) => f.factKey === "reported_to_police")!.status, "open", "changed values reopen the finding")
    const events = await check(await service.from("case_fact_confirmation_events").select("event").eq("case_id", caseId))
    assert.deepEqual((events as Array<{ event: string }>).map((e) => e.event), ["reopened"])

    const current = await check(await service.from("case_fact_findings").select("run_id").eq("case_id", caseId).is("invalidated_at", null))
    assert.ok((current as Array<{ run_id: string }>).every((r) => r.run_id === run3.runId), "only the latest run's findings are current")
    console.log("Fact reconcile runner (local) passed")
  } finally {
    await service.from("cases").delete().eq("id", caseId)
    await service.from("profiles").delete().eq("id", profileId)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
