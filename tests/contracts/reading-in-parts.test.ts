import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertCompleteText, partPageRanges } from '../../supabase/functions/_shared/read-parts'
import { splitIntoParts, mergeDocumentParts } from '../../lib/server/facts/document-parts'
import type { FactCandidate } from '../../lib/facts'

// Sections 8.1 and 9.2 of docs/release/part-b-release-requirements-2026-11-27.md. Synthetic values only.
const read = (file: string) => readFileSync(file, 'utf8')

test('a file is read in parts of up to 3 pages, covering every page once', () => {
  assert.deepEqual(partPageRanges(1), [[0]])
  assert.deepEqual(partPageRanges(7), [[0, 1, 2], [3, 4, 5], [6]])
  assert.equal(partPageRanges(15).flat().length, 15)
})

test('an abbreviated or empty part is a failed reading', () => {
  for (const bad of ['', '   ', 'header\n...\nEND', 'row 1\n…\nrow 9', 'a\n[...]\nb', 'a\n [truncated] \nb']) {
    assert.throws(() => assertCompleteText(bad), /document_part_abbreviated/, JSON.stringify(bad))
  }
  assert.doesNotThrow(() => assertCompleteText('Please wait... your payment\n2026-10-01 Sample 10.00'))
})

test('the reading step asks each part for its text only, checks it, and records the pages read', () => {
  const fn = read('supabase/functions/evidence_processed_v2/index.ts')
  for (const needed of ['partPageRanges(', 'assertCompleteText(', 'assertReadToTheEnd(', 'pages_read', 'Never abbreviate']) assert.ok(fn.includes(needed), needed)
  assert.doesNotMatch(fn, /"raw_text": "\.\.\."|If transaction-like entries exist/)
  assert.match(fn, /pipeline_version = "parts_v4/)
})

test('facts are read in parts: nothing is cut, and payments from every part are kept', () => {
  const text = Array.from({ length: 500 }, (_, i) => `2026-10-01 Test payment ${i} 10.25`).join('\n')
  const parts = splitIntoParts(text, 5_000)
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 5_000))
  assert.equal(parts.join('\n'), text)
  const candidate = (factKey: string, value: unknown, quote: string) => ({ factKey, value, sourceType: 'document', sourceRef: { sourceKey: 'k', quotes: [quote], confidence: 0.9 } }) as unknown as FactCandidate
  const same = { date: '2026-10-01', amount: { amount: 10, currency: 'SGD' }, payee: 'Sample' }
  const merged = mergeDocumentParts([
    [candidate('transactions', [same], 'a'), candidate('institution_names', [{ name: 'DBS/POSB' }], 'x')],
    [candidate('transactions', [same, { ...same, payee: 'Other' }], 'b'), candidate('institution_names', [{ name: 'DBS/POSB' }], 'x')],
  ])
  // Identical payments in different parts are separate payments: nothing is merged away.
  assert.equal((merged.find((c) => c.factKey === 'transactions')!.value as unknown[]).length, 3)
  assert.equal(merged.filter((c) => c.factKey === 'institution_names').length, 1)
  const runner = read('lib/server/facts/run-reconcile.ts')
  assert.match(runner, /splitIntoParts\(/)
  assert.doesNotMatch(runner, /text\.slice\(0, DOCUMENT_LIMIT\)/)
})

test('no output says a document was read in part, and the FIDReC pack reads all of it or is not delivered', () => {
  const wording = read('supabase/functions/_shared/facts/approved-wording.ts')
  assert.doesNotMatch(wording, /partlyRead|notRead|readingLimits|Only part of this document/)
  assert.doesNotMatch(read('components/state-machine/layer1/evidence-upload-panel.tsx'), /readingLimits/)
  const fn = read('supabase/functions/run_fidrec_pack_v1/index.ts')
  assert.match(fn, /reason: "documents_too_long"|documents_too_long/)
  assert.ok(fn.indexOf('documents_too_long') < fn.indexOf('chatJson('), 'refused before any model call')
})
