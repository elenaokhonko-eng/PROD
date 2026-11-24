import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  buildDisputeChargesChecks,
  creditCardPayments,
  replySaysAuthorised,
  SECTION_8_CLAUSES,
  SECTION_8_FROM,
  SECTION_8_ROWS_AWAITING_WORDING,
} from '../../supabase/functions/_shared/facts/rules/dispute-charges-checks.ts'
import {
  CLAUSE_KEYS,
  type ComparisonLine,
  createFakeClauseProvider,
  type FakeCorpus,
  SECTION_IDS,
  type SectionResult,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { GENDERED_PRONOUNS } from '../../supabase/functions/_shared/facts/update/section-writer.ts'
import {
  accountSrfCase,
  cardOnlyCase,
  type CaseSectionData,
  FIDREC_UPDATE_CASES,
  syntheticCorpus,
} from '../fixtures/fidrec-update/index.ts'

// Review of 24 Nov 2026, Decision 8: EUPG Section 8, charges and credit records while a transaction is disputed.
// Synthetic data only.

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function testCorpus(): FakeCorpus {
  const corpus: FakeCorpus = structuredClone(syntheticCorpus)
  for (const v of corpus.versions.filter((x) => x.document_key === 'mas.eupg' && x.status === 'verified')) {
    for (const key of CLAUSE_KEYS.disputed_amount_charges) {
      v.clauses.push({ clause_id: `t-${v.version_id}-${key}`, clause_key: key, clause_ref: key.split('/')[1], text_content: `Placeholder text of ${key}.`, text_sha256: sha(key), ...(v.effective_from < SECTION_8_FROM ? { effective_from_override: SECTION_8_FROM } : {}) })
    }
  }
  corpus.statements.push({
    statement_id: 't-eupg.section8.outofscope',
    statement_key: 'eupg.section8.outofscope',
    revision: 1,
    framework: 'eupg',
    applies_to_instrument: ['account_transfer', 'ewallet', 'sg_card'],
    text: 'Placeholder statement eupg.section8.outofscope.',
    clause_keys: [SECTION_8_CLAUSES.fn26, SECTION_8_CLAUSES.fn27],
    status: 'approved',
    clauses_as_of: '2025-06-16',
    approved_by: 'synthetic-reviewer',
    approved_at: '2025-06-17T00:00:00Z',
    checked_wording: [
      { clause_key: SECTION_8_CLAUSES.fn26, text_sha256: sha(SECTION_8_CLAUSES.fn26) },
      { clause_key: SECTION_8_CLAUSES.fn27, text_sha256: sha(SECTION_8_CLAUSES.fn27) },
    ],
  })
  return corpus
}

const provider = createFakeClauseProvider(testCorpus())
const run = (data: CaseSectionData) => buildDisputeChargesChecks({ ...data, provider })
const clone = (data: CaseSectionData): CaseSectionData => structuredClone(data)
const comparisons = (r: SectionResult): ComparisonLine[] => r.lines.flatMap((l) => (l.kind === 'comparison' ? [l.comparison] : []))
const withKey = (r: SectionResult, key: string) => comparisons(r).filter((c) => c.clauseKey === key)
const statementKeys = (r: SectionResult) => r.lines.flatMap((l) => (l.kind === 'statement' ? [l.statement.statementKey] : []))
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })

/** The card-only case (a credit card; reported 13 Sep 2025; final reply 20 Oct 2025) with the four Section 8 facts. */
function creditCase(opts: { requests?: string[]; charges?: string[]; reports?: string[]; fidrec?: { told: string; closed: string | null } } = {}): CaseSectionData {
  const d = clone(cardOnlyCase.data)
  d.facts.disputed_amount_payment_requests = { label: 'confirmed', value: (opts.requests ?? []).map((date) => ({ date, amount: sgd(7_550), source: 'statement' as const })) }
  d.facts.charges_on_disputed_amount = { label: 'confirmed', value: (opts.charges ?? []).map((date) => ({ date, amount: sgd(80), kind: 'late_fee' as const, description: 'Late payment charge', relatedTransactionIndex: null })) }
  d.facts.credit_bureau_reports = { label: 'confirmed', value: (opts.reports ?? []).map((date) => ({ date, bureau: 'Example Credit Bureau', source: 'credit_bureau_report' as const })) }
  if (opts.fidrec) d.facts.fidrec_dispute_dates = { label: 'confirmed', value: { startedOn: opts.fidrec.told, institutionToldOn: opts.fidrec.told, completedOrClosedOn: opts.fidrec.closed } }
  d.evidenceIds.disputed_amount_payment_requests = ['E7']
  d.evidenceIds.charges_on_disputed_amount = ['E7']
  d.evidenceIds.credit_bureau_reports = ['E8']
  return d
}

