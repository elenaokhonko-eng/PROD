/**
 * Shared helper: fire extract only when all case documents are settled.
 * Used by evidence auto-refire. Treats documents_not_ready (409) as pending.
 * Overlapping in-flight calls for the same caseId are coalesced.
 */

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
  invokeExtract?: () => Promise<{ ok: boolean; httpStatus: number; error?: string }>
  /** @deprecated kept for older tests/callers. */
  supabaseUrl?: string
  /** @deprecated kept for older tests/callers. */
  serviceKey?: string
  allowPartialEvidence?: boolean
}): Promise<FireExtractWhenSettledResult> {
  const { caseId, docs } = args
  const counts = countDocumentReadiness(docs)

  if (!areDocumentsSettled(docs)) {
    return { status: "skipped_not_settled", not_ready: counts.not_ready }
  }

  const existing = inFlightByCase.get(caseId)
  if (existing) return { status: "skipped_overlap" }

  if (!args.invokeExtract) {
    return { status: "fired", ok: false, http_status: 0, error: "missing_extract_invoker" }
  }

  const work = (async (): Promise<FireExtractWhenSettledResult> => {
    const outcome = await args.invokeExtract!()

    if (outcome.httpStatus === 409 && outcome.error === "documents_not_ready") {
      return { status: "pending_documents_not_ready" }
    }
    if (!outcome.ok) {
      return {
        status: "fired",
        ok: false,
        http_status: outcome.httpStatus,
        error: outcome.error ?? `http_${outcome.httpStatus}`,
      }
    }

    return { status: "fired", ok: true, http_status: outcome.httpStatus }
  })().finally(() => {
    inFlightByCase.delete(caseId)
  })

  inFlightByCase.set(caseId, work)
  return work
}
