import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import {
  EVIDENCE_STORAGE_BUCKET,
  getProfileCaseAccess,
  registerCaseDocumentFromEvidenceV1,
} from "@/lib/case-documents/register-from-evidence-v1"
import { EVIDENCE_FN } from "@/lib/edge-functions"
import { createServiceClient } from "@/lib/supabase/service"

export const runtime = "nodejs"

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
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { caseId } = await params

  const functionName = EVIDENCE_FN

  const body = (await request.json().catch(() => ({}))) as ProcessRequest
  const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds.filter(Boolean) : []

  const service = createServiceClient()
  const caseAccess = await getProfileCaseAccess(service, caseId, user.supabaseUuid)
  if (caseAccess === "not_found") {
    return NextResponse.json({ error: "Case not found" }, { status: 404 })
  }
  if (caseAccess === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let evidenceRows: Array<{
    id: string
    case_id: string
    filename: string
    file_path: string
    file_type: string
    file_size: number
    category: string
  }> = []

  if (evidenceIds.length > 0) {
    const { data, error } = await service
      .from("evidence")
      .select("id, case_id, filename, file_path, file_type, file_size, category")
      .eq("case_id", caseId)
      .in("id", evidenceIds)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    evidenceRows = data ?? []
  } else {
    const { data, error } = await service
      .from("evidence")
      .select("id, case_id, filename, file_path, file_type, file_size, category")
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
      .eq("storage_bucket", EVIDENCE_STORAGE_BUCKET)
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

    const registered = await registerCaseDocumentFromEvidenceV1(service, {
      caseId,
      profileId: user.supabaseUuid,
      evidence: {
        id: evidence.id,
        case_id: evidence.case_id,
        filename: evidence.filename,
        file_path: evidence.file_path,
        file_type: evidence.file_type,
        file_size: evidence.file_size,
        category: evidence.category,
      },
      storageBucket: EVIDENCE_STORAGE_BUCKET,
      initialProcessingStatus: "uploaded",
    })

    if (registered.ok === false) {
      results.push({
        evidence_id: evidence.id,
        ok: false,
        error: registered.error,
      })
      continue
    }

    const documentId = registered.document_id

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
