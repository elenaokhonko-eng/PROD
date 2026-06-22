import "./load-local-env.ts"

import { createServiceClient } from "../lib/supabase/service.ts"
import { EVIDENCE_FN, EXTRACT_FN } from "../lib/edge-functions.ts"

const CASE_ID = "688154e7-9cda-47ef-9cff-a27581766c3a"
const STORAGE_BUCKET = "case_evidence"
const STORAGE_PATH = `cases/${CASE_ID}/documents/E202510167004.pdf`
const ORIGINAL_FILENAME = "E202510167004.pdf"

async function callEdgeFunction(fnName: string, body: Record<string, unknown>) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }

  return { status: response.status, ok: response.ok, body: json }
}

async function ensureCaseDocumentRow(supabase: ReturnType<typeof createServiceClient>): Promise<string> {
  const { data: existing, error: existingError } = await supabase
    .from("case_documents")
    .select("id, processing_status, is_processed")
    .eq("storage_bucket", STORAGE_BUCKET)
    .eq("storage_path", STORAGE_PATH)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.id) {
    console.log("case_documents row already exists:", existing)
    return existing.id as string
  }

  const { data: blob, error: downloadError } = await supabase.storage.from(STORAGE_BUCKET).download(STORAGE_PATH)
  if (downloadError || !blob) {
    throw new Error(`Failed to download ${STORAGE_BUCKET}/${STORAGE_PATH}: ${downloadError?.message ?? "missing blob"}`)
  }

  console.log(`Registering orphan storage file (${blob.size} bytes)`)

  const { data: inserted, error: insertError } = await supabase
    .from("case_documents")
    .insert({
      case_id: CASE_ID,
      filename: ORIGINAL_FILENAME,
      original_filename: ORIGINAL_FILENAME,
      file_size: blob.size,
      mime_type: "application/pdf",
      document_type: null,
      storage_bucket: STORAGE_BUCKET,
      storage_path: STORAGE_PATH,
      processing_status: "pending",
      is_processed: false,
    })
    .select("id")
    .single()

  if (insertError || !inserted?.id) {
    throw new Error(`Failed to create case_documents row: ${insertError?.message ?? "unknown error"}`)
  }

  console.log("Created case_documents row:", inserted.id)
  return inserted.id as string
}

async function showChunkAndExtraction(supabase: ReturnType<typeof createServiceClient>, documentId: string) {
  const { data: doc } = await supabase
    .from("case_documents")
    .select(
      "original_filename, processing_status, is_processed, verified_document_type, content_latest_id, processing_error",
    )
    .eq("id", documentId)
    .maybeSingle()

  console.log("\nDocument after processing:", doc)

  const contentId = doc?.content_latest_id
  if (!contentId) return

  const { data: chunks } = await supabase
    .from("case_document_chunks")
    .select("chunk_index, chunk_text")
    .eq("content_id", contentId)
    .order("chunk_index", { ascending: true })

  const fullText = (chunks ?? []).map((c) => c.chunk_text).join("\n")
  const dateIdx = fullText.search(/Date\/Time Report Made/i)
  console.log(`Chunk text: ${chunks?.length ?? 0} chunks, ${fullText.length} chars`)
  if (dateIdx >= 0) {
    console.log("FOUND date field:", fullText.slice(dateIdx, dateIdx + 80))
  } else {
    console.log("Date/Time Report Made: not found in chunk text")
    console.log("snippet:", fullText.slice(0, 500))
  }

  const { data: extraction } = await supabase
    .from("case_document_extractions")
    .select("extraction_type, extracted_text, created_at")
    .eq("document_id", documentId)
    .eq("extraction_type", "doc_summary_v3")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  console.log("Latest doc_summary_v3:", extraction?.extracted_text?.slice(0, 500) ?? "(none)")
}

async function main() {
  const supabase = createServiceClient()

  console.log(`\nPolice report orphan repair for case ${CASE_ID}`)
  console.log(`Storage: ${STORAGE_BUCKET}/${STORAGE_PATH}\n`)

  const documentId = await ensureCaseDocumentRow(supabase)

  console.log(`\n--- Running ${EVIDENCE_FN} (force=true) ---`)
  const evidenceResult = await callEdgeFunction(EVIDENCE_FN, {
    document_id: documentId,
    force: true,
  })
  console.log("evidence status:", evidenceResult.status)
  console.log(JSON.stringify(evidenceResult.body, null, 2))

  if (!evidenceResult.ok) {
    process.exit(1)
  }

  await showChunkAndExtraction(supabase, documentId)

  console.log(`\n--- Running ${EXTRACT_FN} (case validation) ---`)
  const extractResult = await callEdgeFunction(EXTRACT_FN, { case_id: CASE_ID })
  console.log("extract status:", extractResult.status)
  console.log(JSON.stringify(extractResult.body, null, 2))

  const { data: extractRun } = await supabase
    .from("case_extract_runs")
    .select("id, status, prompt_version, created_at")
    .eq("case_id", CASE_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: validationRun } = await supabase
    .from("case_validation_runs")
    .select("id, status, missing_fields, created_at")
    .eq("case_id", CASE_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  console.log("\nLatest extract run:", extractRun)
  console.log("Latest validation run:", validationRun)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
