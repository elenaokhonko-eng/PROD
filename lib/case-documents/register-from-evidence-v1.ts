import type { SupabaseClient } from "@supabase/supabase-js"

/** Bucket used by `/api/evidence/upload` and evidence processing. */
export const EVIDENCE_STORAGE_BUCKET = "evidence" as const

export type EvidenceRowForRegistration = {
  id: string
  case_id: string
  filename: string
  file_path: string
  file_type: string
  file_size: number
  category: string
}

export type RegisterCaseDocumentFromEvidenceV1Result =
  | { ok: true; document_id: string; created: boolean }
  | { ok: false; error: string }

const CATEGORY_TO_DOCUMENT_TYPE: Record<string, string | null> = {
  evidence: null,
}

export function mapEvidenceCategoryToDocumentType(category: string): string | null {
  const key = category.trim().toLowerCase()
  if (key in CATEGORY_TO_DOCUMENT_TYPE) {
    return CATEGORY_TO_DOCUMENT_TYPE[key] ?? null
  }
  if (/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(key)) {
    return key
  }
  return null
}

export type ProfileCaseAccess = "ok" | "not_found" | "forbidden"

export async function getProfileCaseAccess(
  supabase: SupabaseClient,
  caseId: string,
  profileId: string
): Promise<ProfileCaseAccess> {
  const { data: caseRow, error: caseError } = await supabase
    .from("cases")
    .select("id, user_id")
    .eq("id", caseId)
    .maybeSingle()

  if (caseError || !caseRow) {
    return "not_found"
  }

  if (caseRow.user_id === profileId) {
    return "ok"
  }

  const { data: collaborator } = await supabase
    .from("case_collaborators")
    .select("user_id")
    .eq("case_id", caseId)
    .eq("user_id", profileId)
    .eq("status", "active")
    .maybeSingle()

  return collaborator ? "ok" : "forbidden"
}

export async function profileHasCaseAccess(
  supabase: SupabaseClient,
  caseId: string,
  profileId: string
): Promise<boolean> {
  return (await getProfileCaseAccess(supabase, caseId, profileId)) === "ok"
}

/**
 * Paths must match upload layout: `{caseId}/{category}/{fileName}` with no traversal.
 */
export function isValidEvidenceStoragePath(caseId: string, filePath: string): boolean {
  const normalized = filePath.trim()
  if (!normalized || normalized.includes("..")) {
    return false
  }
  const prefix = `${caseId}/`
  if (!normalized.startsWith(prefix)) {
    return false
  }
  const rest = normalized.slice(prefix.length)
  if (!rest || rest.includes("//")) {
    return false
  }
  const segments = rest.split("/")
  if (segments.length < 2) {
    return false
  }
  if (segments.some((s) => !s || s === "." || s === "..")) {
    return false
  }
  return true
}

/**
 * Registers (or resolves) a `case_documents` row for an `evidence` upload in the evidence bucket.
 * Validates case access, evidence ownership, storage path shape, and de-duplicates on bucket + path.
 */
export async function registerCaseDocumentFromEvidenceV1(
  supabase: SupabaseClient,
  args: {
    caseId: string
    profileId: string
    evidence: EvidenceRowForRegistration
    storageBucket?: typeof EVIDENCE_STORAGE_BUCKET
    initialProcessingStatus?: string
  }
): Promise<RegisterCaseDocumentFromEvidenceV1Result> {
  const { caseId, profileId, evidence } = args
  const storageBucket = args.storageBucket ?? EVIDENCE_STORAGE_BUCKET
  const initialProcessingStatus = args.initialProcessingStatus ?? "uploaded"

  const access = await getProfileCaseAccess(supabase, caseId, profileId)
  if (access === "not_found") {
    return { ok: false, error: "Case not found" }
  }
  if (access === "forbidden") {
    return { ok: false, error: "Forbidden" }
  }

  if (evidence.case_id !== caseId) {
    return { ok: false, error: "Evidence does not belong to this case" }
  }

  if (storageBucket !== EVIDENCE_STORAGE_BUCKET) {
    return { ok: false, error: "Unsupported storage bucket" }
  }

  if (!isValidEvidenceStoragePath(caseId, evidence.file_path)) {
    return { ok: false, error: "Invalid storage path for case" }
  }

  const { data: existing, error: existingError } = await supabase
    .from("case_documents")
    .select("id, case_id")
    .eq("storage_bucket", storageBucket)
    .eq("storage_path", evidence.file_path)
    .maybeSingle()

  if (existingError) {
    return { ok: false, error: existingError.message }
  }

  if (existing) {
    if (existing.case_id !== caseId) {
      return { ok: false, error: "Storage path is already registered to another case" }
    }
    return { ok: true, document_id: existing.id, created: false }
  }

  const documentType = mapEvidenceCategoryToDocumentType(evidence.category)

  const { data: created, error: insertError } = await supabase
    .from("case_documents")
    .insert({
      case_id: caseId,
      filename: evidence.filename,
      original_filename: evidence.filename,
      file_size: evidence.file_size,
      mime_type: evidence.file_type,
      document_type: documentType,
      storage_bucket: storageBucket,
      storage_path: evidence.file_path,
      processing_status: initialProcessingStatus,
      is_processed: false,
    })
    .select("id")
    .single()

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced, error: raceError } = await supabase
        .from("case_documents")
        .select("id, case_id")
        .eq("storage_bucket", storageBucket)
        .eq("storage_path", evidence.file_path)
        .maybeSingle()

      if (raceError || !raced) {
        return { ok: false, error: raceError?.message ?? "Duplicate registration race" }
      }
      if (raced.case_id !== caseId) {
        return { ok: false, error: "Storage path is already registered to another case" }
      }
      return { ok: true, document_id: raced.id, created: false }
    }
    return { ok: false, error: insertError.message }
  }

  if (!created?.id) {
    return { ok: false, error: "Failed to create case document record" }
  }

  return { ok: true, document_id: created.id, created: true }
}
