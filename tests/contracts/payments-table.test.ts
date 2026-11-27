import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { evidenceLists, factsYouConfirmed, formatFactValue, parsePaymentsTable, paymentsTable, summariseTransactions, transactionRows } from '../../lib/facts'

// Elena, 27 Nov 2026: payments are shown in a table, like every case pack; everywhere else gives only how many there are
// and their total. Synthetic values only.
const read = (file: string) => readFileSync(file, 'utf8')
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const pay = (day: number, amount: number) => ({ date: `2026-10-${String(day).padStart(2, '0')}`, amount: sgd(amount), channel: null, payee: `Sample Shop ${day}`, last4: null, instrument: 'account_transfer' as const })
const all = [pay(1, 10.25), pay(2, 20.5), pay(3, 5000)]
const confirmed = <T>(value: T) => ({ value, label: 'confirmed' as const })
const finding = (values: unknown[][]) => [{
  factKey: 'transactions' as const,
  values: values.map((value, i) => ({ value, sources: [{ sourceType: 'document' as const, sourceRef: { documentId: `d${i}`, documentType: 'bank_statement' } }] })),
  resolution: { kind: 'choice' as const, index: 0 },
}]

test('a list of payments is summed up as a count and a total', () => {
  assert.equal(summariseTransactions(all), '3 payments, S$5,030.75 in total, 1 to 3 Oct 2026')
  assert.equal(summariseTransactions([pay(1, 10)]), '1 payment, S$10 in total, 1 Oct 2026')
  assert.equal(summariseTransactions([pay(1, 10), { ...pay(2, 5), amount: { amount: 5, currency: 'USD', amountSgd: null } }]), '2 payments, S$10 and USD 5 in total, 1 to 2 Oct 2026')
})

test('the facts and evidence lists never spell out each payment', () => {
  const facts = { transactions: confirmed(all) }
  const shown = evidenceLists(facts, finding([all]) as never).shown
  assert.deepEqual(shown, ['The payments you dispute: 3 payments, S$5,030.75 in total, 1 to 3 Oct 2026. Shown by your bank statement (uploaded).'])
  assert.equal(factsYouConfirmed(facts)[0].text, '3 payments, S$5,030.75 in total, 1 to 3 Oct 2026')
  // The model still receives every payment.
  assert.match(formatFactValue('transactions', all), /Sample Shop 1.*Sample Shop 3/)
})

test('a statement showing some of the confirmed payments does not contradict them', () => {
  const facts = { transactions: confirmed(all) }
  const part = evidenceLists(facts, finding([all, all.slice(0, 2)]) as never).shown
  assert.ok(!part.some((s) => s.startsWith('You confirmed')), part.join(' | '))
  const differs = evidenceLists(facts, finding([all, [pay(9, 99)]]) as never).shown
  assert.ok(differs.includes('You confirmed 3 payments, S$5,030.75 in total, 1 to 3 Oct 2026. Your bank statement (uploaded) shows 1 payment, S$99 in total, 9 Oct 2026.'), differs.join(' | '))
})

test('the table has every payment, and survives being stored', () => {
  const rows = transactionRows(all)
  assert.deepEqual(Object.keys(rows[0]), ['Date', 'Amount', 'Paid to', 'Method'])
  assert.equal(rows.length, 3)
  assert.deepEqual(parsePaymentsTable(paymentsTable({ transactions: confirmed(all) })!), rows)
  assert.equal(paymentsTable({}), null)
  assert.equal(parsePaymentsTable('not a table'), null)
})

test('every screen and PDF that shows payments shows them as a table', () => {
  assert.match(read('supabase/functions/bright-function/index.ts'), /narrative_type: "tier0_transactions"/)
  assert.match(read('components/state-machine/layer1/tier0-draft-view.tsx'), /<PaymentsTable/)
  assert.match(read('components/state-machine/layer3/fidrec-pack-view.tsx'), /<PaymentsTable/)
  assert.match(read('components/state-machine/facts/confirm-facts-panel.tsx'), /<PaymentsTable/)
  for (const file of ['lib/server/facts/free-evaluation-pdf.ts', 'lib/server/facts/bank-pack-pdf.ts', 'lib/server/facts/fidrec-pack-pdf.ts']) {
    assert.match(read(file), /builder\.addTable\(/, file)
  }
})
