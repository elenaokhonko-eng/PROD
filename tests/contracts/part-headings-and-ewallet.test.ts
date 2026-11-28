import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { answerCandidates, JOURNEY_KEYS, reconcile } from '../../lib/facts'
import { documentKind, headingLines, PART_PAYMENT_LINES, paymentRows, readDocumentParts, splitIntoParts } from '../../lib/server/facts/document-parts'

// 28 Nov 2026: the second part of a 150-payment statement came back almost empty. It had been sent as bare rows, with
// the bank's name and column titles left in part one. And one answer has room for about 120 payments. Synthetic only.

const row = (i: number) => `2026-10-01  Test payment ${String(i).padStart(4, '0')} to Sample Shop  10.25`
const heading = ['Synthetic Bank - Statement of account', 'Account ending 0000', 'Date  Description  Amount (S$)']
const statement = [...heading, ...Array.from({ length: 150 }, (_, i) => row(i + 1))].join('\n')

/** Records what each part was sent, and when it was sent against when part one came back. */
function reader(documentType: string) {
  const sent: string[] = []
  let firstAnswered = false
  const startedBeforeFirstAnswer: boolean[] = []
  const read = async (text: string) => {
    sent.push(text)
    const index = sent.length - 1
    if (index > 0) startedBeforeFirstAnswer.push(!firstAnswered)
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (index === 0) firstAnswered = true
    return { document_type: documentType }
  }
  return { sent, startedBeforeFirstAnswer, read }
}

test('a part holds at most 60 payment lines, and no line is lost or repeated', () => {
  assert.equal(PART_PAYMENT_LINES, 60)
  const parts = splitIntoParts(statement, 5_000, PART_PAYMENT_LINES)
  assert.deepEqual(parts.map(paymentRows), [60, 60, 30])
  assert.equal(parts.join('\n'), statement)
})

test('every later part carries the heading lines and says which part of what kind of document', async () => {
  const { sent, startedBeforeFirstAnswer, read } = reader('bank_statement')
  const { parts, answers } = await readDocumentParts(statement, 5_000, 4, read)
  assert.equal(parts.length, 3)
  assert.equal(answers.length, 3)
  assert.ok(sent[0].startsWith('This is part 1 of 3 of one document.'))
  for (const [n, text] of [[2, sent[1]], [3, sent[2]]] as const) {
    assert.ok(text.startsWith(`This is part ${n} of 3 of a bank statement.`), text.slice(0, 80))
    for (const line of heading) assert.ok(text.includes(line), line)
    assert.ok(text.endsWith(parts[n - 1]))
  }
  assert.equal(sent.join('\n').match(/Test payment \d{4}/g)?.length, 150, 'each payment is sent once')
  assert.deepEqual(startedBeforeFirstAnswer, [true, true], 'no part waits for another')
})

test('the kind comes from the file’s own heading, and a short file is sent as it is', async () => {
  assert.equal(documentKind('Synthetic Bank credit card statement'), 'a card statement')
  assert.equal(documentKind('Synthetic Bank\nStatement of account\nDebit card ending 0000'), 'a bank statement')
  assert.equal(documentKind('Date Description Withdrawal Deposit Balance'), 'a bank statement')
  assert.equal(documentKind('Singapore Police Force'), 'a police report')
  assert.equal(documentKind('Synthetic heading'), 'a document')
  const letter = Array.from({ length: 400 }, (_, i) => `Synthetic letter sentence number ${i}.`).join('\n')
  const long = reader('other')
  await readDocumentParts(letter, 5_000, 4, long.read)
  assert.ok(long.sent.length > 1)
  assert.ok(long.sent[1].startsWith(`This is part 2 of ${long.sent.length} of a document.`))
  const short = reader('bank_statement')
  await readDocumentParts(heading.join('\n'), 5_000, 4, short.read)
  assert.deepEqual(short.sent, [heading.join('\n')])
})

test('the heading lines never repeat a payment, and keep the column titles below a dated line', () => {
  assert.equal(headingLines(statement), heading.join('\n'))
  const withDatedTop = ['Synthetic Bank', 'Statement date 31/10/2026 limit 5,000.00', 'Date  Description  Amount', row(1), row(2)].join('\n')
  assert.equal(headingLines(withDatedTop), 'Synthetic Bank\nDate  Description  Amount')
})

test('the reading uses the parts reader and still checks each part against its own lines', () => {
  const runner = readFileSync('lib/server/facts/run-reconcile.ts', 'utf8')
  assert.match(runner, /readDocumentParts\(source\.text, DOCUMENT_PART_CHARS, MODEL_CONCURRENCY/)
  assert.match(runner, /parseFactExtraction\(\{ \.\.\.raw, document_type: kind \}, parts\[i\]/)
  assert.match(runner, /if \(paymentsLost\(parts\[i\], listed\)\) throw/)
})

// E-wallet wording approved by Elena, 28 Nov 2026. The old choice only said an e-wallet was involved, so an old tick
// must not turn into "money was taken from it".
const ticked = (value: string) => [{ questionKey: JOURNEY_KEYS.institutionTypes, value, revisionId: 'w1' }]
const accounts = (value: string) => answerCandidates(ticked(value)).candidates.filter((c) => c.factKey === 'account_types')

test('the new e-wallet choice records an account the money was taken from', async () => {
  assert.deepEqual(accounts('bank,ewallet_source').map((c) => c.value), [['ewallet']])
  const found = (await reconcile(answerCandidates(ticked('ewallet_source')).candidates)).find((f) => f.factKey === 'account_types')!
  assert.equal(found.findingType, 'agreed')
  const form = readFileSync('components/state-machine/facts/journey-questions.tsx', 'utf8')
  assert.ok(form.includes("{ value: 'ewallet_source', label: 'An e-wallet or payment app (money was taken from it)' }"))
})

test('an answer saved under the old wording says nothing about where the money came from', () => {
  for (const value of ['ewallet', 'bank,ewallet,telco', 'bank', 'other']) assert.deepEqual(accounts(value), [], value)
})