test('the section sits after duty_time_checks and reads only the Section 8 clause keys', async () => {
  assert.equal(SECTION_IDS[SECTION_IDS.indexOf('duty_time_checks') + 1], 'disputed_amount_charges')
  for (const c of FIDREC_UPDATE_CASES) {
    const r = await run(c.data)
    assert.equal(r.sectionId, 'disputed_amount_charges')
    for (const line of comparisons(r)) {
      assert.ok((CLAUSE_KEYS.disputed_amount_charges as readonly string[]).includes(line.clauseKey), `${c.id}: ${line.clauseKey}`)
      if (line.expected) assert.match(line.expected, /^Placeholder text of mas\.eupg\/8\./)
    }
  }
})

test('one row per paragraph; 8.3 only for credit cards; 8.4 and 8.5 wait for the wording of 8.4(b)', async () => {
  const credit = await run(creditCase())
  assert.deepEqual(comparisons(credit).map((c) => c.clauseKey), [SECTION_8_CLAUSES.p8_1, SECTION_8_CLAUSES.p8_2, SECTION_8_CLAUSES.p8_3])
  const account = await run(accountSrfCase.data)
  assert.deepEqual(comparisons(account).map((c) => c.clauseKey), [SECTION_8_CLAUSES.p8_1, SECTION_8_CLAUSES.p8_2])
  assert.deepEqual([...SECTION_8_ROWS_AWAITING_WORDING], ['mas.eupg/8.4', 'mas.eupg/8.5'])
  assert.equal(creditCardPayments(cardOnlyCase.data.payments, ['credit_card', 'debit_card']).length, 0, 'not decided when both card types are named')
})

test('an event before 16 June 2025 is not_applicable, printing the date', async () => {
  const d = creditCase({ charges: ['2025-06-20'] })
  d.facts.reported_to_bank!.value!.date = '2025-06-15'
  const r = await run(d)
  assert.ok(comparisons(r).length === 3 && comparisons(r).every((c) => c.outcome === 'not_applicable'))
  assert.equal(comparisons(r)[0].record, 'The complainant reported to the institution on 15 June 2025.')
  assert.equal(comparisons(r)[0].expected, 'Placeholder text of mas.eupg/8.1.')
  d.facts.reported_to_bank!.value!.date = '2025-06-16'
  assert.notEqual(comparisons(await run(d))[0].outcome, 'not_applicable')
})

