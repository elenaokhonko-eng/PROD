/**
 * Shared helper: fire extract only when all case documents are settled.
 * Used by evidence auto-refire. Treats documents_not_ready (409) as pending.
 * Overlapping in-flight calls for the same caseId are coalesced.
 */

import { EXTRACT_FN } from "@/lib/edge-functions"
import {
  areDocumentsSettled,
  countDocumentReadiness,
  type DocStatusRow,
} from "@/lib/case-documents/document-readiness"

export type FireExtractWhenSettledResult =
  | { status: "skipped_not_settled"; not_ready: number }
  | { status: "skipped_overlap" }
  | { status: "pending_documents_not_ready" }
  | { status: "fired"; ok: boolean; http_status: number; error?: string }

const inFlightByCase = new Map<string, Promise<FireExtractWhenSettledResult>>()

export async function fireExtractWhenSettled(args: {
  caseId: string
  docs: DocStatusRow[]
  supabaseUrl?: string
  serviceKey?: string
  allowPartialEvidence?: boolean
}): Promise<FireExtractWhenSettledResult> {
  const { caseId, docs, allowPartialEvidence = false } = args
  const counts = countDocumentReadiness(docs)

  if (!areDocumentsSettled(docs)) {
    return { status: "skipped_not_settled", not_ready: counts.not_ready }
  }

  const existing = inFlightByCase.get(caseId)
  if (existing) return { status: "skipped_overlap" }

  const supabaseUrl = args.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = args.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return { status: "fired", ok: false, http_status: 0, error: "missing_supabase_env" }
  }

  const work = (async (): Promise<FireExtractWhenSettledResult> => {
    const res = await fetch(`${supabaseUrl}/functions/v1/${EXTRACT_FN}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        case_id: caseId,
        allow_partial_evidence: allowPartialEvidence === true,
      }),
    })

    const json = (await res.json().catch(() => null)) as {
      error?: string
      ok?: boolean
    } | null

    if (res.status === 409 && json?.error === "documents_not_ready") {
      return { status: "pending_documents_not_ready" }
    }

    if (!res.ok) {
      return {
        status: "fired",
        ok: false,
        http_status: res.status,
        error: json?.error ?? `http_${res.status}`,
      }
    }

    return { status: "fired", ok: true, http_status: res.status }
  })().finally(() => {
    inFlightByCase.delete(caseId)
  })

  inFlightByCase.set(caseId, work)
  return work
}
