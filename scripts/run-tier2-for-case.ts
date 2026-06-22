/**
 * Run FIDReC tier-2 pipeline for a case using real document extractions.
 *
 * Usage:
 *   npx tsx scripts/run-tier2-for-case.ts <case-id>
 */

import "./load-local-env.ts"

import { extractAndPersistBankAssertions } from "../lib/server/fidrec/extract-bank-assertions.ts"
import { generateAndPersistCaseFindings } from "../lib/server/fidrec/generate-case-findings.ts"
import { generateAndPersistCaseThemes } from "../lib/server/fidrec/generate-case-themes.ts"
import { generateAndPersistEvidenceRequests } from "../lib/server/fidrec/generate-evidence-requests.ts"
import { generateAndPersistInvestigationQuestions } from "../lib/server/fidrec/generate-investigation-questions.ts"
import { linkAssertionsAndFindings } from "../lib/server/fidrec/link-assertions-findings.ts"
import { generateCasePackJson } from "../lib/server/fidrec/generate-case-pack-json.ts"
import { createServiceClient } from "../lib/supabase/service.ts"

const CASE_ID = process.argv[2]?.trim() ?? "688154e7-9cda-47ef-9cff-a27581766c3a"

const BANK_RESPONSE_TYPES = [
  "BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY",
  "BANK_SRF_INVESTIGATION_REPORT_OR_OFFICIAL_RESPONSE",
  "BANK_EMAIL_COMMUNICATION",
  "BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL",
] as const

const EVIDENCE_PRIORITY_TYPES = [
  "BANK_SCAM_FRAUD_HOTLINE_CALL_LOG",
  "CREDIT_CARD_STATEMENT_SHOWING_TRANSACTIONS",
  "BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS",
  "SMS_LOG_TOKEN_BINDING_NOTIFICATIONS",
  "SMS_LOG_ALL_TRANSACTION_NOTIFICATIONS",
  "BANK_TRANSACTION_NOTIFICATION_SMS",
  "POLICE_REPORT_OF_FRAUD_SCAM",
  "FRAUD_SCREENSHOT",
  "TIMELINE_NOTES",
  "TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK",
] as const

type DocumentRow = {
  id: string
  verified_document_type: string | null
  document_type: string | null
  original_filename: string | null
  filename: string | null
}

type ExtractionRow = {
  document_id: string
  extracted_text: string | null
  extracted_json: Record<string, unknown> | null
  confidence: number | null
  extraction_type: string
  created_at: string
}

function resolveDocType(doc: DocumentRow): string {
  return (doc.verified_document_type ?? doc.document_type ?? "UNKNOWN").trim()
}

