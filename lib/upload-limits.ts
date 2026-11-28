// Upload limits, used by the screen and the server. Elena, 9 Nov: every page of an upload is read by a model, so size
// and page count bound the spend per document. Types stay PDF, PNG and JPEG (lib/types/documents.ts).
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
export const MAX_PDF_PAGES = 15
// Elena, 28 Nov: 10 documents for the free evaluation and for both packs, until a higher number is proven.
export const MAX_DOCUMENTS = 10

export const UPLOAD_TOO_LARGE_MESSAGE = "This file is larger than 15 MB. Please upload a smaller copy, or the pages that matter."
// Requirements 8.2 and 8.3 (wording approved by Elena).
export const UPLOAD_TOO_MANY_PAGES_MESSAGE = `This file has more than ${MAX_PDF_PAGES} pages. Please upload only the pages that matter, as a separate file.`

export interface DocumentLimit {
  max: number
  of: "evaluation" | "pack"
}

/** How many documents a case may hold, and which output the person is told that about. */
export function documentLimit(features: Record<string, unknown>): DocumentLimit {
  const pack = features.allow_escalation_pack === true || features.allow_self_serve_report === true
  return { max: MAX_DOCUMENTS, of: pack ? "pack" : "evaluation" }
}

export const tooManyDocumentsMessage = (limit: DocumentLimit) => `You can add up to ${limit.max} documents for this ${limit.of}.`

export type UploadFault = "too_long" | "too_many"

export interface RefusedFile {
  name: string
  fault: UploadFault | null
  message: string
}

/**
 * Which of the chosen files to send, given how many the case already holds. A file over a limit is named; the others
 * are still sent. The server checks the same limits again.
 */
export function sortSelection<T extends { name: string; size: number; pages: number | null }>(
  files: readonly T[],
  held: number,
  limit: DocumentLimit,
): { send: T[]; refused: RefusedFile[] } {
  const send: T[] = []
  const refused: RefusedFile[] = []
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) refused.push({ name: file.name, fault: null, message: UPLOAD_TOO_LARGE_MESSAGE })
    else if (file.pages !== null && file.pages > MAX_PDF_PAGES) refused.push({ name: file.name, fault: "too_long", message: UPLOAD_TOO_MANY_PAGES_MESSAGE })
    else if (held + send.length >= limit.max) refused.push({ name: file.name, fault: "too_many", message: tooManyDocumentsMessage(limit) })
    else send.push(file)
  }
  return { send, refused }
}

/** Page count of a PDF, or null when it cannot be read (the upload is then not refused on pages). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib")
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
    return doc.getPageCount()
  } catch {
    // Fallback for files pdf-lib cannot parse: count page objects in the raw bytes (misses compressed object streams).
    const text = new TextDecoder("latin1").decode(bytes)
    const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0
    return pages > 0 ? pages : null
  }
}
