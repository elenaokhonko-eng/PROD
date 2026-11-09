import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PDFDocument } from 'pdf-lib'
import { ALLOWED_MIME_TYPES } from '../../lib/types/documents'
import { MAX_PDF_PAGES, MAX_UPLOAD_BYTES, pdfPageCount } from '../../lib/server/upload-limits'

// Elena, 9 Nov: uploads are PDF, PNG or JPEG only (no SVG or HTML), at most 15 MB, and PDFs at most 30 pages.

async function pdfWithPages(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([200, 200])
  return doc.save()
}

test('only PDF, PNG and JPEG are accepted', () => {
  assert.deepEqual([...ALLOWED_MIME_TYPES].sort(), ['application/pdf', 'image/jpeg', 'image/png'])
})

test('size and page caps', async () => {
  assert.equal(MAX_UPLOAD_BYTES, 15 * 1024 * 1024)
  assert.equal(MAX_PDF_PAGES, 30)
  assert.equal(await pdfPageCount(await pdfWithPages(3)), 3)
  assert.equal(await pdfPageCount(await pdfWithPages(31)), 31)
  assert.equal(await pdfPageCount(new TextEncoder().encode('%PDF-1.4 not really a pdf')), null, 'unreadable: not refused on pages')
})

test('the upload route enforces the caps after the signature check', () => {
  const route = readFileSync('app/api/evidence/upload/route.ts', 'utf8')
  assert.match(route, /const MAX_FILE_BYTES = MAX_UPLOAD_BYTES/)
  assert.match(route, /pages > MAX_PDF_PAGES/)
  assert.ok(route.indexOf('hasValidFileSignature(file)') < route.indexOf('pdfPageCount('))
})