function truncate(text: string, maxLength: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 3).trim()}...`
}

function summarizeExtraction(doc: DocumentRow, extraction: ExtractionRow | undefined): string {
  const text = extraction?.extracted_text?.trim()
  if (text) return truncate(text, 1200)

  const json = extraction?.extracted_json
  if (json && typeof json.summary === "string" && json.summary.trim()) {
    return truncate(json.summary, 1200)
  }

  return `Document: ${doc.original_filename ?? doc.filename ?? resolveDocType(doc)}`
}

async function loadBestExtractions(caseId: string): Promise<Map<string, ExtractionRow>> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("case_document_extractions")
    .select("document_id, extracted_text, extracted_json, confidence, extraction_type, created_at")
    .eq("case_id", caseId)
    .in("extraction_type", ["doc_summary_v3", "transactions_v1"])
    .order("created_at", { ascending: false })

  if (error) throw new Error(`Failed to load extractions: ${error.message}`)

  const byDocumentId = new Map<string, ExtractionRow>()
  for (const row of (data ?? []) as ExtractionRow[]) {
    if (!byDocumentId.has(row.document_id)) {
      byDocumentId.set(row.document_id, row)
      continue
    }
    const existing = byDocumentId.get(row.document_id)!
    if (row.extraction_type === "doc_summary_v3" && existing.extraction_type !== "doc_summary_v3") {
      byDocumentId.set(row.document_id, row)
    }
  }
  return byDocumentId
}

async function loadDocuments(caseId: string): Promise<DocumentRow[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("case_documents")
    .select("id, verified_document_type, document_type, original_filename, filename")
    .eq("case_id", caseId)
    .order("upload_date", { ascending: true })

  if (error) throw new Error(`Failed to load documents: ${error.message}`)
  return (data ?? []) as DocumentRow[]
}

function buildProcessedEvidenceJson(
  documents: DocumentRow[],
  extractions: Map<string, ExtractionRow>,
): { evidence: Array<Record<string, string>> } {
  const ranked = documents
    .map((doc) => ({
      doc,
      type: resolveDocType(doc),
      priority: EVIDENCE_PRIORITY_TYPES.indexOf(
        resolveDocType(doc) as (typeof EVIDENCE_PRIORITY_TYPES)[number],
      ),
    }))
    .filter((entry) => entry.priority >= 0)
    .sort((left, right) => left.priority - right.priority)

  const selected = ranked.length ? ranked : documents.map((doc) => ({ doc, type: resolveDocType(doc), priority: 99 }))
  const capped = selected.slice(0, 20)

  return {
    evidence: capped.map(({ doc, type }) => ({
      type: type.toLowerCase(),
      document_id: doc.id,
      filename: doc.original_filename ?? doc.filename ?? "",
      summary: summarizeExtraction(doc, extractions.get(doc.id)),
    })),
  }
}

function selectBankResponse(
  documents: DocumentRow[],
  extractions: Map<string, ExtractionRow>,
): { text: string; sourceDocumentId: string } {
  const candidates = documents
    .map((doc) => ({
      doc,
      type: resolveDocType(doc),
      text: extractions.get(doc.id)?.extracted_text?.trim() ?? "",
    }))
    .filter((entry) => BANK_RESPONSE_TYPES.includes(entry.type as (typeof BANK_RESPONSE_TYPES)[number]))
    .filter((entry) => entry.text.length > 80)
    .sort((left, right) => {
      const leftRank = BANK_RESPONSE_TYPES.indexOf(left.type as (typeof BANK_RESPONSE_TYPES)[number])
      const rightRank = BANK_RESPONSE_TYPES.indexOf(right.type as (typeof BANK_RESPONSE_TYPES)[number])
      if (leftRank !== rightRank) return leftRank - rightRank
      return right.text.length - left.text.length
    })

  if (!candidates.length) {
    throw new Error("No bank response document with extracted text found for this case")
  }

  const primary = candidates[0]
  const mergedText = uniqueStrings(candidates.slice(0, 4).map((entry) => entry.text)).join("\n\n")
  return { text: mergedText, sourceDocumentId: primary.doc.id }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

async function loadCustomerNarrative(caseId: string, documents: DocumentRow[], extractions: Map<string, ExtractionRow>): Promise<string | undefined> {
  const supabase = createServiceClient()

  const { data: caseRow } = await supabase.from("cases").select("case_summary").eq("id", caseId).maybeSingle()
  if (caseRow?.case_summary?.trim()) return caseRow.case_summary.trim()

  const { data: extractRun } = await supabase
    .from("case_extract_runs")
    .select("extract_json")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const extractJson = extractRun?.extract_json as Record<string, unknown> | undefined
  const narrativeFromExtract =
    typeof extractJson?.customer_narrative === "string"
      ? extractJson.customer_narrative
      : typeof extractJson?.narrative === "string"
        ? extractJson.narrative
        : null
  if (narrativeFromExtract?.trim()) return narrativeFromExtract.trim()

  const timelineDoc = documents.find((doc) => resolveDocType(doc) === "TIMELINE_NOTES")
  const timelineText = timelineDoc ? extractions.get(timelineDoc.id)?.extracted_text?.trim() : null
  if (timelineText) return timelineText

  return undefined
}

async function main() {
  console.log(`Running tier-2 pipeline for case ${CASE_ID}\n`)

  const documents = await loadDocuments(CASE_ID)
  const extractions = await loadBestExtractions(CASE_ID)
  console.log(`Loaded ${documents.length} documents, ${extractions.size} extractions`)

  const bankResponse = selectBankResponse(documents, extractions)
  console.log(`Bank response source: ${bankResponse.sourceDocumentId} (${bankResponse.text.length} chars)`)

  const processedEvidenceJson = buildProcessedEvidenceJson(documents, extractions)
  console.log(`Processed evidence items: ${processedEvidenceJson.evidence.length}`)

  const customerNarrative = await loadCustomerNarrative(CASE_ID, documents, extractions)
  console.log(`Customer narrative: ${customerNarrative ? `${customerNarrative.length} chars` : "(none)"}`)

  console.log("\n--- Step 1: Extract bank assertions ---")
  const assertions = await extractAndPersistBankAssertions({
    caseId: CASE_ID,
    sourceDocumentId: bankResponse.sourceDocumentId,
    bankFinalResponseText: bankResponse.text,
  })
  console.log(`Assertions: ${assertions.bank_assertions.length}`)

  console.log("\n--- Step 2: Generate case findings ---")
  const findings = await generateAndPersistCaseFindings({
    caseId: CASE_ID,
    processedEvidenceJson,
    customerNarrative,
  })
  console.log(`Findings: ${findings.case_findings.length}`)

  console.log("\n--- Step 3: Link assertions and findings ---")
  const links = await linkAssertionsAndFindings({ caseId: CASE_ID })
  console.log(`Links: ${links.links.length}`)

  console.log("\n--- Step 4: Generate themes ---")
  const themes = await generateAndPersistCaseThemes({ caseId: CASE_ID })
  console.log(`Themes: ${themes.themes.length}`)

  console.log("\n--- Step 5: Generate investigation questions ---")
  const questions = await generateAndPersistInvestigationQuestions({ caseId: CASE_ID })
  console.log(`Questions: ${questions.investigation_questions.length}`)

  console.log("\n--- Step 6: Generate evidence requests ---")
  const evidenceRequests = await generateAndPersistEvidenceRequests({ caseId: CASE_ID })
  console.log(`Evidence requests: ${evidenceRequests.evidence_requests.length}`)

  console.log("\n--- Submission pack preview ---")
  const pack = await generateCasePackJson({ caseId: CASE_ID })

  console.log("\n=== 1. Executive Summary ===")
  console.log(pack.submission_pack.executive_summary.narrative)

  console.log("\n=== 2. Chronology of Events ===")
  if (!pack.submission_pack.chronology_of_events.length) {
    console.log("(none)")
  } else {
    console.log("Date / Time\tType\tStatus\tEvent\tEvidence")
    for (const event of pack.submission_pack.chronology_of_events) {
      const evidence = event.supporting_evidence.length ? event.supporting_evidence.join(", ") : "(none)"
      const dateTime = event.event_datetime
        ? new Date(event.event_datetime).toLocaleString("en-SG", { timeZone: "UTC" })
        : "Undated"
      console.log(`${dateTime}\t${event.event_type}\t${event.status}\t${event.event_text}\t${evidence}`)
    }
  }

  console.log("\n=== 4. Bank Position ===")
  console.log(pack.submission_pack.bank_position.narrative)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
