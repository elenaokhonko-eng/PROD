import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { type FactCandidate, parseFactExtraction } from '../../lib/facts'
import {
  createDisputeChargesChecks,
  SECTION_8_CLAUSES,
  SECTION_8_FROM,
} from '../../supabase/functions/_shared/facts/rules/dispute-charges-checks.ts'
import {
  CLAUSE_KEYS,
  type ComparisonLine,
  createFakeClauseProvider,
  type CreditAccountStatus,
  creditRecordsReading,
  type FakeCorpus,
  type SectionResult,
  showsGoodStanding,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { cardOnlyCase, type CaseSectionData, syntheticCorpus } from '../fixtures/fidrec-update/index.ts'
import {
  CBS_LAYOUT_CELLS,
  CBS_LAYOUT_REPORT_DATE_LINE,
  CBS_LAYOUT_ROWS,
  CBS_LAYOUT_TEXT,
} from '../fixtures/evidence/credit-bureau-cbs-layout.ts'

// A synthetic report in the Credit Bureau Singapore "Account Status History" layout (review of 25 Nov 2026, gap c):
// one row per account, with codes and an overdue balance but no status words, no per-row dates and no legend. What the
// extraction keeps, and that the credit records rule (Lane 6, #100) never reads it as "matches". Synthetic data only.

const doc = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:cbs-1', documentId: 'cbs-1' } }
const byKey = (candidates: FactCandidate[], key: string) => candidates.filter((c) => c.factKey === key)

/** What a model returns for the table, one entry per row, cells copied as written. */
const MODEL_OUTPUT = {
  document_type: 'credit_bureau_report',
  report_date: { date: '2025-11-02', quote: CBS_LAYOUT_REPORT_DATE_LINE },
  credit_account_status: CBS_LAYOUT_CELLS.map((c) => ({
    as_of: null,
    status_text: null,
    account_name: null,
    lender: c.grantorBank,
    last4: null,
    product_type: c.productType,
    overdue_balance: c.overdueBalance,
    cycle_codes: c.cycleCodes,
    facility: null,
    bureau: 'Example Credit Bureau',
    quote: c.row,
    confidence: 0.9,
  })),
}

const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })

function extracted(output: unknown = MODEL_OUTPUT): CreditAccountStatus[] {
  const [status] = byKey(parseFactExtraction(output, CBS_LAYOUT_TEXT, doc), 'credit_account_status')
  return (status?.value ?? []) as CreditAccountStatus[]
}

test('one status per row: the code string as the status, product type, overdue balance and codes verbatim', () => {
  const statuses = extracted()
  assert.deepEqual(statuses.map((s) => [s.lender, s.productType, s.overdueBalance, s.cycleCodes, s.statusText, s.reportDate, s.asOf, s.quote]), [
    ['Example Bank A', 'Credit Card', sgd(7550), 'AAAAAAAAABCC', 'AAAAAAAAABCC', '2025-11-02', null, CBS_LAYOUT_ROWS[0]],
    ['Example Bank B', 'Credit Card', sgd(0), 'AAAAAAAAAAAA', 'AAAAAAAAAAAA', '2025-11-02', null, CBS_LAYOUT_ROWS[1]],
    ['Example Bank C', 'Personal Loan', sgd(0), 'AAAAAAEEEEEE', 'AAAAAAEEEEEE', '2025-11-02', null, CBS_LAYOUT_ROWS[2]],
  ])
  assert.ok(statuses.every((s) => s.source === 'credit_bureau_report' && s.bureau === 'Example Credit Bureau'))
})

test('cells not in the row are dropped; status words not in the row drop the entry', () => {
  const [a] = extracted({
    ...MODEL_OUTPUT,
    credit_account_status: [{ ...MODEL_OUTPUT.credit_account_status[0], product_type: 'Charge Card', overdue_balance: '1,234.00', cycle_codes: 'AAAAAAAAAAAA' }],
  })
  assert.deepEqual([a.productType, a.overdueBalance, a.cycleCodes, a.statusText], [null, null, null, ''])
  // Words the row does not have ("current") would be a paraphrase of the codes: the entry is dropped.
  assert.deepEqual(extracted({ ...MODEL_OUTPUT, credit_account_status: [{ ...MODEL_OUTPUT.credit_account_status[1], status_text: 'current' }] }), [])
})

// ---- The credit records rule on this layout (Lane 6, #100).

const dispute = { institutionName: 'Example Bank A', disputedLast4: ['0001'] }
// The synthetic card-only case: 8.3's window 13 Sep to 20 Oct 2025; 8.4(a)'s 20 Oct to 19 Nov 2025 (until exclusive).
const PERIODS = [{ from: '2025-09-13', until: '2025-10-20' }, { from: '2025-10-20', until: '2025-11-20' }]

test('the rule never reads this layout as "matches": the disputed card\'s row gives no outcome', () => {
  const statuses = extracted()
  for (const s of statuses) assert.equal(showsGoodStanding(s), false, s.quote)
  for (const p of PERIODS) {
    const reading = creditRecordsReading({ bureauReportRead: true, statuses, from: p.from, until: p.until, today: '2026-11-24', dispute })
    assert.equal(reading.kind, 'overdue')
    // Only Example Bank A's row is about the disputed card; the other banks' rows neither print nor count.
    assert.deepEqual(reading.kind === 'overdue' ? reading.statuses.map((s) => s.quote) : [], [CBS_LAYOUT_ROWS[0]])
  }
  // Even with a zero overdue balance and all-"A" codes, codes are never read as good standing: still no "matches".
  const clean = statuses.map((s) => (s.lender === 'Example Bank A' ? { ...s, overdueBalance: sgd(0), cycleCodes: 'AAAAAAAAAAAA', statusText: 'AAAAAAAAAAAA' } : s))
  for (const p of PERIODS) {
    assert.notEqual(creditRecordsReading({ bureauReportRead: true, statuses: clean, from: p.from, until: p.until, today: '2026-11-24', dispute }).kind, 'matches')
  }
})

// The Section 8 check end to end, with a bureau report read and an 8.4 text that states its period.
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
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

test('Section 8: 8.3 and 8.4(a) carry no outcome, and the Example Bank A row (7,550.00 overdue) prints beside each', async () => {
  const d: CaseSectionData = structuredClone(cardOnlyCase.data)
  d.facts.credit_account_status = { label: 'confirmed', value: extracted() }
  d.evidenceIds.credit_account_status = ['E9']
  const r = await createDisputeChargesChecks({ creditBureauReportRead: () => true })({ ...d, provider })
  const rows = comparisons(r).filter((c) => c.clauseKey === SECTION_8_CLAUSES.p8_3 || c.clauseKey === SECTION_8_CLAUSES.p8_4)
  assert.deepEqual(rows, [], 'no 8.3 or 8.4(a) comparison: no outcome')
  assert.ok(!comparisons(r).some((c) => c.outcome === 'matches'))
  const lines = r.lines.flatMap((l) => (l.kind === 'account_status' ? [l] : []))
  assert.deepEqual(lines.map((l) => [l.clauseKey, l.status.quote, l.status.overdueBalance?.amount]), [
    [SECTION_8_CLAUSES.p8_3, CBS_LAYOUT_ROWS[0], 7550],
    [SECTION_8_CLAUSES.p8_4, CBS_LAYOUT_ROWS[0], 7550],
  ])
})
