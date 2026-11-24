import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildFactExtractionPrompt,
  type CurrentFinding,
  creditBureauReportSource,
  CREDIT_BUREAU_REPORT_SUGGESTION,
  DOCUMENT_LABELS,
  DOCUMENT_TYPES,
  type FactCandidate,
  FACT_LABELS,
  formatFactValue,
  PAID_STAGE_ONLY_FACT_KEYS,
  parseFactExtraction,
  reconcile,
  type ReconciledFinding,
  requiredFactsFor,
  suggestsCreditBureauReport,
} from '../../lib/facts'
import { findingsForStage, stageSnapshot } from '../../lib/server/facts/facts-service'

// FIDReC update, Lane 2: the EUPG Section 8 facts and the optional credit bureau report (review of 24 November,
// decision 8). Synthetic documents only: "Example Bank A", "Example Credit Bureau", invented amounts and dates.

const SECTION8_KEYS = ['disputed_amount_payment_requests', 'charges_on_disputed_amount', 'credit_bureau_reports', 'fidrec_dispute_dates'] as const

const doc = (id: string) => ({ sourceType: 'document' as const, sourceRef: { sourceKey: `document:${id}`, documentId: id } })
const storySource = { sourceType: 'story' as const, sourceRef: { sourceKey: 'story:r1' } }
const byKey = (candidates: FactCandidate[], key: string) => candidates.filter((c) => c.factKey === key)
const read = (path: string) => readFileSync(path, 'utf8')

const cardStatement = [
  'EXAMPLE BANK A - CREDIT CARD STATEMENT (SYNTHETIC)',
  'Statement date 15 Aug 2025. Payment due date 05 Sep 2025.',
  '03 Jul 2025  EXAMPLE MERCHANT ONE (DISPUTED)  7,550.00',
  '15 Aug 2025  LATE PAYMENT CHARGE  100.00',
  '15 Aug 2025  FINANCE CHARGE ON DISPUTED AMOUNT  202.35',
  'Minimum payment due 7,852.35 by 05 Sep 2025',
].join('\n')

const statementOutput = {
  document_type: 'card_statement',
  disputed_amount_payment_requests: [
    { date: '2025-08-15', source: 'statement', amount: 7852.35, currency: 'SGD', quote: 'Minimum payment due 7,852.35 by 05 Sep 2025', confidence: 0.9 },
  ],
  charges_on_disputed_amount: [
    { date: '2025-08-15', kind: 'late_fee', amount: 100, currency: 'SGD', description: 'Late payment charge', quote: '15 Aug 2025  LATE PAYMENT CHARGE  100.00', confidence: 0.9 },
    { date: '2025-08-15', kind: 'interest', amount: 202.35, currency: 'SGD', description: null, quote: '15 Aug 2025  FINANCE CHARGE ON DISPUTED AMOUNT  202.35', confidence: 0.9 },
    // Not in the document: dropped.
    { date: '2025-08-15', kind: 'other', amount: 50, currency: 'SGD', description: null, quote: 'ANNUAL FEE 50.00', confidence: 0.9 },
  ],
}

const letter = [
  'Example Bank A (synthetic letter), 20 Sep 2025.',
  'We reported the unpaid balance to Example Credit Bureau on 10 Sep 2025.',
  'We were informed on 18 Sep 2025 that you have filed a dispute with FIDReC on 16 Sep 2025.',
].join('\n')

const letterOutput = {
  document_type: 'bank_correspondence',
  credit_bureau_reports: [{ date: '2025-09-10', bureau: 'Example Credit Bureau', quote: 'We reported the unpaid balance to Example Credit Bureau on 10 Sep 2025.', confidence: 0.9 }],
  fidrec_dispute_dates: {
    started: '2025-09-16',
    institution_informed: '2025-09-18',
    completed_or_closed: null,
    quote: 'We were informed on 18 Sep 2025 that you have filed a dispute with FIDReC on 16 Sep 2025.',
    confidence: 0.9,
  },
}

const story = 'My bank kept charging me late fees. They reported me to the credit bureau in September 2025 and my credit score dropped.'
const storyOutput = {
  credit_bureau_reports: [{ date: null, bureau: null, quote: 'They reported me to the credit bureau in September 2025' }],
  charges_on_disputed_amount: [{ date: null, kind: 'late_fee', amount: 100, currency: 'SGD', quote: 'My bank kept charging me late fees.' }],
}

test('credit_bureau_report is an optional document type: labelled, never part of the evidence check', () => {
  assert.ok((DOCUMENT_TYPES as readonly string[]).includes('credit_bureau_report'))
  assert.ok(DOCUMENT_LABELS.credit_bureau_report)
  assert.doesNotMatch(read('supabase/functions/_shared/evidence-minimums.ts'), /credit_bureau|CREDIT_BUREAU/)
  const classifier = read('supabase/functions/evidence_processed_v2/index.ts')
  assert.match(classifier, /"CREDIT_BUREAU_REPORT"/)
  const critical = /const critical = \[([\s\S]*?)\]/.exec(classifier)?.[1] ?? ''
  assert.doesNotMatch(critical, /CREDIT_BUREAU_REPORT/)
  // A suggestion for credit card cases only.
  assert.ok(CREDIT_BUREAU_REPORT_SUGGESTION.includes('optional'))
  assert.equal(suggestsCreditBureauReport(['credit_card']), true)
  assert.equal(suggestsCreditBureauReport(['savings_or_current', 'debit_card']), false)
  assert.equal(suggestsCreditBureauReport(null), false)
})

