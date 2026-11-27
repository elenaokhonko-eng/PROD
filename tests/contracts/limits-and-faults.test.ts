import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { APPROVED } from '../../lib/facts'
import { documentLimit, MAX_PDF_PAGES, tooManyDocumentsMessage, UPLOAD_TOO_MANY_PAGES_MESSAGE } from '../../lib/server/upload-limits'

// Requirements 8.2 and 8.3 (approved by Elena, 27-28 Nov 2026).
const read = (file: string) => readFileSync(file, 'utf8')

test('8.2: 15 pages a file; 10 documents for the evaluation, 15 for the bank pack and, for now, the FIDReC pack', () => {
  assert.equal(MAX_PDF_PAGES, 15)
  assert.equal(UPLOAD_TOO_MANY_PAGES_MESSAGE, 'This file has more than 15 pages. Please upload only the pages that matter, as a separate file.')
  assert.deepEqual(documentLimit({}), { max: 10, of: 'evaluation' })
  assert.deepEqual(documentLimit({ allow_self_serve_report: true }), { max: 15, of: 'pack' })
  assert.deepEqual(documentLimit({ allow_escalation_pack: true }), { max: 15, of: 'pack' })
  assert.equal(tooManyDocumentsMessage({ max: 10, of: 'evaluation' }), 'You can add up to 10 documents for this evaluation.')
  assert.equal(tooManyDocumentsMessage({ max: 15, of: 'pack' }), 'You can add up to 15 documents for this pack.')
  const route = read('app/api/evidence/upload/route.ts')
  assert.ok(route.indexOf('tooManyDocumentsMessage(') > 0 && route.indexOf('tooManyDocumentsMessage(') < route.indexOf('.upload(filePath'), 'refused before anything is stored')
})

test('8.3: each fault is named, in the approved words, and logged without case content', () => {
  assert.equal(APPROVED.readingTimedOut, 'Reading your documents took too long and did not finish. Please try again now.')
  assert.equal(APPROVED.evaluationCap, 'We’ve reached today’s limit for free evaluations. Your answers are saved. Please come back tomorrow.')
  const panel = read('components/state-machine/facts/confirm-facts-panel.tsx')
  assert.match(panel, /APPROVED\.readingTimedOut/)
  assert.match(panel, /APPROVED\.evaluationCap/)
  const route = read('app/api/cases/[caseId]/facts/route.ts')
  assert.match(route, /reading_timed_out/)
  assert.match(route, /recordFault\(/)
  const upload = read('app/api/evidence/upload/route.ts')
  assert.match(upload, /recordFault\(createServiceClient\(\), "too_long", caseId\)/)
  assert.match(upload, /recordFault\(supabaseService, "too_many", caseId\)/)
  assert.match(upload, /neq\("processing_status", "failed"\)/)
  const log = read('lib/server/fault-log.ts')
  assert.match(log, /event_data: \{ fault, case_id: caseId \}/)
})

test('a failure of the reading service is logged as its own fault', () => {
  const route = readFileSync('app/api/cases/[caseId]/facts/route.ts', 'utf8')
  assert.match(route, /instanceof FactsUnavailableError\) \{\s+await recordFault\(createServiceClient\(\), "service_failed", caseId\)/)
})

test('no screen or file prints a date in the machine’s own time zone', () => {
  for (const file of [
    'components/state-machine/layer3/tier2-pack-view.tsx',
    'components/harbor/report-problem.tsx',
    'lib/server/fidrec/build-case-pack-markdown.ts',
    'lib/server/fidrec/build-case-pack-pdf.ts',
  ]) assert.doesNotMatch(readFileSync(file, 'utf8'), /\.toLocale(Date|Time)?String\(\s*(\)|['"]en-SG['"]\))/, file)
})
