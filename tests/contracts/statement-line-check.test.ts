import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatementChecks } from '../../components/state-machine/facts/statement-checks'
import { statementLinesSentence } from '../../lib/journey/statement-lines'
import { statementChecks } from '../../lib/server/facts/document-parts'

// The test runner compiles components to React.createElement, so React must be in scope when they render.
Object.assign(globalThis, { React })
const { createElement } = React

// Elena, 28 Nov 2026, item 3: for each statement the confirm screen shows how many lines hold a date and an amount and
// how many payments were read, above the table of those payments. It never stops. Synthetic content only.

const lines = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-01  Test payment ${i} to Sample Shop  10.25`).join('\n')
const payment = (i: number) => ({ date: '2026-10-01', amount: { amount: 10.25, currency: 'SGD', amountSgd: 10.25 }, channel: null, payee: `Sample Shop ${i}`, last4: null, instrument: 'account_transfer' as const })
const doc = (key: string, text: string) => ({ sourceKey: key, name: `${key}.pdf`, text })
const read = (key: string, count: number, documentType = 'bank_statement') => ({
  fact_key: 'transactions',
  value: Array.from({ length: count }, (_, i) => payment(i)),
  source_ref: { sourceKey: key, documentType },
})

test('the approved sentence, with the counted numbers', () => {
  assert.equal(statementLinesSentence(59, 41), 'This statement has 59 lines with a date and an amount. 41 payments were read from it. Please check the table below.')
  assert.equal(statementLinesSentence(1, 1), 'This statement has 1 line with a date and an amount. 1 payment was read from it. Please check the table below.')
  assert.equal(statementLinesSentence(12, 0), 'This statement has 12 lines with a date and an amount. 0 payments were read from it. Please check the table below.')
})

test('each statement is counted on its own, whether or not the numbers differ', () => {
  const checks = statementChecks(
    [doc('bank', lines(5)), doc('card', lines(3))],
    [read('bank', 4), read('card', 3, 'card_statement')],
  )
  assert.deepEqual(checks.map((c) => [c.name, c.lines, c.payments.length]), [['bank.pdf', 5, 4], ['card.pdf', 3, 3]])
})

test('a statement that gave no payments, or nothing at all, still shows its lines', () => {
  const noPayments = statementChecks([doc('a', lines(6))], [{ fact_key: 'institution_names', value: [], source_ref: { sourceKey: 'a', documentType: 'bank_statement' } }])
  assert.deepEqual(noPayments.map((c) => [c.lines, c.payments.length]), [[6, 0]])
  const nothing = statementChecks([doc('b', lines(6))], [{ fact_key: '_source_scanned', value: {}, source_ref: { sourceKey: 'b' } }])
  assert.deepEqual(nothing.map((c) => [c.lines, c.payments.length]), [[6, 0]])
})

test('letters, police reports and files with nothing to count are not called statements', () => {
  assert.deepEqual(statementChecks([doc('p', lines(4))], [read('p', 2, 'police_report')]), [])
  assert.deepEqual(statementChecks([doc('l', 'A letter with no payment lines.')], [{ fact_key: '_source_scanned', value: {}, source_ref: { sourceKey: 'l' } }]), [])
  assert.deepEqual(statementChecks([doc('s', 'A statement with no entries.')], [read('s', 0)]), [])
})

test('the screen shows the file, the sentence and then the payments read from that file', () => {
  const html = renderToStaticMarkup(createElement(StatementChecks, { statements: [{ name: 'synthetic-statement.pdf', lines: 3, payments: [payment(1), payment(2)] }] }))
  const sentence = 'This statement has 3 lines with a date and an amount. 2 payments were read from it. Please check the table below.'
  assert.ok(html.indexOf('synthetic-statement.pdf') < html.indexOf(sentence))
  assert.ok(html.indexOf(sentence) < html.indexOf('data-payments-table'))
  assert.equal(html.match(/<tr/g)?.length, 3, 'a header row and the two payments')
  assert.equal(renderToStaticMarkup(createElement(StatementChecks, { statements: [] })), '')
})

test('the confirm screen gets the counts, they block nothing, and the loss guard stays', () => {
  const service = readFileSync('lib/server/facts/facts-service.ts', 'utf8')
  assert.match(service, /statements: statementChecks\(documents, candidates \?\? \[\]\)/)
  const panel = readFileSync('components/state-machine/facts/confirm-facts-panel.tsx', 'utf8')
  assert.match(panel, /<StatementChecks statements=\{view\.statements\} \/>/)
  assert.match(panel, /const canContinue = view\.openCount === 0 && view\.documentsProcessing === 0 && view\.consistencyIssues\.length === 0\r?\n/)
  assert.match(readFileSync('lib/server/facts/run-reconcile.ts', 'utf8'), /if \(paymentsLost\(parts\[i\], listed\)\) throw/)
})
