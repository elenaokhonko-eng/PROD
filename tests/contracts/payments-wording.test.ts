import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { bankPackTimeline, buildTier0Input, fidrecChronology, summariseTransactions, tier0Checks, validateOutput, type SnapshotFacts } from '../../lib/facts'

// Wording approved by Elena, 27 Nov 2026: "[N] payments, S$[amount] in total, [first date] to [last date]", and the
// calculated total is given to the summary. Synthetic values only.
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const pay = (date: string | null) => ({ date, amount: sgd(10), channel: null, payee: 'Sample Shop', last4: null, instrument: 'account_transfer' as const })
const facts = { transactions: { value: [pay('2026-10-28'), pay('2026-10-01'), pay(null)], label: 'confirmed' } } as unknown as SnapshotFacts

test('the summary gives the count, the total and the dates the payments span', () => {
  assert.equal(summariseTransactions([pay('2026-10-28'), pay('2026-10-01')]), '2 payments, S$20 in total, 1 to 28 Oct 2026')
  assert.equal(summariseTransactions([pay('2026-09-30'), pay('2026-10-02')]), '2 payments, S$20 in total, 30 Sep to 2 Oct 2026')
  assert.equal(summariseTransactions([pay('2025-12-31'), pay('2026-01-02')]), '2 payments, S$20 in total, 31 Dec 2025 to 2 Jan 2026')
  assert.equal(summariseTransactions([pay('2026-10-03'), pay('2026-10-03')]), '2 payments, S$20 in total, 3 Oct 2026')
  assert.equal(summariseTransactions([pay(null), pay(null)]), '2 payments, S$20 in total')
})

test('a pack’s timeline has one line for several payments; each payment is in its table', () => {
  for (const timeline of [bankPackTimeline(facts), fidrecChronology(facts)]) {
    assert.deepEqual(timeline.map((i) => i.event), ['3 payments, S$30 in total, 1 to 28 Oct 2026'])
    assert.equal(timeline[0].date, undefined, 'the line states its own dates')
  }
  const one = bankPackTimeline({ transactions: { value: [pay('2026-10-01')], label: 'confirmed' } } as unknown as SnapshotFacts)
  assert.equal(one[0].event, 'Payment of S$10 to Sample Shop')
})

test('the model is given the calculated total, and may not say none is stated', () => {
  const input = buildTier0Input({ facts, findings: [], storyText: null, fidrecCheck: null })
  assert.equal(input.payments_summary, '3 payments, S$30 in total, 1 to 28 Oct 2026')
  const checks = tier0Checks(facts)
  for (const said of ['The records do not state a total loss.', 'Your documents show no total.', 'The statement does not give a total.']) {
    assert.ok(validateOutput([said], facts, { forbidden: checks.forbidden }).some((f) => f.check === 'forbidden'), said)
  }
  assert.ok(!(tier0Checks({}).forbidden ?? []).some((r) => r.pattern.test('The records do not state a total loss.')), 'without payments, it may be said')
  for (const file of ['tier0.ts', 'bank-pack.ts', 'fidrec-pack.ts']) {
    assert.match(readFileSync(`supabase/functions/_shared/facts/${file}`, 'utf8'), /payments_summary/, file)
  }
  assert.match(readFileSync('supabase/functions/bright-function/index.ts', 'utf8'), /tier0Checks\(facts\)/)
})
