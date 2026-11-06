// Runs the fact reconcile runner against a local Supabase (CI database job) with a stand-in for the model.
// Checks: candidates per source, a conflict between story and journey answer, no model call when nothing
// changed, cached sources on a partial change, a resolution carried over, a reopened finding, resolution
// validation, snapshots refused with open findings, and stale snapshots refused for generation.
// Synthetic data only; refuses any host other than localhost.

import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"

import { createSnapshot, loadCurrentSnapshot, ResolutionRejectedError, resolveFinding } from "@/lib/server/facts/facts-service"
import { ensureReconciled, FactsInProgressError } from "@/lib/server/facts/run-reconcile"

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
  // The document's own parsed text is the source; a pipeline summary in the extractions must not be used instead.
  await check(await service.from("case_document_extractions").insert({
    case_id: caseId, document_id: documentId, extraction_type: "doc_summary_v3", schema_version: "v1", extracted_json: {},
    extracted_text: "A bank statement.", model: "synthetic", prompt_version: "synthetic",
  }))
  const content = await check(await service.from("case_documents_content").insert({
    document_id: documentId, model: "synthetic", prompt_version: "synthetic", pipeline_version: "synthetic", text_content: statement,
  }).select("id").single())
  await check(await service.from("case_documents").update({ content_latest_id: (content as { id: string }).id }).eq("id", documentId))

  try {
    const run1 = await ensureReconciled(service, caseId, stubModel)
    assert.equal(modelCalls, 2, "one call for the story, one for the document")
    const police1 = run1.findings.find((f) => f.factKey === "reported_to_police")!
    assert.equal(police1.findingType, "conflict", "story yes vs journey no")
    assert.equal(police1.status, "open")
    assert.equal(run1.findings.find((f) => f.factKey === "institution_names")!.findingType, "agreed")

    // A check already running for this case (the user left and came back): answer "still checking", start nothing.
    const running = await check(await service.from("case_fact_reconcile_runs")
      .insert({ case_id: caseId, input_hash: "in-progress", status: "running" }).select("id").single())
    await assert.rejects(ensureReconciled(service, caseId, stubModel), (e: unknown) => e instanceof FactsInProgressError)
    await check(await service.from("case_fact_reconcile_runs").delete().eq("id", (running as { id: string }).id))

    const again = await ensureReconciled(service, caseId, stubModel)
    assert.equal(again.runId, run1.runId, "nothing changed: same run")
    assert.equal(modelCalls, 2, "nothing changed: no model call")

    assert.equal(
      await loadCurrentSnapshot(service, caseId, "free", "e0000000-0000-4000-8000-0000000000aa", stubModel),
      null,
      "with open findings there is no snapshot to generate from",
    )
    const blocked = await createSnapshot(service, caseId, "free", profileId, stubModel)
    assert.equal(blocked.ok, false)
    assert.equal(!blocked.ok && blocked.reason, "facts_unconfirmed", "open conflict and missing facts block the snapshot")

    await assert.rejects(
      resolveFinding(service, caseId, police1.id, { kind: "choice", index: 5 }, profileId),
      (e: unknown) => e instanceof ResolutionRejectedError && e.reason === "invalid_choice",
    )
    await assert.rejects(
      resolveFinding(service, caseId, police1.id, { kind: "acknowledged" }, profileId),
      (e: unknown) => e instanceof ResolutionRejectedError && e.reason === "resolution_not_allowed",
    )
    const missing = (key: string) => run1.findings.find((f) => f.factKey === key)!
    await assert.rejects(
      resolveFinding(service, caseId, missing("reported_to_bank").id, { kind: "value", value: { value: "maybe" } }, profileId),
      (e: unknown) => e instanceof ResolutionRejectedError && e.reason === "invalid_value",
    )
    await resolveFinding(service, caseId, police1.id, { kind: "choice", index: 0 }, profileId)
    await resolveFinding(service, caseId, missing("scam_type").id, { kind: "value", value: ["phishing_sms_or_message"] }, profileId)
    await resolveFinding(service, caseId, missing("reported_to_bank").id, { kind: "value", value: { value: "yes", date: "2026-10-04" } }, profileId)
    await resolveFinding(service, caseId, missing("bank_reply").id, { kind: "value", value: { status: "none" } }, profileId)

    const snap1 = await createSnapshot(service, caseId, "free", profileId, stubModel)
    assert.ok(snap1.ok && !snap1.unchanged, "snapshot created once everything is confirmed")
    const snapAgain = await createSnapshot(service, caseId, "free", profileId, stubModel)
    assert.ok(snapAgain.ok && snapAgain.unchanged && snapAgain.snapshotId === (snap1.ok && snap1.snapshotId), "unchanged facts reuse the snapshot")
    const current = await loadCurrentSnapshot(service, caseId, "free", snap1.ok ? snap1.snapshotId : "", stubModel)
    assert.ok(current, "the latest snapshot is valid for generation")
    assert.equal((current!.facts.reported_to_police as { label: string }).label, "confirmed")
    assert.equal(modelCalls, 2, "resolving and freezing facts calls no model")

    await check(await service.from("case_responses").insert(
      { case_id: caseId, question_key: "journey_fidrec_filed", response_value: "no", response_type: "text" },
    ))
    const run2 = await ensureReconciled(service, caseId, stubModel)
    assert.notEqual(run2.runId, run1.runId)
    assert.equal(modelCalls, 2, "unchanged story and document are not re-extracted")
    assert.equal(run2.findings.find((f) => f.factKey === "reported_to_police")!.status, "resolved", "resolution carried over")
    assert.equal(await loadCurrentSnapshot(service, caseId, "free", snap1.ok ? snap1.snapshotId : "", stubModel), null, "new facts make the old snapshot stale")
    const snap2 = await createSnapshot(service, caseId, "free", profileId, stubModel)
    assert.ok(snap2.ok && !snap2.unchanged)

    await check(await service.from("cases").update({ primary_narrative: storyV2 }).eq("id", caseId))
    const run3 = await ensureReconciled(service, caseId, stubModel)
    assert.equal(modelCalls, 3, "only the edited story is extracted again")
    assert.equal(run3.findings.find((f) => f.factKey === "reported_to_police")!.status, "open", "changed values reopen the finding")
    assert.equal(await loadCurrentSnapshot(service, caseId, "free", snap2.ok ? snap2.snapshotId : "", stubModel), null, "a reopened finding blocks generation")
    const reblocked = await createSnapshot(service, caseId, "free", profileId, stubModel)
    assert.equal(reblocked.ok, false)
    const events = await check(await service.from("case_fact_confirmation_events").select("event").eq("case_id", caseId).order("created_at"))
    const names = (events as Array<{ event: string }>).map((e) => e.event)
    assert.equal(names.filter((e) => e === "snapshot_created").length, 2)
    assert.equal(names.at(-1), "reopened")

    const currentRows = await check(await service.from("case_fact_findings").select("run_id").eq("case_id", caseId).is("invalidated_at", null))
    assert.ok((currentRows as Array<{ run_id: string }>).every((r) => r.run_id === run3.runId), "only the latest run's findings are current")
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
