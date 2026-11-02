/**
 * `public.case_documents` row shape. Mirrors schema lines 827–848.
 * IS §4.3 + §9.3 (Realtime subscription) + §9.6 (MIME whitelist).
 */

export type DocumentProcessingStatus =
  | 'uploaded'
  | 'pending'
  | 'parsing'
  | 'verifying'
  | 'chunking'
  | 'extracting'
  | 'ready'
  | 'failed'
  | string

export interface CaseDocumentRow {
  id: string
  case_id: string | null
  created_at?: string | null
  updated_at?: string | null
  filename: string
  original_filename: string
  file_size: number | null
  mime_type: string | null
  document_type: string | null
  exhibit_label: string | null
  upload_date: string | null
  file_url: string | null
  is_processed: boolean | null
  sha256: string | null
  processing_status: DocumentProcessingStatus | null
  processing_error: string | null
  verified_document_type: string | null
  verification_status: string | null
  verification_confidence: number | null
  content_latest_id: string | null
  storage_provider: string | null
  storage_bucket: string | null
  storage_path: string | null
}

/** MIME whitelist, SM R7 / IS §9.6 / §8.1 gotcha 4. */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

export const ALLOWED_FILE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'] as const

export function isAllowedMime(mime: string | null | undefined): mime is AllowedMimeType {
  if (!mime) return false
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime)
}

export interface EvidencePayload {
  document_id: string
}

export interface EvidenceResponse {
  ok: boolean
  processing_status?: DocumentProcessingStatus
  error?: string
}
