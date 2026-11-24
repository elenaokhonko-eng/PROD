// The documents a person uploaded, listed in their data export (Elena, 24 November 2026: the export lists the uploaded
// documents with file name, document type and upload date, not the files themselves). No file contents, no extracted
// text, no storage path or URL. Nothing here is logged.

/** Only these columns are read from case_documents. */
export const CASE_DOCUMENT_EXPORT_COLUMNS = "case_id, original_filename, document_type, verified_document_type, upload_date"

export interface CaseDocumentRow {
  case_id?: unknown
  original_filename?: unknown
  document_type?: unknown
  verified_document_type?: unknown
  upload_date?: unknown
}

export interface CaseDocumentExport {
  case_id: string
  file_name: string | null
  document_type: string | null
  uploaded_at: string | null
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null)

export function caseDocumentsExport(rows: readonly CaseDocumentRow[]): CaseDocumentExport[] {
  return rows
    .filter((r) => typeof r.case_id === "string")
    .map((r) => ({
      case_id: r.case_id as string,
      file_name: text(r.original_filename),
      // The type the document was checked to be, otherwise the type it was uploaded as.
      document_type: text(r.verified_document_type) ?? text(r.document_type),
      uploaded_at: text(r.upload_date),
    }))
    .sort((a, b) =>
      a.case_id === b.case_id ? (a.uploaded_at ?? "").localeCompare(b.uploaded_at ?? "") : a.case_id.localeCompare(b.case_id),
    )
}
