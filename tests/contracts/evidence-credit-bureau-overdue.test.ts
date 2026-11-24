import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { buildFactExtractionPrompt, type FactCandidate, namesDisputedAmountReport, parseFactExtraction, reconcile } from '../../lib/facts'
import {
  buildDisputeChargesChecks,
  SECTION_8_CLAUSES,
  SECTION_8_FROM,
} from '../../supabase/functions/_shared/facts/rules/dispute-charges-checks.ts'
import {
  CLAUSE_KEYS,
  type ComparisonLine,
  createFakeClauseProvider,
  type FakeCorpus,
  type SectionResult,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { cardOnlyCase, type CaseSectionData, syntheticCorpus } from '../fixtures/fidrec-update/index.ts'
import {
  BALANCE_LINE,
  CREDIT_BUREAU_OVERDUE_TEXT,
  DISPUTED_AMOUNT_REPORTED_LINE,
  MODEL_OUTPUT_AS_PROMPTED,
  MODEL_OUTPUT_OVER_READ,
  OVERDUE_LINE,
} from '../fixtures/evidence/credit-bureau-overdue.ts'

// Review follow-up (24 Nov 2026, #81): a credit bureau report that shows the card account 30 days overdue without naming
// a transaction or a dispute. What the extraction keeps, and what the Section 8 check then prints for 8.3 and 8.4(a).
// Synthetic data only.

const doc = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:cb-1', documentId: 'cb-1' } }
const byKey = (candidates: FactCandidate[], key: string) => candidates.filter((c) => c.factKey === key)
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

// Synthetic 8.4 text in the structure of the loaded paragraph (as in dispute-charges-checks.test.ts): 8.4(a) states its
// period, so 8.4(a) prints as a row. Not the EUPG's wording.
const TEXT_8_4 = 'Synthetic 8.4: during the following periods: (a) from the investigation up to 30 calendar days after the outcome is given; and (b) after FIDReC completes or closes the case.'

function corpusWithSection8(): FakeCorpus {
  const corpus: FakeCorpus = structuredClone(syntheticCorpus)
  for (const v of corpus.versions.filter((x) => x.document_key === 'mas.eupg' && x.status === 'verified')) {
    for (const key of CLAUSE_KEYS.disputed_amount_charges) {
      const text = key === SECTION_8_CLAUSES.p8_4 ? TEXT_8_4 : `Placeholder text of ${key}.`
      v.clauses.push({ clause_id: `t-${v.version_id}-${key}`, clause_key: key, clause_ref: key.split('/')[1], text_content: text, text_sha256: sha(text), ...(v.effective_from < SECTION_8_FROM ? { effective_from_override: SECTION_8_FROM } : {}) })
    }
  }
  return corpus
}
const provider = createFakeClauseProvider(corpusWithSection8())
const comparisons = (r: SectionResult): ComparisonLine[] => r.lines.flatMap((l) => (l.kind === 'comparison' ? [l.comparison] : []))
const row = (r: SectionResult, key: string) => comparisons(r).filter((c) => c.clauseKey === key)

/** The synthetic card-only case (credit card; reported 13 Sep 2025; final reply 20 Oct 2025) with this report's facts. */
function caseWith(reports: unknown[] | undefined): CaseSectionData {
  const d: CaseSectionData = structuredClone(cardOnlyCase.data)
  delete d.facts.credit_bureau_reports
  if (reports) d.facts.credit_bureau_reports = { label: 'confirmed', value: reports as never }
  return d
}

const NOT_SHOWN = /do not show whether non-payment of the disputed amount was reported to a credit bureau/

test('as prompted: an overdue status with no dispute named gives no credit bureau report entry, so no fact', async () => {
  const candidates = parseFactExtraction(MODEL_OUTPUT_AS_PROMPTED, CREDIT_BUREAU_OVERDUE_TEXT, doc)
  assert.deepEqual(candidates, [])
  // With nothing extracted there is no finding, so the snapshot holds no credit_bureau_reports fact at all.
  const findings = await reconcile(candidates)
  assert.equal(findings.some((f) => f.factKey === 'credit_bureau_reports'), false)
})

test('with no fact: 8.3 and 8.4(a) print not_shown, never matches', async () => {
  const r = await buildDisputeChargesChecks({ ...caseWith(undefined), provider })
  const [p83] = row(r, SECTION_8_CLAUSES.p8_3)
  assert.equal(p83.outcome, 'not_shown')
  assert.match(p83.record ?? '', NOT_SHOWN)
  const [p84] = row(r, SECTION_8_CLAUSES.p8_4)
  assert.equal(p84.outcome, 'not_shown')
  // 8.4(a)'s period: the final reply of 20 Oct 2025 plus 30 calendar days.
  assert.match(p84.record ?? '', /The period after the reply runs from 20 October 2025 to 19 November 2025\./)
  assert.match(p84.record ?? '', NOT_SHOWN)
})

test('over-read: an entry quoting only the overdue status line is dropped, so 8.3 and 8.4(a) print not_shown', async () => {
  // The overdue line is in the document word for word, so it passes the quote check; it names no dispute and no
  // disputed transaction, so the entry is dropped.
  const candidates = parseFactExtraction(MODEL_OUTPUT_OVER_READ, CREDIT_BUREAU_OVERDUE_TEXT, doc)
  assert.deepEqual(byKey(candidates, 'credit_bureau_reports'), [])
  assert.equal(namesDisputedAmountReport(OVERDUE_LINE, 'credit_bureau_report'), false)
})

test("the bureau's balance line is dropped even though its amount equals the disputed amount", () => {
  // 7,550.00 is the disputed amount of the synthetic card-only case; the line names no dispute or transaction.
  const candidates = parseFactExtraction({
    document_type: 'credit_bureau_report',
    credit_bureau_reports: [{ date: '2025-10-15', bureau: 'Example Credit Information Bureau', quote: BALANCE_LINE, confidence: 0.8 }],
  }, CREDIT_BUREAU_OVERDUE_TEXT, doc)
  assert.deepEqual(byKey(candidates, 'credit_bureau_reports'), [])
  assert.equal(namesDisputedAmountReport(BALANCE_LINE, 'credit_bureau_report'), false)
})

test('the same document with a line that names the dispute keeps that entry; 8.3 then differs, 8.4(a) does not', async () => {
  const text = `${CREDIT_BUREAU_OVERDUE_TEXT}\n${DISPUTED_AMOUNT_REPORTED_LINE}`
  const candidates = parseFactExtraction({
    document_type: 'credit_bureau_report',
    credit_bureau_reports: [
      { date: '2025-10-15', bureau: 'Example Credit Information Bureau', quote: OVERDUE_LINE, confidence: 0.8 },
      { date: '2025-10-16', bureau: 'Example Credit Information Bureau', quote: DISPUTED_AMOUNT_REPORTED_LINE, confidence: 0.9 },
    ],
  }, text, doc)
  const [reports] = byKey(candidates, 'credit_bureau_reports')
  assert.deepEqual(reports.value, [{ date: '2025-10-16', bureau: 'Example Credit Information Bureau', source: 'credit_bureau_report' }])
  assert.deepEqual(reports.sourceRef.quotes, [DISPUTED_AMOUNT_REPORTED_LINE])
  const r = await buildDisputeChargesChecks({ ...caseWith(reports.value as unknown[]), provider })
  // 16 Oct 2025 is inside the investigation (13 Sep to 20 Oct 2025), before 8.4(a)'s period (20 Oct to 19 Nov 2025).
  assert.equal(row(r, SECTION_8_CLAUSES.p8_3)[0].outcome, 'differs')
  const [p84] = row(r, SECTION_8_CLAUSES.p8_4)
  assert.equal(p84.outcome, 'matches')
  assert.match(p84.record ?? '', /The records show no report of non-payment of the disputed amount to a credit bureau in that period\./)
})

test('which quoted words can stand for a report of the disputed amount, by who states it', () => {
  const cases: Array<[string, 'credit_bureau_report' | 'institution_letter' | 'complainant_statement', boolean]> = [
    // A credit bureau report: the dispute or the disputed transaction only.
    [DISPUTED_AMOUNT_REPORTED_LINE, 'credit_bureau_report', true],
    ['Account flagged: transaction under dispute with the lender', 'credit_bureau_report', true],
    [OVERDUE_LINE, 'credit_bureau_report', false],
    [BALANCE_LINE, 'credit_bureau_report', false],
    ['2025-09-10 Example Bank A reported default: 7,550.00', 'credit_bureau_report', false],
    ['EXAMPLE CREDIT INFORMATION BUREAU (SYNTHETIC) - CONSUMER CREDIT REPORT', 'credit_bureau_report', false],
    ['Account status: default', 'credit_bureau_report', false],
    // The institution's letter: also an amount the same words say was reported to a bureau.
    ['We reported the unpaid balance to Example Credit Bureau on 10 Sep 2025.', 'institution_letter', true],
    ['We reported S$7,550.00 to the credit bureau.', 'institution_letter', true],
    ['Chargeback pending on card ending 0001', 'institution_letter', true],
    ['The outstanding balance is 7,550.00.', 'institution_letter', false],
    ['We have reported the matter internally.', 'institution_letter', false],
    // The complainant's own statement: the reporting of an unpaid amount or to a bureau.
    ['They reported me to the credit bureau in September 2025', 'complainant_statement', true],
    ['The bank reported the unpaid amount', 'complainant_statement', true],
    ['My account is 30 days overdue', 'complainant_statement', false],
  ]
  for (const [quote, source, kept] of cases) assert.equal(namesDisputedAmountReport(quote, source), kept, `${source}: ${quote}`)
  assert.match(buildFactExtractionPrompt('document', 'x'), /in a credit bureau report: the dispute or the disputed\s+transaction itself; a balance alone is not enough/)
  assert.match(buildFactExtractionPrompt('document', 'x'), /A line that only gives an account's status \(overdue, in\s+arrears, default, days past due\) is not such a report/)
})
