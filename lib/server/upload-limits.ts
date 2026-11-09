import { PDFDocument } from "pdf-lib"

// Upload limits (Elena, 9 Nov): every page of an upload is read by a model, so size and page count bound the spend per
// document. Types stay PDF, PNG and JPEG (lib/types/documents.ts), each checked by its file signature.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
export const MAX_PDF_PAGES = 30

export const UPLOAD_TOO_LARGE_MESSAGE = "This file is larger than 15 MB. Please upload a smaller copy, or the pages that matter."
export const UPLOAD_TOO_MANY_PAGES_MESSAGE = `This PDF has more than ${MAX_PDF_PAGES} pages. Please upload only the pages that matter.`

/** Page count of a PDF, or null when it cannot be read (the upload is then not refused on pages). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
    return doc.getPageCount()
  } catch {
    // Fallback for files pdf-lib cannot parse: count page objects in the raw bytes (misses compressed object streams).
    const text = new TextDecoder("latin1").decode(bytes)
    const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0
    return pages > 0 ? pages : null
  }
}
