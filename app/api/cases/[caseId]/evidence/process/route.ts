import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import { getProfileCaseEditAccess } from "@/lib/case-documents/register-from-evidence-v1"
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

type EvidenceDispatchResult = {
  evidence_id: string
  document_id: string
  job_id: string
  job_status: string
  queued: boolean
  skipped: boolean
}

type EvidenceJob = {
  id: string
  document_id: string | null
  status: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function firstRpcRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { caseId } = await params

  const body = (await request.json().catch(() => ({}))) as ProcessRequest
  const requestedIds = Array.isArray(body.evidenceIds)
    ? [...new Set(body.evidenceIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : []
  if (requestedIds.some((id) => !UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "evidenceIds must contain UUIDs" }, { status: 400 })
  }

  const service = createServiceClient()
  const caseAccess = await getProfileCaseEditAccess(service, caseId, user.supabaseUuid)
  if (caseAccess === "not_found") {
    return NextResponse.json({ error: "Case not found" }, { status: 404 })
  }
  if (caseAccess === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let evidenceIds: string[] = []
  let documentIds: string[] = []
  let missingIds: string[] = []
  if (requestedIds.length > 0) {
    const { data: evidenceRows, error: evidenceError } = await service
      .from("evidence")
      .select("id")
      .eq("case_id", caseId)
      .in("id", requestedIds)
    if (evidenceError) {
      return NextResponse.json({ error: "Unable to resolve evidence" }, { status: 400 })
    }

    evidenceIds = (evidenceRows ?? []).map((row) => row.id)
    const evidenceSet = new Set(evidenceIds)
    const unresolvedIds = requestedIds.filter((id) => !evidenceSet.has(id))
    if (unresolvedIds.length > 0) {
      const { data: documentRows, error: documentError } = await service
        .from("case_documents")
        .select("id")
        .eq("case_id", caseId)
        .in("id", unresolvedIds)
      if (documentError) {
        return NextResponse.json({ error: "Unable to resolve documents" }, { status: 400 })
      }
      documentIds = (documentRows ?? []).map((row) => row.id)
      const documentSet = new Set(documentIds)
      missingIds = unresolvedIds.filter((id) => !documentSet.has(id))
    }
  } else {
    const { data: evidenceRows, error: evidenceError } = await service
      .from("evidence")
      .select("id")
      .eq("case_id", caseId)
    if (evidenceError) {
      return NextResponse.json({ error: "Unable to resolve evidence" }, { status: 400 })
    }

    evidenceIds = (evidenceRows ?? []).map((row) => row.id)
    if (evidenceIds.length === 0) {
      const { data: documentRows, error: documentError } = await service
        .from("case_documents")
        .select("id")
        .eq("case_id", caseId)
      if (documentError) {
        return NextResponse.json({ error: "Unable to resolve documents" }, { status: 400 })
      }
      documentIds = (documentRows ?? []).map((row) => row.id)
    }
  }

  if (evidenceIds.length === 0 && documentIds.length === 0 && missingIds.length === 0) {
    return NextResponse.json({ error: "No documents found" }, { status: 400 })
  }

  const results: ProcessResult[] = missingIds.map((id) => ({
    evidence_id: id,
    ok: false,
    error: "Evidence or document not found",
  }))
  for (const evidenceId of evidenceIds) {
    const { data, error } = await service.rpc("register_and_enqueue_evidence_v1", {
      p_case_id: caseId,
      p_evidence_id: evidenceId,
      p_actor_profile_id: user.supabaseUuid,
    })
    const dispatch = firstRpcRow(data as EvidenceDispatchResult | EvidenceDispatchResult[] | null)
    if (error || !dispatch) {
      console.error("[evidence/process] Atomic evidence dispatch failed", {
        evidenceId,
        code: error?.code,
      })
      results.push({ evidence_id: evidenceId, ok: false, error: "Unable to queue evidence" })
      continue
    }

    results.push({
      evidence_id: evidenceId,
      document_id: dispatch.document_id,
      ok: true,
      queued: dispatch.queued,
      skipped: dispatch.skipped,
    })
  }

  for (const documentId of documentIds) {
    const { data, error } = await service.rpc("enqueue_evidence_processing_v1", {
      p_case_id: caseId,
      p_document_id: documentId,
      p_actor_profile_id: user.supabaseUuid,
    })
    const job = firstRpcRow(data as EvidenceJob | EvidenceJob[] | null)
    if (error || !job) {
      console.error("[evidence/process] Existing-document enqueue failed", {
        documentId,
        code: error?.code,
      })
      results.push({ evidence_id: documentId, document_id: documentId, ok: false, error: "Unable to queue document" })
      continue
    }

    results.push({
      evidence_id: documentId,
      document_id: job.document_id ?? documentId,
      ok: true,
      queued: job.status === "queued",
      skipped: job.status === "running" || job.status === "completed",
    })
  }

  const queued = results.filter((result) => result.queued).length
  const skipped = results.filter((result) => result.skipped).length
  return NextResponse.json({ ok: results.every((result) => result.ok), queued, skipped, results })
}
