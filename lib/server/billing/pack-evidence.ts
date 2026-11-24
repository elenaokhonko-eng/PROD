import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { checkPackEvidence, EVIDENCE_DOCUMENT_SELECT, type EvidenceCheck, type EvidenceDocument, type PackProduct } from "@/lib/billing/evidence-minimums"

export class PackEvidenceUnavailableError extends Error {}

export async function loadPackEvidence(service: SupabaseClient, caseId: string, product: PackProduct): Promise<EvidenceCheck> {
  const { data, error } = await service.from("case_documents").select(EVIDENCE_DOCUMENT_SELECT).eq("case_id", caseId)
  if (error) throw new PackEvidenceUnavailableError("Documents are not available right now")
  return checkPackEvidence(product, (data ?? []) as EvidenceDocument[])
}

// Beside facts_unconfirmed and documents_processing: the pack is paid for, but a document it needs isn't in yet.
export function evidenceMissingResponse(check: EvidenceCheck): NextResponse | null {
  if (check.ready) return null
  return NextResponse.json(
    { error: "Add the documents this pack needs first", reason: "evidence_missing", missing: check.missing },
    { status: 409 },
  )
}