test('the prompt asks every source for credit bureau reports and FIDReC dates, and only documents for requests and charges', () => {
  const docPrompt = buildFactExtractionPrompt('document', 'x')
  const storyPrompt = buildFactExtractionPrompt('story', 'x')
  for (const key of SECTION8_KEYS) assert.match(docPrompt, new RegExp(key))
  assert.match(storyPrompt, /credit_bureau_reports/)
  assert.match(storyPrompt, /fidrec_dispute_dates/)
  assert.doesNotMatch(storyPrompt, /"disputed_amount_payment_requests"|"charges_on_disputed_amount"/)
})

test('a statement yields the requests to pay and the charges, each with its own quoted words', () => {
  const candidates = parseFactExtraction(statementOutput, cardStatement, doc('s1'))
  const [requests] = byKey(candidates, 'disputed_amount_payment_requests')
  assert.deepEqual(requests.value, [{ date: '2025-08-15', amount: { amount: 7852.35, currency: 'SGD', amountSgd: 7852.35 }, source: 'statement' }])
  assert.equal(requests.sourceRef.context, false)
  const [charges] = byKey(candidates, 'charges_on_disputed_amount')
  assert.deepEqual((charges.value as Array<{ kind: string; amount: { amount: number } }>).map((c) => [c.kind, c.amount.amount]), [['late_fee', 100], ['interest', 202.35]])
  assert.equal((charges.sourceRef.quotes as string[]).length, 2)
})

test("a letter's credit bureau report is labelled as the institution's; FIDReC dates are read from the letter", () => {
  const candidates = parseFactExtraction(letterOutput, letter, doc('l1'))
  const [reports] = byKey(candidates, 'credit_bureau_reports')
  assert.deepEqual(reports.value, [{ date: '2025-09-10', bureau: 'Example Credit Bureau', source: 'institution_letter' }])
  const [dates] = byKey(candidates, 'fidrec_dispute_dates')
  assert.deepEqual(dates.value, { startedOn: '2025-09-16', institutionToldOn: '2025-09-18', completedOrClosedOn: null })
  assert.equal(dates.sourceRef.context, false)
})

test("the complainant's own statement is labelled as such; a story cannot state charges or requests", () => {
  const candidates = parseFactExtraction(storyOutput, story, storySource)
  const [reports] = byKey(candidates, 'credit_bureau_reports')
  assert.deepEqual(reports.value, [{ date: null, bureau: null, source: 'complainant_statement' }])
  assert.equal(byKey(candidates, 'charges_on_disputed_amount').length, 0)
  assert.equal(creditBureauReportSource('document', 'credit_bureau_report'), 'credit_bureau_report')
  assert.equal(creditBureauReportSource('document', 'bank_correspondence'), 'institution_letter')
  assert.equal(creditBureauReportSource('answer', null), 'complainant_statement')
})

test('a credit bureau report document states the reports; it cannot state charges', () => {
  // The report line names the disputed transaction (a bureau line must, since the follow-ups on #81).
  const text = 'EXAMPLE CREDIT BUREAU - CREDIT REPORT (SYNTHETIC)\n2025-09-10 Example Bank A reported default: 7,550.00 (disputed transaction)'
  const candidates = parseFactExtraction({
    document_type: 'credit_bureau_report',
    credit_bureau_reports: [{ date: '2025-09-10', bureau: 'Example Credit Bureau', quote: '2025-09-10 Example Bank A reported default: 7,550.00 (disputed transaction)', confidence: 0.9 }],
    charges_on_disputed_amount: [{ date: '2025-09-10', kind: 'other', amount: 7550, currency: 'SGD', quote: '2025-09-10 Example Bank A reported default: 7,550.00 (disputed transaction)', confidence: 0.9 }],
  }, text, doc('c1'))
  const [reports] = byKey(candidates, 'credit_bureau_reports')
  assert.equal((reports.value as unknown as Array<{ source: string }>)[0].source, 'credit_bureau_report')
  assert.equal(reports.sourceRef.context, false)
  // Charges are read from statements only: here it is kept as context, never compared.
  assert.equal(byKey(candidates, 'charges_on_disputed_amount')[0].sourceRef.context, true)
})

const stated = (factKey: string, value: unknown, documentType: string, id: string): FactCandidate =>
  ({ factKey, value, sourceType: 'document', sourceRef: { sourceKey: `document:${id}`, documentId: id, documentType, confidence: 0.9, context: false } }) as FactCandidate
