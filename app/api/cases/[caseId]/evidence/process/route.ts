import { NextResponse } from "next/server"

import { getOrCreateProfile } from "@/lib/auth"
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

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const user = await getOrCreateProfile()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { caseId } = await params

  const functionName = process.env.SUPABASE_DOCUMENT_PROCESSOR_FUNCTION
  if (!functionName) {
    return NextResponse.json({ error: "Missing SUPABASE_DOCUMENT_PROCESSOR_FUNCTION" }, { status: 500 })
  }

  const body = (await request.json().catch(() => ({}))) as ProcessRequest
  const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds.filter(Boolean) : []

  const service = createServiceClient()
  const { data: caseRow, error: caseError } = await service
    .from("cases")
    .select("id, user_id")
    .eq("id", caseId)
    .single()

  if (caseError || !caseRow) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 })
  }

  if (caseRow.user_id !== user.profileId) {
    const { data: collaborator } = await service
      .from("case_collaborators")
      .select("user_id")
      .eq("case_id", caseId)
      .eq("user_id", user.profileId)
      .eq("status", "active")
      .maybeSingle()

    if (!collaborator) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  let evidenceRows: Array<{
    id: string
    filename: string
    file_path: string
    file_type: string
    file_size: number
  }> = []

  if (evidenceIds.length > 0) {
    const { data, error } = await service
      .from("evidence")
      .select("id, filename, file_path, file_type, file_size")
      .eq("case_id", caseId)
      .in("id", evidenceIds)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    evidenceRows = data ?? []
  } else {
    const { data, error } = await service
      .from("evidence")
      .select("id, filename, file_path, file_type, file_size")
      .eq("case_id", caseId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    evidenceRows = data ?? []
  }

  if (!evidenceRows.length) {
    let caseDocQuery = service
      .from("case_documents")
      .select("id")
      .eq("case_id", caseId)

    if (evidenceIds.length > 0) {
      caseDocQuery = caseDocQuery.in("id", evidenceIds)
    }

    const { data: caseDocs, error: caseDocError } = await caseDocQuery
    if (caseDocError) {
      return NextResponse.json({ error: caseDocError.message }, { status: 400 })
    }

    if (!caseDocs || caseDocs.length === 0) {
      return NextResponse.json({ error: "No documents found" }, { status: 400 })
    }

    const results: ProcessResult[] = []
    let queued = 0
    let skipped = 0

    for (const doc of caseDocs) {
      const { data: existingDoc, error: existingError } = await service
        .from("case_documents")
        .select("id, is_processed, processing_status")
        .eq("id", doc.id)
        .eq("case_id", caseId)
        .maybeSingle()

      if (existingError || !existingDoc) {
        results.push({ evidence_id: doc.id, ok: false, error: existingError?.message ?? "Document not found" })
        continue
      }

      const status = (existingDoc.processing_status ?? "").toString().toLowerCase()
      if (existingDoc.is_processed || ["parsing", "verifying", "chunking", "extracting"].includes(status)) {
        skipped += 1
        results.push({
          evidence_id: doc.id,
          document_id: existingDoc.id,
          ok: true,
          queued: false,
          skipped: true,
        })
        continue
      }

      const { error: statusError } = await service
        .from("case_documents")
        .update({ processing_status: "queued", processing_error: null, is_processed: false })
        .eq("id", existingDoc.id)

      if (statusError) {
        results.push({ evidence_id: doc.id, document_id: existingDoc.id, ok: false, error: statusError.message })
        continue
      }

      void service.functions
        .invoke(functionName, { body: { document_id: existingDoc.id } })
        .catch((error) => {
          console.error("[evidence/process] Async invoke failed:", error)
        })

      queued += 1
      results.push({ evidence_id: doc.id, document_id: existingDoc.id, ok: true, queued: true })
    }

    return NextResponse.json({ ok: true, queued, skipped, results })
  }
  const results: ProcessResult[] = []
  let queued = 0
  let skipped = 0

  for (const evidence of evidenceRows) {
    const { data: existingDoc, error: existingError } = await service
      .from("case_documents")
      .select("id, is_processed, processing_status")
      .eq("case_id", caseId)
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
          case_id: caseId,
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

    const { error: statusError } = await service
      .from("case_documents")
      .update({ processing_status: "queued", processing_error: null, is_processed: false })
      .eq("id", documentId)

    if (statusError) {
      results.push({ evidence_id: evidence.id, document_id: documentId, ok: false, error: statusError.message })
      continue
    }

    void service.functions
      .invoke(functionName, { body: { document_id: documentId } })
      .catch((error) => {
        console.error("[evidence/process] Async invoke failed:", error)
      })

    queued += 1
    results.push({ evidence_id: evidence.id, document_id: documentId, ok: true, queued: true })
  }

  return NextResponse.json({ ok: true, queued, skipped, results })
}