test('8.1: a charge or request during the investigation differs; none matches; no statements read is not_shown', async () => {
  const charged = withKey(await run(creditCase({ charges: ['2025-10-01'] })), SECTION_8_CLAUSES.p8_1)[0]
  assert.equal(charged.outcome, 'differs')
  assert.match(charged.record, /reported to the institution on 13 September 2025\. The institution's final reply is dated 20 October 2025\. The records show 1 charge on the disputed amount in that period: 1 October 2025 'Late payment charge' S\$80\./)
  assert.deepEqual(charged.evidenceIds, ['E2', 'E7'])
  const asked = withKey(await run(creditCase({ requests: ['2025-09-25'] })), SECTION_8_CLAUSES.p8_1)[0]
  assert.equal(asked.outcome, 'differs')
  assert.match(asked.record, /1 request to pay the disputed amount in that period: 25 September 2025 \(S\$7,550\)/)
  // On the day of the final reply the investigation is complete: the charge falls in 8.2's period instead.
  assert.equal(withKey(await run(creditCase({ charges: ['2025-10-20'] })), SECTION_8_CLAUSES.p8_1)[0].outcome, 'matches')
  assert.equal(withKey(await run(creditCase()), SECTION_8_CLAUSES.p8_1)[0].outcome, 'matches')
  assert.equal(withKey(await run(cardOnlyCase.data), SECTION_8_CLAUSES.p8_1)[0].outcome, 'not_shown')
})

test('8.2: the 30 calendar days after the outcome, and the FIDReC period from when the institution was told', async () => {
  const p82 = async (opts: Parameters<typeof creditCase>[0]) => withKey(await run(creditCase(opts)), SECTION_8_CLAUSES.p8_2)[0]
  // 20 Oct 2025 + 30 calendar days = 19 Nov 2025.
  assert.equal((await p82({ charges: ['2025-11-19'] })).outcome, 'differs')
  assert.equal((await p82({ charges: ['2025-11-20'] })).outcome, 'matches')
  const fidrec = await p82({ charges: ['2026-01-10'], fidrec: { told: '2025-12-01', closed: null } })
  assert.equal(fidrec.outcome, 'differs')
  assert.match(fidrec.record, /told on 1 December 2025 that dispute resolution with FIDReC had started\./)
  assert.equal((await p82({ charges: ['2026-01-10'], fidrec: { told: '2025-12-01', closed: '2026-01-05' } })).outcome, 'matches')
  // A full offer: 8.2 does not apply.
  const d = creditCase()
  d.facts.bank_reply!.value!.outcome = 'full_offer'
  assert.equal(withKey(await run(d), SECTION_8_CLAUSES.p8_2)[0].outcome, 'not_applicable')
})

test('8.3: a report of non-payment to a credit bureau during the investigation differs, with its source', async () => {
  const reported = withKey(await run(creditCase({ reports: ['2025-10-05'] })), SECTION_8_CLAUSES.p8_3)[0]
  assert.equal(reported.outcome, 'differs')
  assert.match(reported.record, /1 report of non-payment of the disputed amount to a credit bureau in that period: 5 October 2025 to Example Credit Bureau \(the credit bureau report\)\./)
  assert.deepEqual(reported.evidenceIds, ['E2', 'E8'])
  assert.equal(withKey(await run(creditCase()), SECTION_8_CLAUSES.p8_3)[0].outcome, 'matches')
  assert.equal(withKey(await run(cardOnlyCase.data), SECTION_8_CLAUSES.p8_3)[0].outcome, 'not_shown')
})

test('footnotes 26 and 27 print as a statement where the institution\'s reply says authorised; no link statement', async () => {
  assert.deepEqual(statementKeys(await run(creditCase())), [])
  const d = creditCase()
  d.facts.card_dispute_response!.value!.reasonStated = 'the payments were authorised with the registered digital token'
  assert.equal(replySaysAuthorised(d), true)
  assert.deepEqual(statementKeys(await run(d)), ['eupg.section8.outofscope'])
  const un = creditCase()
  un.facts.card_dispute_response!.value!.reasonStated = 'the payments were not unauthorised'
  assert.equal(replySaysAuthorised(un), false)
  for (const c of FIDREC_UPDATE_CASES) assert.ok(!statementKeys(await run(c.data)).some((k) => k.startsWith('link.') || k.startsWith('bridge.')), c.id)
})

test('no record carries verdict wording or a gendered pronoun', async () => {
  const VERDICT = /\b(?:breach(?:ed|es)?|violat\w*|fail(?:ed|s)? to|did not comply|non-?complian\w*|liable|liability|negligen\w*|should have|ought to)\b/i
  for (const d of [...FIDREC_UPDATE_CASES.map((c) => c.data), creditCase({ charges: ['2025-10-01'], reports: ['2025-10-05'], fidrec: { told: '2025-12-01', closed: null } })]) {
    for (const line of comparisons(await run(d))) {
      assert.doesNotMatch(line.record.replace(/'[^']*'/g, "''"), VERDICT, line.record)
      assert.doesNotMatch(line.record.replace(/'[^']*'/g, "''"), GENDERED_PRONOUNS, line.record)
    }
  }
})