const told = (factKey: string, value: unknown): FactCandidate => ({ factKey, value, sourceType: 'story', sourceRef: { sourceKey: 'story:r1' } }) as FactCandidate
const find = (findings: ReconciledFinding[], key: string) => findings.find((f) => f.factKey === key)
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })

test('two statements combine their charges; a letter and the complainant each keep their own labelled report', async () => {
  const findings = await reconcile([
    stated('charges_on_disputed_amount', [{ date: '2025-08-15', amount: sgd(100), kind: 'late_fee', description: null, relatedTransactionIndex: null }], 'card_statement', 's1'),
    stated('charges_on_disputed_amount', [{ date: '2025-09-15', amount: sgd(100), kind: 'late_fee', description: null, relatedTransactionIndex: null }], 'card_statement', 's2'),
    stated('credit_bureau_reports', [{ date: '2025-09-10', bureau: 'Example Credit Bureau', source: 'institution_letter' }], 'bank_correspondence', 'l1'),
    told('credit_bureau_reports', [{ date: null, bureau: null, source: 'complainant_statement' }]),
  ])
  const charges = find(findings, 'charges_on_disputed_amount')!
  assert.equal(charges.findingType, 'agreed')
  assert.deepEqual((charges.values[0].value as Array<{ date: string }>).map((c) => c.date), ['2025-08-15', '2025-09-15'])
  const reports = find(findings, 'credit_bureau_reports')!
  assert.equal(reports.findingType, 'agreed')
  assert.deepEqual((reports.values[0].value as Array<{ source: string }>).map((r) => r.source).sort(), ['complainant_statement', 'institution_letter'])
})

test('only a document states requests and charges; FIDReC dates that differ are a conflict', async () => {
  const findings = await reconcile([
    told('charges_on_disputed_amount', [{ date: null, amount: sgd(100), kind: 'late_fee', description: null, relatedTransactionIndex: null }]),
    stated('fidrec_dispute_dates', { startedOn: '2025-09-16', institutionToldOn: null, completedOrClosedOn: null }, 'bank_correspondence', 'l1'),
    told('fidrec_dispute_dates', { startedOn: '2025-10-30', institutionToldOn: null, completedOrClosedOn: null }),
  ])
  assert.equal(find(findings, 'charges_on_disputed_amount'), undefined)
  assert.equal(find(findings, 'fidrec_dispute_dates')!.findingType, 'conflict')
})

test('a case with no Section 8 source gets no Section 8 finding, so nothing new is asked', async () => {
  const findings = await reconcile([told('reported_to_bank', { value: 'yes', date: '2025-07-03', reference: null, channel: null })])
  for (const key of SECTION8_KEYS) assert.equal(find(findings, key), undefined, key)
})

test('the Section 8 facts are kept out of the free stage and are never required', async () => {
  for (const key of SECTION8_KEYS) {
    assert.ok(PAID_STAGE_ONLY_FACT_KEYS.has(key), key)
    for (const stage of ['free', 'bank', 'fidrec'] as const) assert.ok(!requiredFactsFor(stage, null).includes(key), `${stage} ${key}`)
    assert.ok(FACT_LABELS[key])
  }
  const findings: CurrentFinding[] = (await reconcile([
    stated('credit_bureau_reports', [{ date: '2025-09-10', bureau: null, source: 'institution_letter' }], 'bank_correspondence', 'l1'),
  ])).map((f, i) => ({ id: `f${i}`, factKey: f.factKey, findingType: f.findingType, values: f.values, valuesHash: f.valuesHash, status: 'open', resolution: null }) as unknown as CurrentFinding)
  assert.equal(findingsForStage(findings, 'free').some((f) => f.factKey === 'credit_bureau_reports'), false)
  assert.equal(stageSnapshot(findings, 'free').facts.credit_bureau_reports, undefined)
  assert.equal(findingsForStage(findings, 'fidrec').some((f) => f.factKey === 'credit_bureau_reports'), true)
})

test('display: dates, amounts and who states a report', () => {
  assert.equal(
    formatFactValue('charges_on_disputed_amount', [{ date: '2025-08-15', amount: sgd(100), kind: 'late_fee', description: null, relatedTransactionIndex: null }]),
    'S$100 late fee, 15 Aug 2025',
  )
  assert.equal(
    formatFactValue('credit_bureau_reports', [{ date: null, bureau: null, source: 'complainant_statement' }]),
    'Date not given (your own statement)',
  )
  assert.equal(
    formatFactValue('fidrec_dispute_dates', { startedOn: '2025-09-16', institutionToldOn: '2025-09-18', completedOrClosedOn: null }),
    'Started 16 Sep 2025; bank told 18 Sep 2025',
  )
  assert.equal(
    formatFactValue('disputed_amount_payment_requests', [{ date: '2025-08-15', amount: sgd(7852.35), source: 'statement' }]),
    '15 Aug 2025, on a statement, S$7,852.35',
  )
})
