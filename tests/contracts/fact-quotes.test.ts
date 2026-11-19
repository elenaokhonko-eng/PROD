import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFactExtraction } from '../../lib/facts'

// 20 Nov 2026: gpt-6-luna joins quoted lines with "; ". Without the date the quote carries, a police report's own date
// never meets the story's, and the conflict card is missed. The quote still has to be in the source, part by part.
const source = 'SINGAPORE POLICE FORCE - Police Report Acknowledgement\nReport No: G/20241031/0000\nDate/time of report: 31 Oct 2024 09:40'
const ref = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:test:0' } }
const policeDate = (quote: string) => {
  const candidate = parseFactExtraction(
    { document_type: 'police_report', reported_to_police: { value: 'yes', date: '2024-10-31', reference: 'G/20241031/0000', quote, confidence: 1 } },
    source,
    ref,
  ).find((c) => c.factKey === 'reported_to_police')
  return (candidate?.value as { date?: string | null } | undefined)?.date ?? null
}

test('a quote that joins lines of the source with "; " keeps the date it supports', () => {
  assert.equal(policeDate('Report No: G/20241031/0000; Date/time of report: 31 Oct 2024 09:40'), '2024-10-31')
  assert.equal(policeDate('Report No: G/20241031/0000 Date/time of report: 31 Oct 2024'), '2024-10-31', 'as before: a plain span')
})

test('a joined quote with any part the source does not say is not trusted', () => {
  assert.equal(policeDate('Report No: G/20241031/0000; Date/time of report: 1 Nov 2024'), null)
  assert.equal(policeDate('Report No: G/20241031/0000; ab'), null, 'tiny parts do not count')
  assert.equal(policeDate('The police confirmed a refund'), null)
})
