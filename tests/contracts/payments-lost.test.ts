import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { paymentsLost, paymentRows } from '../../lib/server/facts/document-parts'

// Elena's test of 28 Nov: the second part of a statement gave no payments, and the evaluation showed 91 of 150 with
// nothing said. A part full of payment lines that yields almost none is a failed reading. Synthetic.
const rows = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-01  Test payment ${i} to Sample Shop  10.25`).join('\n')

test('payment lines are the lines holding a date and an amount', () => {
  assert.equal(paymentRows(rows(59)), 59)
  assert.equal(paymentRows('01 Oct 2026  Sample  1,200.00  88,800.00\n02/10/2026 Sample 5.00\nStatement for October 2026\nTotal 7,372.50'), 2)
})

test('a part that yields almost none of its payment lines has lost them', () => {
  assert.equal(paymentsLost(rows(59), 0), true)
  assert.equal(paymentsLost(rows(59), 10), true)
  assert.equal(paymentsLost(rows(59), 59), false)
  assert.equal(paymentsLost(rows(40), 12), false, 'deposits and balances are not payments')
  assert.equal(paymentsLost(rows(9), 0), false, 'too few lines to judge')
  assert.equal(paymentsLost('A letter from the bank with no payment lines.', 0), false)
  const runner = readFileSync('lib/server/facts/run-reconcile.ts', 'utf8')
  assert.match(runner, /if \(paymentsLost\(parts\[i\], listed\)\) throw new FactsUnavailableError/)
  assert.match(runner, /part \$\{i \+ 1\} of \$\{parts\.length\}: \$\{paymentRows\(parts\[i\]\)\} payment lines, \$\{listed\} payments/)
})
