import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  buildDisputeChargesChecks,
  createDisputeChargesChecks,
  creditCardPayments,
  replySaysAuthorised,
  SECTION_8_CLAUSES,
  SECTION_8_FROM,
  calendarDaysStatedIn,
  periodDaysIn84a,
  REPAYMENT_NOT_SHOWN,
  SECTION_8_ROWS_AWAITING_WORDING,
  creditBureauReportReadFrom,
} from '../../supabase/functions/_shared/facts/rules/dispute-charges-checks.ts'
import { sectionBuilders } from '../../supabase/functions/_shared/facts/update/registry.ts'
import {
  CLAUSE_KEYS,
  type ComparisonLine,
  type CreditAccountStatus,
  createFakeClauseProvider,
  type FakeCorpus,
  type QuotationLine,
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
/** A builder for a case where a credit bureau report document is in the records and was read. */
const bureauRead = createDisputeChargesChecks({ creditBureauReportRead: () => true })
const runRead = (data: CaseSectionData) => bureauRead({ ...data, provider })
const clone = (data: CaseSectionData): CaseSectionData => structuredClone(data)
const comparisons = (r: SectionResult): ComparisonLine[] => r.lines.flatMap((l) => (l.kind === 'comparison' ? [l.comparison] : []))
const withKey = (r: SectionResult, key: string) => comparisons(r).filter((c) => c.clauseKey === key)
const statementKeys = (r: SectionResult) => r.lines.flatMap((l) => (l.kind === 'statement' ? [l.statement.statementKey] : []))
const quotations = (r: SectionResult): QuotationLine[] => r.lines.flatMap((l) => (l.kind === 'quotation' ? [l.quotation] : []))
const texts = (r: SectionResult) => r.lines.flatMap((l) => (l.kind === 'text' ? [l.text] : []))

/**
 * A corpus whose 8.4 and 8.5 texts carry their periods, in the structure of the loaded paragraphs (synthetic text, not
 * the EUPG's wording): 8.4(a) "up to 30 calendar days after", 8.4(b) with no period, 8.5 "7 calendar days".
 */
const TEXT_8_4 = 'Synthetic 8.4: during the following periods: (a) from the investigation up to 30 calendar days after the outcome is given; and (b) after FIDReC completes or closes the case.'
const TEXT_8_5 = 'Synthetic 8.5: reporting may resume after those periods if not repaid within 7 calendar days from the request.'
function periodCorpus(): FakeCorpus {
  const corpus = testCorpus()
  for (const v of corpus.versions.filter((x) => x.document_key === 'mas.eupg' && x.status === 'verified')) {
    for (const c of v.clauses) {
      if (c.clause_key === SECTION_8_CLAUSES.p8_4) c.text_content = TEXT_8_4
      if (c.clause_key === SECTION_8_CLAUSES.p8_5) c.text_content = TEXT_8_5
    }
  }
  return corpus
}
const periodProvider = createFakeClauseProvider(periodCorpus())
const runWithPeriods = (data: CaseSectionData) => buildDisputeChargesChecks({ ...data, provider: periodProvider })
const runWithPeriodsRead = (data: CaseSectionData) => bureauRead({ ...data, provider: periodProvider })
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

// Changed with Lane 1's confirmation of 8.4(b) (24 Nov 2026): 8.4 and 8.5 now print for credit cards. With a loaded 8.4
// whose text states no period for (a), 8.4 is quoted (no comparison), and 8.5 is quoted where no row can be computed.
test('one row per paragraph; 8.3 to 8.5 only for credit cards; nothing waits for wording', async () => {
  const credit = await run(creditCase())
  assert.deepEqual(comparisons(credit).map((c) => c.clauseKey), [SECTION_8_CLAUSES.p8_1, SECTION_8_CLAUSES.p8_2, SECTION_8_CLAUSES.p8_3])
  assert.deepEqual(quotations(credit).map((q) => q.passages.map((x) => x.clauseKey)), [[SECTION_8_CLAUSES.p8_4], [SECTION_8_CLAUSES.p8_5]])
  const account = await run(accountSrfCase.data)
  assert.deepEqual(comparisons(account).map((c) => c.clauseKey), [SECTION_8_CLAUSES.p8_1, SECTION_8_CLAUSES.p8_2])
  assert.equal(quotations(account).length, 0)
  assert.deepEqual([...SECTION_8_ROWS_AWAITING_WORDING], [])
  assert.equal(creditCardPayments(cardOnlyCase.data.payments, ['credit_card', 'debit_card']).length, 0, 'not decided when both card types are named')
})

test('an event before 16 June 2025 is not_applicable, printing the date', async () => {
  const d = creditCase({ charges: ['2025-06-20'] })
  d.facts.reported_to_bank!.value!.date = '2025-06-15'
  const r = await run(d)
  // Changed with 8.4 and 8.5 (24 Nov 2026): five rows for a credit card case.
  assert.deepEqual(comparisons(r).map((c) => c.clauseKey), [SECTION_8_CLAUSES.p8_1, SECTION_8_CLAUSES.p8_2, SECTION_8_CLAUSES.p8_3, SECTION_8_CLAUSES.p8_4, SECTION_8_CLAUSES.p8_5])
  assert.ok(comparisons(r).every((c) => c.outcome === 'not_applicable'))
  assert.equal(quotations(r).length, 0)
  // Wording changed by Elena (24 Nov 2026, S8-1).
  assert.equal(comparisons(r)[0].record, 'The complainant reported the disputed transactions to the institution on 15 June 2025.')
  assert.equal(comparisons(r)[0].expected, 'Placeholder text of mas.eupg/8.1.')
  d.facts.reported_to_bank!.value!.date = '2025-06-16'
  assert.notEqual(comparisons(await run(d))[0].outcome, 'not_applicable')
})

test('8.1: a charge or request during the investigation differs; none matches; no statements read is not_shown', async () => {
  const charged = withKey(await run(creditCase({ charges: ['2025-10-01'] })), SECTION_8_CLAUSES.p8_1)[0]
  assert.equal(charged.outcome, 'differs')
  // Wording changed by Elena (24 Nov 2026, S8-1, S8-7: "between those dates" for 8.1).
  assert.match(charged.record, /^The complainant reported the disputed transactions to the institution on 13 September 2025\. The institution's final reply is dated 20 October 2025\. The records show 1 charge on the disputed amount between those dates: 1 October 2025 'Late payment charge' S\$80\.$/)
  assert.deepEqual(charged.evidenceIds, ['E2', 'E7'])
  const asked = withKey(await run(creditCase({ requests: ['2025-09-25'] })), SECTION_8_CLAUSES.p8_1)[0]
  assert.equal(asked.outcome, 'differs')
  assert.match(asked.record, /1 request to pay the disputed amount between those dates: 25 September 2025 \(S\$7,550\)/)
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
  // Wording changed by Elena (24 Nov 2026, S8-5, S8-12, S8-7: "in those periods" for 8.2).
  assert.match(fidrec.record, /^The institution's final reply is dated 20 October 2025\. The reply rejects the claim\. Counted from the date of the final reply, the 30 calendar days run from 20 October 2025 to 19 November 2025\. /)
  assert.match(fidrec.record, /The records show 1 charge on the disputed amount in those periods: 10 January 2026 'Late payment charge' S\$80\.$/)
  assert.equal((await p82({ charges: ['2026-01-10'], fidrec: { told: '2025-12-01', closed: '2026-01-05' } })).outcome, 'matches')
  // A full offer: 8.2 does not apply.
  const d = creditCase()
  d.facts.bank_reply!.value!.outcome = 'full_offer'
  const full = withKey(await run(d), SECTION_8_CLAUSES.p8_2)[0]
  assert.equal(full.outcome, 'not_applicable')
  assert.equal(full.record, 'The institution\'s final reply is dated 20 October 2025. The reply makes a full offer.')
  // One sentence per outcome (S8-5).
  for (const [outcome, sentence] of [['partial_offer', 'The reply makes a partial offer.'], ['other', 'The reply states another outcome.']] as const) {
    const o = creditCase()
    o.facts.bank_reply!.value!.outcome = outcome
    assert.ok(withKey(await run(o), SECTION_8_CLAUSES.p8_2)[0].record.includes(sentence), outcome)
  }
})

test('8.3: a report of non-payment to a credit bureau during the investigation differs, with its source', async () => {
  const reported = withKey(await run(creditCase({ reports: ['2025-10-05'] })), SECTION_8_CLAUSES.p8_3)[0]
  assert.equal(reported.outcome, 'differs')
  // Wording changed by Elena (24 Nov 2026, S8-16).
  assert.match(reported.record, /1 report of non-payment of the disputed amount to a credit bureau between those dates: on 5 October 2025, to Example Credit Bureau \(source: the credit bureau report\)\./)
  assert.deepEqual(reported.evidenceIds, ['E2', 'E8'])
  // Changed by Elena's logic fix (24 Nov 2026): "no report" (matches) only where a credit bureau report was read.
  assert.equal(withKey(await runRead(creditCase()), SECTION_8_CLAUSES.p8_3)[0].outcome, 'matches')
  assert.equal(withKey(await run(cardOnlyCase.data), SECTION_8_CLAUSES.p8_3)[0].outcome, 'not_shown')
  // Sources (S8-16): the institution's letter and the complainant's statement.
  const letter = creditCase()
  letter.facts.credit_bureau_reports = { label: 'confirmed', value: [{ date: '2025-10-05', bureau: null, source: 'institution_letter' }, { date: '2025-10-06', bureau: 'Example Credit Bureau', source: 'complainant_statement' }] }
  assert.match(withKey(await run(letter), SECTION_8_CLAUSES.p8_3)[0].record, /: on 5 October 2025 \(source: the institution's letter\); on 6 October 2025, to Example Credit Bureau \(source: the complainant's statement\)\.$/)
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

// ---------------------------------------------------------------------------------------------------------------
// 8.4 and 8.5 (Lane 1 confirmed 8.4(b)'s wording, 24 Nov 2026)
// ---------------------------------------------------------------------------------------------------------------

test('8.5 is measured from the earliest request before the report, not the latest', async () => {
  // Requests 21 Nov and 5 Dec 2025, report 7 Dec: 16 calendar days from the earliest (2 from the latest).
  const r = await runWithPeriods(creditCase({ requests: ['2025-12-05', '2025-11-21'], reports: ['2025-12-07'], fidrec: { told: '2025-12-10', closed: null } }))
  const [row] = withKey(r, SECTION_8_CLAUSES.p8_5)
  assert.equal(row.outcome, 'not_shown', 'one request is 7 days or more before the report: not differs')
  assert.match(row.record, /^The earliest request to pay the disputed amount in the records is dated 21 November 2025\. The records show a report of non-payment of the disputed amount to a credit bureau on 7 December 2025 \(source: the credit bureau report\), 16 calendar days later\./)
  // Both requests less than 7 days before the report: differs, measured from the earlier of them.
  const both = await runWithPeriods(creditCase({ requests: ['2025-12-05', '2025-12-03'], reports: ['2025-12-07'], fidrec: { told: '2025-12-10', closed: null } }))
  const [near] = withKey(both, SECTION_8_CLAUSES.p8_5)
  assert.equal(near.outcome, 'differs')
  // Wording changed by Elena (24 Nov 2026, S8-25).
  assert.match(near.record, /dated 3 December 2025\. .* 4 calendar days later\./)
})

test('the periods are read from text with any whitespace between the words (line breaks, non-breaking spaces)', () => {
  const nbsp = ' '
  assert.equal(periodDaysIn84a(`(a) from the date up${nbsp}to 30${nbsp}calendar\ndays\r\n after the outcome; and\n(b) after FIDReC`), 30)
  assert.equal(periodDaysIn84a(`( a ) from the date up  to\t30 calendar days after the outcome; and ( b ) after FIDReC`), 30)
  assert.equal(calendarDaysStatedIn(`if not repaid within 7${nbsp}calendar\ndays from the request`), 7)
  assert.equal(calendarDaysStatedIn(`within 7\r\n  calendar  days`), 7)
  assert.equal(calendarDaysStatedIn(`7${nbsp}calendar days, or 14\ncalendar days`), null)
})

test('the periods are read from the loaded text, never written in code', () => {
  assert.equal(periodDaysIn84a(TEXT_8_4), 30)
  assert.equal(periodDaysIn84a('Placeholder text of mas.eupg/8.4.'), null, 'no (a) period stated: 8.4(a) is treated like 8.4(b)')
  assert.equal(periodDaysIn84a('(a) from the investigation; and (b) up to 30 calendar days after FIDReC closes the case.'), null, 'a figure in (b) is not 8.4(a)\'s')
  assert.equal(calendarDaysStatedIn(TEXT_8_5), 7)
  assert.equal(calendarDaysStatedIn('7 calendar days, or 14 calendar days'), null)
})

test('8.4(a): a credit bureau report in the 30 calendar days after the reply differs; after them it matches', async () => {
  const p84 = async (reports: string[]) => withKey(await runWithPeriods(creditCase({ reports })), SECTION_8_CLAUSES.p8_4)
  const [inside] = await p84(['2025-11-19'])
  assert.equal(inside.outcome, 'differs')
  // Wording changed by Elena (24 Nov 2026, S8-5, S8-12, S8-16).
  assert.match(inside.record, /^The institution's final reply is dated 20 October 2025\. The reply rejects the claim\. Counted from the date of the final reply, the 30 calendar days run from 20 October 2025 to 19 November 2025\. The records show 1 report of non-payment of the disputed amount to a credit bureau between those dates: on 19 November 2025, to Example Credit Bureau \(source: the credit bureau report\)\.$/)
  assert.equal(inside.expected, TEXT_8_4)
  assert.deepEqual(inside.evidenceIds, ['E2', 'E8'])
  assert.equal((await p84(['2025-11-20']))[0].outcome, 'not_shown', 'no credit bureau report document read')
  assert.equal(withKey(await runWithPeriodsRead(creditCase({ reports: ['2025-11-20'] })), SECTION_8_CLAUSES.p8_4)[0].outcome, 'matches')
  // Without a credit bureau fact the row is not_shown.
  const none = creditCase()
  delete none.facts.credit_bureau_reports
  assert.equal(withKey(await runWithPeriods(none), SECTION_8_CLAUSES.p8_4)[0].outcome, 'not_shown')
})

// Changed by Elena (24 Nov 2026): where the 8.4(a) row prints, paragraph 8.4 shows once (as that row's Expected) and the
// 8.4(b) record line sits under it; the paragraph is quoted only where there is no 8.4(a) row. S8-19 wording changed.
test('8.4(b): its record line sits under the 8.4(a) row, and paragraph 8.4 prints once; with no (a) row it is quoted', async () => {
  const r = await runWithPeriods(creditCase({ reports: ['2025-12-15'], fidrec: { told: '2025-12-01', closed: null } }))
  const line = texts(r).find((t) => t.startsWith('The records show the institution was told'))
  assert.equal(line, 'The records show the institution was told on 1 December 2025 that dispute resolution with FIDReC had started. The records show 1 report of non-payment of the disputed amount to a credit bureau: on 15 December 2025, to Example Credit Bureau (source: the credit bureau report).')
  const at = r.lines.findIndex((l) => l.kind === 'text' && l.text === line)
  const before = r.lines[at - 1]
  assert.ok(before.kind === 'comparison' && before.comparison.clauseKey === SECTION_8_CLAUSES.p8_4, 'directly under the 8.4(a) row')
  assert.ok(!quotations(r).some((q) => q.passages[0].clauseKey === SECTION_8_CLAUSES.p8_4), 'paragraph 8.4 is not quoted again')
  assert.equal(withKey(r, SECTION_8_CLAUSES.p8_4).length, 1)

  // A loaded 8.4 that states no (a) period: no (a) row, so the record line is followed by the paragraph quoted.
  const q = await run(creditCase({ reports: ['2025-12-15'], fidrec: { told: '2025-12-01', closed: null } }))
  const qLine = texts(q).find((t) => t.startsWith('The records show the institution was told'))
  const qAt = q.lines.findIndex((l) => l.kind === 'text' && l.text === qLine)
  assert.equal(q.lines[qAt + 1].kind, 'quotation')
  const [q84] = quotations(q).filter((x) => x.passages[0].clauseKey === SECTION_8_CLAUSES.p8_4)
  assert.equal(q84.documentDatedAfterEvents, null)
  assert.equal(q84.intro, null)
  assert.equal(withKey(q, SECTION_8_CLAUSES.p8_4).length, 0)
})

test('8.4 where the reply made a full offer is not_applicable; with no final reply it is not_shown and 8.4(b) is still quoted', async () => {
  const full = creditCase()
  full.facts.bank_reply!.value!.outcome = 'full_offer'
  const f = await runWithPeriods(full)
  assert.equal(withKey(f, SECTION_8_CLAUSES.p8_4)[0].outcome, 'not_applicable')
  assert.equal(quotations(f).length, 0)

  const open = creditCase()
  open.facts.bank_reply = { label: 'confirmed', value: { status: 'interim', date: '2025-09-20', outcome: null, qualifies: null, reference: 'EXAMPLE-REF-0102' } }
  const o = await runWithPeriods(open)
  assert.equal(withKey(o, SECTION_8_CLAUSES.p8_4)[0].outcome, 'not_shown')
  assert.ok(quotations(o).some((q) => q.passages[0].clauseKey === SECTION_8_CLAUSES.p8_4))
  // The full-offer record (S8-5).
  assert.equal(withKey(f, SECTION_8_CLAUSES.p8_4)[0].record, 'The institution\'s final reply is dated 20 October 2025. The reply makes a full offer.')
})

test('8.5: a row where the records show a request and a later report outside the periods and before FIDReC; otherwise quoted', async () => {
  // Request 25 Nov 2025, report 28 Nov 2025 (after 8.4(a) ends on 19 Nov, before FIDReC on 10 Dec): 3 calendar days.
  const early = await runWithPeriods(creditCase({ requests: ['2025-11-25'], reports: ['2025-11-28'], fidrec: { told: '2025-12-10', closed: null } }))
  const [row] = withKey(early, SECTION_8_CLAUSES.p8_5)
  assert.equal(row.outcome, 'differs')
  // Wording changed by Elena (24 Nov 2026, S8-25).
  assert.equal(row.record, 'The earliest request to pay the disputed amount in the records is dated 25 November 2025. The records show a report of non-payment of the disputed amount to a credit bureau on 28 November 2025 (source: the credit bureau report), 3 calendar days later. The records provided do not show whether the amount was repaid.')
  assert.equal(REPAYMENT_NOT_SHOWN, 'The records provided do not show whether the amount was repaid.')
  assert.equal(row.expected, TEXT_8_5)
  assert.ok(!quotations(early).some((q) => q.passages[0].clauseKey === SECTION_8_CLAUSES.p8_5))
  // 10 calendar days: the records do not show whether the amount was repaid, so not_shown.
  const later = await runWithPeriods(creditCase({ requests: ['2025-11-21'], reports: ['2025-12-01'], fidrec: { told: '2025-12-10', closed: null } }))
  assert.equal(withKey(later, SECTION_8_CLAUSES.p8_5)[0].outcome, 'not_shown')

  // FIDReC dates not in the records, or the report after FIDReC started: the period depends on 8.4(b), so it is quoted.
  for (const d of [
    creditCase({ requests: ['2025-11-25'], reports: ['2025-11-28'] }),
    creditCase({ requests: ['2025-11-25'], reports: ['2025-12-15'], fidrec: { told: '2025-12-10', closed: null } }),
  ]) {
    const r = await runWithPeriods(d)
    assert.equal(withKey(r, SECTION_8_CLAUSES.p8_5).length, 0)
    assert.ok(quotations(r).some((q) => q.passages[0].clauseKey === SECTION_8_CLAUSES.p8_5))
    assert.ok(texts(r).some((t) => t.startsWith('The records show 1 request to pay the disputed amount: 25 November 2025 (S$7,550).')))
  }
})

test('8.4 and 8.5 print nothing for an account case, and no Section 8 line carries verdict wording in a quotation record', async () => {
  const account = await runWithPeriods(accountSrfCase.data)
  assert.ok(!comparisons(account).some((c) => c.clauseKey === SECTION_8_CLAUSES.p8_4 || c.clauseKey === SECTION_8_CLAUSES.p8_5))
  assert.equal(quotations(account).length, 0)
  const r = await runWithPeriods(creditCase({ requests: ['2025-11-25'], reports: ['2025-12-15'], fidrec: { told: '2025-12-10', closed: null } }))
  for (const t of texts(r)) {
    assert.doesNotMatch(t, /\b(?:differs|matches|breach|liable|should have)\b/i, t)
    assert.doesNotMatch(t, GENDERED_PRONOUNS, t)
  }
})

// ---------------------------------------------------------------------------------------------------------------
// Elena's logic fix (24 Nov 2026): "no report" needs a credit bureau report document that was read
// ---------------------------------------------------------------------------------------------------------------

test('no credit bureau report document read: 8.3 and 8.4(a) are not_shown, even with an empty list or letters only', async () => {
  // An empty list (for example from the institution's letters or the complainant alone).
  const empty = await runWithPeriods(creditCase())
  for (const key of [SECTION_8_CLAUSES.p8_3, SECTION_8_CLAUSES.p8_4]) {
    const [row] = withKey(empty, key)
    assert.equal(row.outcome, 'not_shown', key)
    assert.match(row.record, /The records provided do not show whether non-payment of the disputed amount was reported to a credit bureau\.$/, key)
  }
  // A report from a letter outside both windows: still not "no report".
  const letter = creditCase()
  letter.facts.credit_bureau_reports = { label: 'confirmed', value: [{ date: '2026-02-01', bureau: null, source: 'institution_letter' }] }
  const l = await runWithPeriods(letter)
  assert.equal(withKey(l, SECTION_8_CLAUSES.p8_3)[0].outcome, 'not_shown')
  assert.equal(withKey(l, SECTION_8_CLAUSES.p8_4)[0].outcome, 'not_shown')
  // The 8.4(b) record line does not say "no report" either.
  assert.ok(!texts(empty).some((t) => t.includes('The records show no report of non-payment')))
})

test('a credit bureau report document read with no matching report: 8.3 and 8.4(a) match', async () => {
  // The document was read and no report of the disputed amount was extracted, so the fact is absent.
  const d = creditCase()
  delete d.facts.credit_bureau_reports
  const r = await runWithPeriodsRead(d)
  for (const key of [SECTION_8_CLAUSES.p8_3, SECTION_8_CLAUSES.p8_4]) {
    const [row] = withKey(r, key)
    assert.equal(row.outcome, 'matches', key)
    assert.match(row.record, /The records show no report of non-payment of the disputed amount to a credit bureau between those dates\.$/, key)
  }
  assert.ok(texts(r).some((t) => t.endsWith('The records show no report of non-payment of the disputed amount to a credit bureau.')))
})

// ---------------------------------------------------------------------------------------------------------------
// The account shown overdue (contract CREDIT_RECORDS_RULE, Lane 6 #92, 25 Nov 2026)
// ---------------------------------------------------------------------------------------------------------------

/** A synthetic status line, in the shape Lane 2 extracts. */
function status(over: Partial<CreditAccountStatus>): CreditAccountStatus {
  return {
    asOf: '2025-10-15',
    statusText: '30 days overdue',
    facility: 'credit card ending 0001',
    bureau: 'Example Credit Bureau',
    source: 'credit_bureau_report',
    evidenceId: 'E9',
    quote: 'Synthetic: credit card ending 0001, 30 days overdue as at 15/10/2025',
    ...over,
  }
}
function withStatuses(list: CreditAccountStatus[], base = creditCase()): CaseSectionData {
  base.facts.credit_account_status = { label: 'confirmed', value: list }
  base.evidenceIds.credit_account_status = ['E9']
  return base
}
const accountStatuses = (r: SectionResult) => r.lines.flatMap((l) => (l.kind === 'account_status' ? [l] : []))

test('overdue statuses: 8.3 and 8.4(a) carry no outcome, and each status prints beside its row', async () => {
  // 15 Oct 2025 is inside 8.3's window (13 Sep to 20 Oct); 5 Nov 2025 is inside 8.4(a)'s (20 Oct to 19 Nov).
  const d = withStatuses([status({}), status({ asOf: '2025-11-05', statusText: '60 days past due' })])
  for (const r of [await runWithPeriods(d), await runWithPeriodsRead(d)]) {
    assert.equal(withKey(r, SECTION_8_CLAUSES.p8_3).length, 0, 'no 8.3 comparison: no outcome')
    assert.equal(withKey(r, SECTION_8_CLAUSES.p8_4).length, 0, 'no 8.4(a) comparison: no outcome')
    assert.ok(!comparisons(r).some((c) => c.outcome === 'matches' && (c.clauseKey === SECTION_8_CLAUSES.p8_3 || c.clauseKey === SECTION_8_CLAUSES.p8_4)))
    const lines = accountStatuses(r)
    assert.deepEqual(lines.map((l) => [l.clauseKey, l.status.statusText]), [[SECTION_8_CLAUSES.p8_3, '30 days overdue'], [SECTION_8_CLAUSES.p8_4, '60 days past due']])
    assert.deepEqual(lines[0].evidenceIds, ['E9'])
    // 8.3: its record, the status beside it, then paragraph 8.3 quoted (no outcome).
    const at = r.lines.findIndex((l) => l.kind === 'account_status' && l.clauseKey === SECTION_8_CLAUSES.p8_3)
    const before = r.lines[at - 1]
    assert.ok(before.kind === 'text' && before.text === 'The complainant reported the disputed transactions to the institution on 13 September 2025. The institution\'s final reply is dated 20 October 2025.')
    const after = r.lines[at + 1]
    assert.ok(after.kind === 'quotation' && after.quotation.passages[0].clauseKey === SECTION_8_CLAUSES.p8_3)
    // 8.4: paragraph 8.4 is quoted once, after the 8.4(b) record line.
    assert.equal(quotations(r).filter((q) => q.passages[0].clauseKey === SECTION_8_CLAUSES.p8_4).length, 1)
  }
})

test('an overdue status with no date counts in every window; one outside the window does not block "matches"', async () => {
  const undated = await runWithPeriodsRead(withStatuses([status({ asOf: null })]))
  assert.equal(withKey(undated, SECTION_8_CLAUSES.p8_3).length, 0)
  assert.equal(withKey(undated, SECTION_8_CLAUSES.p8_4).length, 0)
  assert.equal(accountStatuses(undated).length, 2, 'beside both rows')
  // Overdue on 1 February 2026: after both windows, so a read bureau report still reads "no report" in them.
  const later = await runWithPeriodsRead(withStatuses([status({ asOf: '2026-02-01' })]))
  assert.equal(withKey(later, SECTION_8_CLAUSES.p8_3)[0].outcome, 'matches')
  assert.equal(withKey(later, SECTION_8_CLAUSES.p8_4)[0].outcome, 'matches')
  assert.equal(accountStatuses(later).length, 0)
})

test('a bureau report read with nothing overdue: matches; not read: not_shown', async () => {
  const fine = withStatuses([status({ statusText: 'up to date' })])
  const read = await runWithPeriodsRead(fine)
  assert.equal(withKey(read, SECTION_8_CLAUSES.p8_3)[0].outcome, 'matches')
  assert.equal(withKey(read, SECTION_8_CLAUSES.p8_4)[0].outcome, 'matches')
  assert.equal(accountStatuses(read).length, 0)
  const notRead = await runWithPeriods(fine)
  assert.equal(withKey(notRead, SECTION_8_CLAUSES.p8_3)[0].outcome, 'not_shown')
  assert.equal(withKey(notRead, SECTION_8_CLAUSES.p8_4)[0].outcome, 'not_shown')
})

test('a status from the institution\'s letter blocks "matches" but never produces it', async () => {
  const letter = (statusText: string) => status({ source: 'institution_letter', bureau: null, statusText })
  // Overdue per the letter, bureau report read: no "matches", the letter's status prints beside the row.
  const blocked = await runWithPeriodsRead(withStatuses([letter('overdue')]))
  assert.equal(withKey(blocked, SECTION_8_CLAUSES.p8_3).length, 0)
  assert.equal(accountStatuses(blocked)[0].status.source, 'institution_letter')
  // Not overdue per the letter, and no bureau report read: not_shown, never "matches".
  const notProduced = await runWithPeriods(withStatuses([letter('current')]))
  assert.equal(withKey(notProduced, SECTION_8_CLAUSES.p8_3)[0].outcome, 'not_shown')
  assert.equal(withKey(notProduced, SECTION_8_CLAUSES.p8_4)[0].outcome, 'not_shown')
})

test('a report of non-payment of the disputed amount in the window still differs, whatever the status', async () => {
  const d = withStatuses([status({})], creditCase({ reports: ['2025-10-05'] }))
  const [row] = withKey(await runWithPeriodsRead(d), SECTION_8_CLAUSES.p8_3)
  assert.equal(row.outcome, 'differs')
})

// Lane 6's review of #94: run_fidrec_pack_v1's documents carry evidence_processed_v2's verified_document_type, which is
// "CREDIT_BUREAU_REPORT" (upper case). Both names are accepted, and nothing else.
test('creditBureauReportReadFrom accepts both names of a credit bureau report, in the edge function\'s document shape', () => {
  type CaseDocument = { id: string; evidenceType: string | null; complainantItem: string | null; text: string | null }
  const doc = (evidenceType: string | null, text: string | null): CaseDocument => ({ id: 'doc-synthetic-1', evidenceType, complainantItem: null, text })
  assert.equal(creditBureauReportReadFrom([doc('CREDIT_BUREAU_REPORT', 'Synthetic report text')]), true)
  assert.equal(creditBureauReportReadFrom([doc('credit_bureau_report', 'Synthetic report text')]), true)
  assert.equal(creditBureauReportReadFrom([doc('CREDIT_BUREAU_REPORT', '')]), false, 'empty text')
  assert.equal(creditBureauReportReadFrom([doc('CREDIT_BUREAU_REPORT', ' \n\t ')]), false, 'whitespace only')
  assert.equal(creditBureauReportReadFrom([doc('CREDIT_BUREAU_REPORT', null)]), false, 'no text')
  assert.equal(creditBureauReportReadFrom([doc('BANK_CORRESPONDENCE', 'A letter')]), false, 'another type')
  assert.equal(creditBureauReportReadFrom([doc('CREDIT_BUREAU', 'Synthetic report text')]), false, 'only the two known names')
  assert.equal(creditBureauReportReadFrom([doc(null, 'Synthetic report text')]), false)
  assert.equal(creditBureauReportReadFrom([doc('BANK_CORRESPONDENCE', 'A letter'), doc('CREDIT_BUREAU_REPORT', 'Synthetic report text')]), true)
})

test('creditBureauReportRead is wired from the ready documents through the registry', async () => {
  assert.equal(creditBureauReportReadFrom([{ evidenceType: 'credit_bureau_report', text: 'Synthetic report text' }]), true)
  assert.equal(creditBureauReportReadFrom([{ evidenceType: 'credit_bureau_report', text: '  ' }]), false, 'no text read')
  assert.equal(creditBureauReportReadFrom([{ evidenceType: 'bank_correspondence', text: 'A letter' }]), false)
  assert.equal(creditBureauReportReadFrom([]), false)
  const d = creditCase()
  const read = await sectionBuilders({ creditBureauReportRead: true }).disputed_amount_charges({ ...d, provider: periodProvider })
  assert.equal(withKey(read, SECTION_8_CLAUSES.p8_3)[0].outcome, 'matches')
  const unread = await sectionBuilders().disputed_amount_charges({ ...d, provider: periodProvider })
  assert.equal(withKey(unread, SECTION_8_CLAUSES.p8_3)[0].outcome, 'not_shown')
})
