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

// Part B walk-through, 25 Nov (PB-20): the same file uploaded twice was kept twice.
test('an upload whose bytes match a document already in the case is refused before it is stored or counted', () => {
  const route = readFileSync('app/api/evidence/upload/route.ts', 'utf8')
  assert.ok(route.includes('This file is already in your case as “${existing}”. You don’t need to add it again.'))
  assert.match(route, /\.from\("evidence"\)\s*\.select\("filename, file_path"\)\s*\.eq\("case_id", caseId\)\s*\.eq\("file_size", file\.size\)/)
  assert.match(route, /sha256Of\(await stored\.arrayBuffer\(\)\) === hash/)
  const check = route.indexOf('await duplicateOf(supabaseService, caseId, file)')
  assert.ok(check > 0 && check < route.indexOf('overUploadLimit(user.supabaseUuid)'), 'before the usage limits')
  assert.ok(check < route.indexOf('.storage.from(STORAGE_BUCKET).upload('), 'before the file is stored')
  assert.match(route, /status: 409/)
  const hook = readFileSync('hooks/state-machine/layer1/use-upload-evidence.ts', 'utf8')
  assert.match(hook, /uploadResponse\.status === 409\) && uploadJson\?\.error\) \{\s*throw new UploadRefusedError/)
})
