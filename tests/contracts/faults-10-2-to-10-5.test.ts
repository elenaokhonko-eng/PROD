import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  APPROVED,
  buildSnapshot,
  evidenceLists,
  formatSingaporeDate,
  institutionsIn,
  MAX_PAYMENTS,
  paymentsTable,
  transactionRows,
} from '../../lib/facts'

// Requirements 9.4 and 10.2 to 10.5 (28 Nov 2026). Synthetic values only.
const read = (file: string) => readFileSync(file, 'utf8')
// The story box's own example text (components/landing/narrative-capture.tsx).
const STORY_EXAMPLE = /export const STORY_EXAMPLE =\s*"([^"]+)"/.exec(read('components/landing/narrative-capture.tsx'))![1]
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const pay = (day: number, amount: number) => ({ date: `2026-10-${String(day).padStart(2, '0')}`, amount: sgd(amount), channel: null, payee: `Shop ${day}`, last4: null, instrument: 'account_transfer' as const })
const confirmed = <T>(value: T) => ({ value, label: 'confirmed' as const })
const doc = (documentId: string) => ({ sourceType: 'document' as const, sourceRef: { documentId, documentType: 'bank_statement' } })
const story = { sourceType: 'story' as const, sourceRef: {} }
const finding = (values: Array<{ value: unknown; sources: unknown[] }>) => [{ factKey: 'transactions' as const, values, resolution: { kind: 'choice' as const, index: 0 } }] as never
const five = [pay(1, 10), pay(2, 20), pay(3, 30), pay(4, 40), pay(5, 50)]

test('10.2: a bank field holds names only', () => {
  assert.ok(STORY_EXAMPLE.length > 500)
  assert.deepEqual(institutionsIn(STORY_EXAMPLE), [], 'the example story names no bank, and leaves no scraps')
  assert.deepEqual(institutionsIn('I got a call, they said my account was frozen, and I panicked'), [])
  assert.deepEqual(institutionsIn('DBS and GrabPay').map((i) => i.name).sort(), ['DBS/POSB', 'GrabPay'])
  assert.deepEqual(institutionsIn('Sample Finance Bank, then I waited').map((i) => i.name), ['Sample Finance Bank'])
})

test('10.3 and 9.4: documents are counted together, and the two lines never disagree', () => {
  // Two statements, each showing part of the five confirmed payments, one of them twice between them.
  const lists = evidenceLists({ transactions: confirmed(five) }, finding([{ value: five, sources: [story] }, { value: five.slice(0, 2), sources: [doc('a')] }, { value: five.slice(1, 3), sources: [doc('b')] }]))
  assert.deepEqual(lists.shown, ['You confirmed 5 payments. Your bank statements (uploaded) show 3 of them.'])
  const all = evidenceLists({ transactions: confirmed(five) }, finding([{ value: five, sources: [doc('a')] }]))
  assert.deepEqual(all.shown, ['The payments you dispute: 5 payments, S$150 in total, 1 to 5 Oct 2026. Shown by your bank statement (uploaded).'])
  const extra = evidenceLists({ transactions: confirmed(five.slice(0, 2)) }, finding([{ value: five.slice(0, 2), sources: [story] }, { value: five, sources: [doc('a')] }]))
  assert.ok(extra.shown.includes('Your bank statement (uploaded) shows 3 payments that are not in your confirmed facts.'), extra.shown.join(' | '))
  assert.ok(extra.shown[0].startsWith('The payments you dispute: 2 payments'))
  const none = evidenceLists({ transactions: confirmed(five) }, finding([{ value: five, sources: [story] }]))
  assert.deepEqual(none.shown, [])
  assert.match(none.missing[0], /^The payments you dispute: 5 payments.*No document yet/)
  const fidrec = evidenceLists({ transactions: confirmed(five) }, finding([{ value: five, sources: [story] }, { value: five.slice(0, 2), sources: [doc('a')] }]), { voice: 'complainant', evidenceId: () => 'E1' })
  assert.deepEqual(fidrec.shown, ['The complainant states 5 payments. The bank statement (E1) shows 2 of them.'])
})

test('9.4: the table marks the rows no document shows', () => {
  const rows = transactionRows(five, [five.slice(0, 2)])
  assert.deepEqual(rows.map((r) => r['Not shown in a document']), ['', '', '✓', '✓', '✓'])
  assert.ok(!('Not shown in a document' in transactionRows(five, [five])[0]), 'no column when every row is shown')
  assert.ok(!('Not shown in a document' in transactionRows(five)[0]), 'nor when no document lists payments')
  assert.match(paymentsTable({ transactions: confirmed(five) }, finding([{ value: five.slice(0, 1), sources: [doc('a')] }]))!, /Not shown in a document/)
})

test('10.4: printed dates are Singapore dates', () => {
  assert.equal(formatSingaporeDate('2026-11-27T16:30:00Z'), '28 Nov 2026')
  assert.equal(formatSingaporeDate('2026-11-27T15:59:00Z'), '27 Nov 2026')
  for (const file of ['lib/server/facts/free-evaluation-pdf.ts', 'lib/server/facts/bank-pack-pdf.ts', 'lib/server/facts/fidrec-pack-pdf.ts']) assert.match(read(file), /formatSingaporeDate\(/, file)
  for (const file of ['components/state-machine/layer2/report-view.tsx', 'components/state-machine/layer3/fidrec-pack-view.tsx', 'components/state-machine/facts/confirm-facts-panel.tsx']) assert.match(read(file), /timeZone: 'Asia\/Singapore'/, file)
})

test('10.5: above 150 payments the person is told, and nothing is generated or cut', () => {
  assert.equal(MAX_PAYMENTS, 150)
  assert.equal(APPROVED.tooManyPayments, 'This case has more than 150 payments. Please email info@guidebuoyai.sg so we can help you with it.')
  const current = (n: number) => buildSnapshot([{ id: 'f', factKey: 'transactions', findingType: 'agreed', values: [{ value: Array.from({ length: n }, () => pay(1, 1)), sources: [] }], status: 'resolved', resolution: null }], 'free')
  assert.ok(!current(150).blocks.some((b) => b.reason === 'too_many_payments'))
  assert.ok(current(151).blocks.some((b) => b.reason === 'too_many_payments'))
  assert.equal((current(151).facts.transactions!.value as unknown[]).length, 151, 'nothing is cut')
  assert.match(read('lib/server/facts/facts-service.ts'), /APPROVED\.tooManyPayments/)
})
