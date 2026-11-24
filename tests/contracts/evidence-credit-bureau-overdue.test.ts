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
  CREDIT_BUREAU_OVERDUE_TEXT,
  DISPUTED_AMOUNT_REPORTED_LINE,
  MODEL_OUTPUT_AS_PROMPTED,
  MODEL_OUTPUT_OVER_READ,
  OVERDUE_LINE,
} from '../fixtures/evidence/credit-bureau-overdue.ts'

// Review follow-up (24 Nov 2026): a credit bureau report that shows the card account 30 days overdue without naming a
// transaction or a dispute. What the extraction keeps, and what the Section 8 check then prints for 8.3 and 8.4.
// Synthetic data only.

const doc = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:cb-1', documentId: 'cb-1' } }
const byKey = (candidates: FactCandidate[], key: string) => candidates.filter((c) => c.factKey === key)
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function corpusWithSection8(): FakeCorpus {
  const corpus: FakeCorpus = structuredClone(syntheticCorpus)
  for (const v of corpus.versions.filter((x) => x.document_key === 'mas.eupg' && x.status === 'verified')) {
    for (const key of CLAUSE_KEYS.disputed_amount_charges) {
      v.clauses.push({ clause_id: `t-${v.version_id}-${key}`, clause_key: key, clause_ref: key.split('/')[1], text_content: `Placeholder text of ${key}.`, text_sha256: sha(key), ...(v.effective_from < SECTION_8_FROM ? { effective_from_override: SECTION_8_FROM } : {}) })
    }
  }
  return corpus
}
const provider = createFakeClauseProvider(corpusWithSection8())
const comparisons = (r: SectionResult): ComparisonLine[] => r.lines.flatMap((l) => (l.kind === 'comparison' ? [l.comparison] : []))

/** The synthetic card-only case (credit card; reported 13 Sep 2025; final reply 20 Oct 2025) with this report's facts. */
function caseWith(reports: unknown[] | undefined): CaseSectionData {
  const d: CaseSectionData = structuredClone(cardOnlyCase.data)
  delete d.facts.credit_bureau_reports
  if (reports) d.facts.credit_bureau_reports = { label: 'confirmed', value: reports as never }
  return d
}

test('as prompted: an overdue status with no dispute named gives no credit bureau report entry, so no fact', async () => {
  const candidates = parseFactExtraction(MODEL_OUTPUT_AS_PROMPTED, CREDIT_BUREAU_OVERDUE_TEXT, doc)
  assert.deepEqual(candidates, [])
  // With nothing extracted there is no finding, so the snapshot holds no credit_bureau_reports fact at all.
  const findings = await reconcile(candidates)
  assert.equal(findings.some((f) => f.factKey === 'credit_bureau_reports'), false)
})

test('as prompted: 8.3 prints not_shown, never matches; 8.4 does not print yet', async () => {
  const r = await buildDisputeChargesChecks({ ...caseWith(undefined), provider })
  const p83 = comparisons(r).filter((c) => c.clauseKey === SECTION_8_CLAUSES.p8_3)
  assert.equal(p83.length, 1)
  assert.equal(p83[0].outcome, 'not_shown')
  assert.match(p83[0].record ?? '', /do not show whether non-payment of the disputed amount was reported to a credit bureau/)
  assert.equal(comparisons(r).some((c) => c.clauseKey === SECTION_8_CLAUSES.p8_4), false)
})

test('over-read: an entry quoting only the overdue status line is dropped, so 8.3 prints not_shown, not differs', async () => {
  // The overdue line is in the document word for word, so it passes the quote check; it names no disputed transaction,
  // amount, dispute or reporting, so the entry is dropped (review follow-up on #81).
  const candidates = parseFactExtraction(MODEL_OUTPUT_OVER_READ, CREDIT_BUREAU_OVERDUE_TEXT, doc)
  assert.deepEqual(byKey(candidates, 'credit_bureau_reports'), [])
  assert.equal(namesDisputedAmountReport(OVERDUE_LINE), false)
  const r = await buildDisputeChargesChecks({ ...caseWith(undefined), provider })
  const [p83] = comparisons(r).filter((c) => c.clauseKey === SECTION_8_CLAUSES.p8_3)
  assert.equal(p83.outcome, 'not_shown')
  assert.equal(comparisons(r).some((c) => c.clauseKey === SECTION_8_CLAUSES.p8_4), false)
})

test('the same document with a line that names the disputed amount being reported keeps that entry', async () => {
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
  const [p83] = comparisons(r).filter((c) => c.clauseKey === SECTION_8_CLAUSES.p8_3)
  assert.equal(p83.outcome, 'differs')
})

test('which quoted words can stand for a report of the disputed amount', () => {
  const kept = [
    DISPUTED_AMOUNT_REPORTED_LINE,
    'We reported the unpaid balance to Example Credit Bureau on 10 Sep 2025.',
    'They reported me to the credit bureau in September 2025',
    '2025-09-10 Example Bank A reported default: 7,550.00',
    'Account flagged: transaction under dispute with the lender',
    'Chargeback pending on card ending 0001',
  ]
  const dropped = [
    OVERDUE_LINE,
    'EXAMPLE CREDIT INFORMATION BUREAU (SYNTHETIC) - CONSUMER CREDIT REPORT',
    'Balance as at 15 Oct 2025: 7,550.00',
    '12-month payment history: 0 0 0 0 0 0 0 0 0 0 0 1',
    'Account status: default',
    'In arrears since Oct 2025',
  ]
  for (const q of kept) assert.equal(namesDisputedAmountReport(q), true, q)
  for (const q of dropped) assert.equal(namesDisputedAmountReport(q), false, q)
  // The prompt says the same.
  assert.match(buildFactExtractionPrompt('document', 'x'), /A line that only gives an account's status \(overdue, in\s+arrears, default, days past due\) is not such a report/)
})
