/**
 * Document readiness for extract preflight.
 *
 * Settled usable (ready): status in {ready, processed, completed}, is_processed=true,
 * and extraction/content present. Legacy processed/completed rows remain usable when
 * content exists. Settled unavailable (failed): status=failed — count, do not block.
 * not_ready: uploaded, queued, in-flight, null/unknown, or a legacy-ready row missing extraction data.
 */

export type DocStatusRow = {
  id: string
  processing_status: string | null | undefined
  is_processed?: boolean | null
  /** True when case_document_extractions (or equivalent content) exists for this doc. */
  has_extraction_content?: boolean | null
}

export type DocumentBucket =
  | "ready"
  | "failed"
  | "queued"
  | "processing"
  | "uploaded"
  | "not_ready_other"

export type DocumentReadinessCounts = {
  total: number
  ready: number
  evidence: number // alias of ready (docs usable as extract evidence)
  queued: number
  processing: number
  uploaded: number
  failed: number
  not_ready: number
  not_ready_other: number
}

export type EvidenceSnapshot = {
  counts: DocumentReadinessCounts
  ready_ids: string[]
  failed_ids: string[]
  not_ready_ids: string[]
  queued_ids: string[]
  processing_ids: string[]
  uploaded_ids: string[]
}

export const IN_FLIGHT_STATUSES = [
  "parsing",
  "verifying",
  "chunking",
  "extracting",
  "processing",
] as const

export function normalizeDocStatus(status: string | null | undefined): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
}

export function classifyDocument(row: DocStatusRow): DocumentBucket {
  const s = normalizeDocStatus(row.processing_status)

  if (s === "failed") return "failed"

  const hasContent = row.has_extraction_content === true
  const legacyReadyStatuses = new Set(["ready", "processed", "completed"])
  const isLegacyReadyStatus = legacyReadyStatuses.has(s)
  const processedFlag = row.is_processed === true

  if (isLegacyReadyStatus && processedFlag && hasContent) return "ready"

  // Claimed ready/processed/completed but missing extraction or stale state → not ready.
  if (isLegacyReadyStatus || processedFlag) return "not_ready_other"

  if (s === "queued") return "queued"
  if ((IN_FLIGHT_STATUSES as readonly string[]).includes(s)) return "processing"
  if (s === "uploaded") return "uploaded"
  // null, empty, unknown
  return "not_ready_other"
}

export function countDocumentReadiness(docs: DocStatusRow[]): DocumentReadinessCounts {
  const counts: DocumentReadinessCounts = {
    total: docs.length,
    ready: 0,
    evidence: 0,
    queued: 0,
    processing: 0,
    uploaded: 0,
    failed: 0,
    not_ready: 0,
    not_ready_other: 0,
  }

  for (const doc of docs) {
    switch (classifyDocument(doc)) {
      case "ready":
        counts.ready += 1
        counts.evidence += 1
        break
      case "failed":
        counts.failed += 1
        break
      case "queued":
        counts.queued += 1
        counts.not_ready += 1
        break
      case "processing":
        counts.processing += 1
        counts.not_ready += 1
        break
      case "uploaded":
        counts.uploaded += 1
        counts.not_ready += 1
        break
      case "not_ready_other":
        counts.not_ready_other += 1
        counts.not_ready += 1
        break
    }
  }

  return counts
}

export function buildEvidenceSnapshot(docs: DocStatusRow[]): EvidenceSnapshot {
  const counts = countDocumentReadiness(docs)
  const ready_ids: string[] = []
  const failed_ids: string[] = []
  const not_ready_ids: string[] = []
  const queued_ids: string[] = []
  const processing_ids: string[] = []
  const uploaded_ids: string[] = []

  for (const doc of docs) {
    const bucket = classifyDocument(doc)
    switch (bucket) {
      case "ready":
        ready_ids.push(doc.id)
        break
      case "failed":
        failed_ids.push(doc.id)
        break
      case "queued":
        queued_ids.push(doc.id)
        not_ready_ids.push(doc.id)
        break
      case "processing":
        processing_ids.push(doc.id)
        not_ready_ids.push(doc.id)
        break
      case "uploaded":
        uploaded_ids.push(doc.id)
        not_ready_ids.push(doc.id)
        break
      case "not_ready_other":
        not_ready_ids.push(doc.id)
        break
    }
  }

  return {
    counts,
    ready_ids,
    failed_ids,
    not_ready_ids,
    queued_ids,
    processing_ids,
    uploaded_ids,
  }
}

export type ExtractReadinessDecision = {
  ready: boolean
  block_reason: "documents_not_ready" | null
  counts: DocumentReadinessCounts
  snapshot: EvidenceSnapshot
  all_settled: boolean
}

/** All docs are either ready (usable) or failed — no not_ready remaining. */
export function areDocumentsSettled(docs: DocStatusRow[]): boolean {
  return docs.every((d) => {
    const b = classifyDocument(d)
    return b === "ready" || b === "failed"
  })
}

export function decideExtractDocumentReadiness(
  docs: DocStatusRow[],
  opts?: { allowPartialEvidence?: boolean },
): ExtractReadinessDecision {
  const snapshot = buildEvidenceSnapshot(docs)
  const counts = snapshot.counts
  const allowPartial = opts?.allowPartialEvidence === true
  const all_settled = areDocumentsSettled(docs)
  const shouldBlock = !allowPartial && counts.not_ready > 0

  return {
    ready: !shouldBlock,
    block_reason: shouldBlock ? "documents_not_ready" : null,
    counts,
    snapshot,
    all_settled,
  }
}

export function documentsNotReadyResponse(
  counts: DocumentReadinessCounts,
  extra?: Record<string, unknown>,
) {
  return {
    ok: false,
    error: "documents_not_ready" as const,
    documents_not_ready: {
      total: counts.total,
      processed: counts.ready,
      ready: counts.ready,
      evidence: counts.evidence,
      queued: counts.queued,
      processing: counts.processing,
      uploaded: counts.uploaded,
      failed: counts.failed,
      not_ready: counts.not_ready,
    },
    ...extra,
  }
}

/** Persistable fields for case_extract_runs insert. */
export function extractRunReadinessPersistFields(
  decision: ExtractReadinessDecision,
  allowPartialEvidence: boolean,
  snapshotAt: string = new Date().toISOString(),
) {
  const c = decision.counts
  return {
    allow_partial_evidence: allowPartialEvidence,
    total_document_count: c.total,
    evidence_document_count: c.evidence,
    ready_document_count: c.ready,
    queued_document_count: c.queued,
    processing_document_count: c.processing,
    uploaded_document_count: c.uploaded,
    failed_document_count: c.failed,
    not_ready_document_count: c.not_ready,
    document_snapshot_at: snapshotAt,
    evidence_snapshot: {
      counts: c,
      ready_ids: decision.snapshot.ready_ids,
      failed_ids: decision.snapshot.failed_ids,
      not_ready_ids: decision.snapshot.not_ready_ids,
    },
  }
}
