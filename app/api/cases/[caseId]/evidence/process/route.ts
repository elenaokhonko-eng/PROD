import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

export const runtime = "nodejs"

const STORAGE_BUCKET = "evidence"

type ProcessRequest = {
  evidenceIds?: string[]
}

type ProcessResult = {
  evidence_id: string
  document_id?: string | null
  ok: boolean
  queued?: boolean
  skipped?: boolean
  error?: string | null
}

export async function POST(request: Request, { params }: { params: { caseId: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const functionName = process.env.SUPABASE_DOCUMENT_PROCESSOR_FUNCTION
  if (!functionName) {
    return NextResponse.json({ error: "Missing SUPABASE_DOCUMENT_PROCESSOR_FUNCTION" }, { status: 500 })
  }

  const body = (await request.json().catch(() => ({}))) as ProcessRequest
  const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds.filter(Boolean) : []

  let evidenceQuery = supabase
    .from("evidence")
    .select("id, case_id, filename, file_path, file_type, file_size")
    .eq("case_id", params.caseId)

  if (evidenceIds.length > 0) {
    evidenceQuery = evidenceQuery.in("id", evidenceIds)
  }

  const { data: evidenceRows, error: evidenceError } = await evidenceQuery
  if (evidenceError) {
    return NextResponse.json({ error: evidenceError.message }, { status: 400 })
  }
  if (!evidenceRows || evidenceRows.length === 0) {
    return NextResponse.json({ error: "No evidence files found" }, { status: 400 })
  }

  const service = createServiceClient()
  const results: ProcessResult[] = []
  let queued = 0
  let skipped = 0

  for (const evidence of evidenceRows) {
    const { data: existingDoc, error: existingError } = await service
      .from("case_documents")
      .select("id, is_processed, processing_status")
      .eq("case_id", params.caseId)
      .eq("storage_bucket", STORAGE_BUCKET)
      .eq("storage_path", evidence.file_path)
      .maybeSingle()

    if (existingError) {
      results.push({ evidence_id: evidence.id, ok: false, error: existingError.message })
      continue
    }

    const status = (existingDoc?.processing_status ?? "").toString().toLowerCase()
    if (existingDoc?.is_processed || ["parsing", "verifying", "chunking", "extracting"].includes(status)) {
      skipped += 1
      results.push({
        evidence_id: evidence.id,
        document_id: existingDoc?.id ?? null,
        ok: true,
        queued: false,
        skipped: true,
      })
      continue
    }

    let documentId = existingDoc?.id ?? null
    if (!documentId) {
      const { data: createdDoc, error: createError } = await service
        .from("case_documents")
        .insert({
          case_id: params.caseId,
          filename: evidence.filename,
          original_filename: evidence.filename,
          file_size: evidence.file_size,
          mime_type: evidence.file_type,
          document_type: null,
          storage_bucket: STORAGE_BUCKET,
          storage_path: evidence.file_path,
          processing_status: "uploaded",
          is_processed: false,
        })
        .select("id")
        .single()

      if (createError || !createdDoc) {
        results.push({
          evidence_id: evidence.id,
          ok: false,
          error: createError?.message ?? "Failed to create case document record",
        })
        continue
      }

      documentId = createdDoc.id
    }

    const { error: fnError } = await service.functions.invoke(functionName, {
      body: { document_id: documentId },
    })

    if (fnError) {
      results.push({ evidence_id: evidence.id, document_id: documentId, ok: false, error: fnError.message })
      continue
    }

    queued += 1
    results.push({ evidence_id: evidence.id, document_id: documentId, ok: true, queued: true })
  }

  return NextResponse.json({ ok: true, queued, skipped, results })
}
