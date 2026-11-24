// The "account overdue" fact (Elena, 25 Nov 2026): the contract part. A credit bureau report (or the institution's
// letter) can show the card account overdue without naming the disputed amount. The fact is behind the update's switch
// like the other update facts and never reaches the model; it prints beside EUPG 8.3 and 8.4 as a line with no outcome;
// and CREDIT_RECORDS_RULE decides when 8.3 and 8.4(a) may read "matches". Lanes 2 (extraction) and 3 (printing)
// build on this. Synthetic data only.

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBankPackInput, buildFidrecPackInput, FACT_LABELS, PAID_STAGE_ONLY_FACT_KEYS, type SnapshotFacts } from '../../lib/facts'
import {
  CREDIT_ACCOUNT_STATUS_SOURCES,
  type CreditAccountStatus,
  createFakeClauseProvider,
  creditRecordsReading,
  NO_OUTCOME_LINE_KINDS,
  showsOverdue,
  statusBelongsToDispute,
  UPDATE_FACT_KEYS,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { factsForModel, isServerOnlyDocument, SERVER_ONLY_FACT_KEYS, serverOnlyValues } from '../../supabase/functions/_shared/facts/update/model-guard.ts'
import { renderUpdateSections } from '../../supabase/functions/_shared/facts/update/render.ts'
import { creditAccountStatusLine, SectionWriter } from '../../supabase/functions/_shared/facts/update/section-writer.ts'
import { cardOnlyCase, syntheticCorpus } from '../fixtures/fidrec-update/index.ts'
import { CREDIT_BUREAU_OVERDUE_TEXT, OVERDUE_LINE } from '../fixtures/evidence/credit-bureau-overdue.ts'

/** The status Lane 2's overdue fixture shows (synthetic). */
const OVERDUE: CreditAccountStatus = {
  asOf: '2025-10-15',
  statusText: '30 days overdue',
  facility: 'credit card ending 0001',
  bureau: 'Example Credit Information Bureau',
  source: 'credit_bureau_report',
  evidenceId: 'E7',
  quote: OVERDUE_LINE,
}
const PAID: CreditAccountStatus = { ...OVERDUE, statusText: 'paid as agreed', quote: 'Payment status as at 15 Oct 2025: paid as agreed' }

test('the fact: credit_account_status is an update fact, paid stages only, and never sent to the model', () => {
  assert.ok((UPDATE_FACT_KEYS as readonly string[]).includes('credit_account_status'))
  assert.ok(PAID_STAGE_ONLY_FACT_KEYS.has('credit_account_status'), 'behind the switch, like the other update facts')
  assert.ok((SERVER_ONLY_FACT_KEYS as readonly string[]).includes('credit_account_status'))
  assert.deepEqual([...CREDIT_ACCOUNT_STATUS_SOURCES], ['credit_bureau_report', 'institution_letter'])
  assert.equal(typeof FACT_LABELS.credit_account_status, 'string')
  // The status text is the document's own words, inside its quote (the fixture's line).
  assert.ok(OVERDUE.quote.includes(OVERDUE.statusText) && CREDIT_BUREAU_OVERDUE_TEXT.includes(OVERDUE.quote))
  const facts = { ...cardOnlyCase.data.facts, credit_account_status: { value: [OVERDUE], label: 'confirmed' } } as unknown as SnapshotFacts
  assert.equal(factsForModel(facts).credit_account_status, undefined)
  assert.ok(serverOnlyValues(facts).includes(OVERDUE.quote))
  assert.ok(isServerOnlyDocument('CREDIT_BUREAU_REPORT'), 'the report itself is never excerpted for the model')
  // With the switch off the fact never reaches a paid snapshot (facts-service; fidrec-pack-switch-off.test.ts). With it
  // on, the model input holds neither the fact nor its words.
  for (const input of [
    buildFidrecPackInput({ facts, findings: [], storyText: null, finalReplyText: null, evidenceIndex: [], update: { sections: [], clauses: [], redact: serverOnlyValues(facts) } }),
    buildBankPackInput({ facts, findings: [], storyText: null, update: { redact: serverOnlyValues(facts) } }),
  ]) {
    const text = JSON.stringify(input)
    assert.ok(!text.includes('30 days overdue') && !text.includes('credit_account_status'))
  }
})

test("the line (approved 25 Nov 2026): the account as the document names it, the status quoted, no outcome", () => {
  const named = { ...OVERDUE, accountName: 'Example Bank A credit card ending 0001' }
  assert.equal(creditAccountStatusLine(named), "The credit bureau report from Example Credit Information Bureau shows Example Bank A credit card ending 0001 as '30 days overdue' as at 15 October 2025.")
  assert.equal(creditAccountStatusLine({ ...named, bureau: null, asOf: null }), "The credit bureau report shows Example Bank A credit card ending 0001 as '30 days overdue'.")
  assert.equal(creditAccountStatusLine({ ...named, source: 'institution_letter', bureau: null }), "The institution's letter shows Example Bank A credit card ending 0001 as '30 days overdue' as at 15 October 2025.")
  // A document that names no account: "the card account".
  assert.equal(creditAccountStatusLine(OVERDUE), "The credit bureau report from Example Credit Information Bureau shows the card account as '30 days overdue' as at 15 October 2025.")
  assert.equal(FACT_LABELS.credit_account_status, "Your card account's status in a credit bureau report or your bank's letter")
  assert.ok((NO_OUTCOME_LINE_KINDS as readonly string[]).includes('account_status'))
  const w = new SectionWriter('disputed_amount_charges', { provider: createFakeClauseProvider(syntheticCorpus), evidenceIds: {} })
  w.accountStatus(named, 'mas.eupg/8.3', ['E7'])
  const printed = renderUpdateSections([w.result()]).sections[0].lines.map((l) => l.text)
  assert.deepEqual(printed, ["The credit bureau report from Example Credit Information Bureau shows Example Bank A credit card ending 0001 as '30 days overdue' as at 15 October 2025. (E7)"])
  assert.ok(printed.every((t) => !/Side by side|as the documents? expects?|differs/.test(t)))
})

test('CREDIT_RECORDS_RULE: "matches" only if a bureau report was read and shows no overdue status between those dates', () => {
  const period = { from: '2025-09-13', until: '2025-10-20', today: '2026-11-24' }
  // Read, nothing overdue in the period: matches.
  assert.deepEqual(creditRecordsReading({ ...period, bureauReportRead: true, statuses: [] }), { kind: 'matches' })
  assert.deepEqual(creditRecordsReading({ ...period, bureauReportRead: true, statuses: [PAID] }), { kind: 'matches' })
  // Read, overdue in the period: the overdue line, no outcome.
  assert.deepEqual(creditRecordsReading({ ...period, bureauReportRead: true, statuses: [OVERDUE, PAID] }), { kind: 'overdue', statuses: [OVERDUE] })
  // Overdue with no date cannot be placed outside the period.
  assert.equal(creditRecordsReading({ ...period, bureauReportRead: true, statuses: [{ ...OVERDUE, asOf: null }] }).kind, 'overdue')
  // From is inclusive, until exclusive.
  assert.equal(creditRecordsReading({ ...period, bureauReportRead: true, statuses: [{ ...OVERDUE, asOf: '2025-10-20' }] }).kind, 'matches')
  assert.equal(creditRecordsReading({ ...period, bureauReportRead: true, statuses: [{ ...OVERDUE, asOf: '2025-09-13' }] }).kind, 'overdue')
  assert.equal(creditRecordsReading({ ...period, bureauReportRead: true, statuses: [{ ...OVERDUE, asOf: '2025-09-12' }] }).kind, 'matches')
  // A period still running is read up to today.
  assert.equal(creditRecordsReading({ ...period, until: null, bureauReportRead: true, statuses: [{ ...OVERDUE, asOf: '2026-11-24' }] }).kind, 'overdue')
  // Not read: never matches; an overdue status from the institution's letter still prints.
  assert.deepEqual(creditRecordsReading({ ...period, bureauReportRead: false, statuses: [] }), { kind: 'not_read' })
  assert.deepEqual(creditRecordsReading({ ...period, bureauReportRead: false, statuses: [PAID] }), { kind: 'not_read' })
  const letter = { ...OVERDUE, source: 'institution_letter' as const, bureau: null }
  assert.equal(creditRecordsReading({ ...period, bureauReportRead: false, statuses: [letter] }).kind, 'overdue')
})

test('overdue words: wide on purpose (the only effect is that the row is not "matches")', () => {
  for (const t of ['30 days overdue', 'Past due', 'in arrears', 'delinquent', 'defaulted', '60 DPD', 'written off', 'late payment', 'no overdue amount']) {
    assert.ok(showsOverdue({ statusText: t }), t)
  }
  for (const t of ['paid as agreed', 'current', 'account closed', 'no adverse record']) assert.ok(!showsOverdue({ statusText: t }), t)
})

// Review of 25 Nov 2026: (a) only the disputed account counts; (b) "matches" only for a report covering the whole period.
const DISPUTE = { institutionName: 'Example Bank A', disputedLast4: ['0001'] }
const REPORT_DATE = '2025-11-02'
const ours = (over: Partial<CreditAccountStatus> = {}): CreditAccountStatus =>
  ({ ...PAID, accountName: 'Example Bank A credit card ending 0001', lender: 'Example Bank A', last4: '0001', reportDate: REPORT_DATE, ...over })
const theirs = (over: Partial<CreditAccountStatus> = {}): CreditAccountStatus =>
  ({ ...OVERDUE, accountName: 'Example Bank B credit card ending 0009', lender: 'Example Bank B', last4: '0009', reportDate: REPORT_DATE, quote: 'Example Bank B card ending 0009: 30 days overdue', ...over })
const ended = { from: '2025-09-13', until: '2025-10-20', today: '2026-11-24' }

test('(a) account: a report listing two accounts where only the other bank\'s card is overdue blocks nothing and prints nothing', () => {
  assert.ok(statusBelongsToDispute(ours(), DISPUTE))
  assert.ok(!statusBelongsToDispute(theirs(), DISPUTE), 'another bank')
  assert.ok(!statusBelongsToDispute(ours({ last4: '0002' }), DISPUTE), 'our bank, another card')
  assert.ok(!statusBelongsToDispute(ours({ lender: null, accountName: null }), DISPUTE), 'no account named: unknown, ignored')
  assert.ok(!statusBelongsToDispute(ours({ last4: '0001' }), { institutionName: 'Example Bank A', disputedLast4: [] }), 'card digits given but no disputed card known')
  assert.ok(statusBelongsToDispute(ours({ last4: null }), DISPUTE), 'our bank, no digits given')
  assert.ok(statusBelongsToDispute(ours({ lender: null }), DISPUTE), 'the account name names the bank')
  assert.ok(statusBelongsToDispute({ ...OVERDUE, source: 'institution_letter', bureau: null }, DISPUTE), "the institution's own letter")
  // The other bank's card is overdue in the period: no block, no line; our account is paid as agreed: matches.
  const reading = creditRecordsReading({ ...ended, bureauReportRead: true, statuses: [ours(), theirs({ asOf: '2025-10-01' })], dispute: DISPUTE })
  assert.deepEqual(reading, { kind: 'matches' })
  // Our card overdue: blocks and prints, alone.
  const ourOverdue = ours({ statusText: '30 days overdue', asOf: '2025-10-01' })
  assert.deepEqual(creditRecordsReading({ ...ended, bureauReportRead: true, statuses: [ourOverdue, theirs({ asOf: '2025-10-01' })], dispute: DISPUTE }), { kind: 'overdue', statuses: [ourOverdue] })
})

test('(b) coverage: "matches" only for a read report dated on or after the period\'s last day; a running period is never "matches"', () => {
  // The period 13 Sep to 20 Oct 2025 (until exclusive): its last day is 19 Oct 2025.
  assert.deepEqual(creditRecordsReading({ ...ended, bureauReportRead: true, statuses: [ours({ reportDate: '2025-10-19' })], dispute: DISPUTE }), { kind: 'matches' })
  assert.deepEqual(creditRecordsReading({ ...ended, bureauReportRead: true, statuses: [ours({ reportDate: '2025-10-18' })], dispute: DISPUTE }), { kind: 'not_read', reason: 'report_before_period_end' })
  assert.deepEqual(creditRecordsReading({ ...ended, bureauReportRead: true, statuses: [ours({ reportDate: null })], dispute: DISPUTE }), { kind: 'not_read', reason: 'report_before_period_end' }, 'no report date')
  assert.deepEqual(creditRecordsReading({ ...ended, bureauReportRead: true, statuses: [], dispute: DISPUTE }), { kind: 'not_read', reason: 'report_before_period_end' }, 'nothing read from the report')
  // The report's date counts whatever account the status is about (it is the report's own date).
  assert.deepEqual(creditRecordsReading({ ...ended, bureauReportRead: true, statuses: [ours({ reportDate: null }), theirs({ statusText: 'paid as agreed' })], dispute: DISPUTE }), { kind: 'matches' })
  // Gap c: the disputed account must be listed in the report for "matches".
  assert.deepEqual(creditRecordsReading({ ...ended, bureauReportRead: true, statuses: [theirs({ statusText: 'paid as agreed' })], dispute: DISPUTE }), { kind: 'not_read', reason: 'account_not_listed' })
  // A letter's date never makes "matches".
  assert.equal(creditRecordsReading({ ...ended, bureauReportRead: true, statuses: [ours({ source: 'institution_letter', bureau: null })], dispute: DISPUTE }).kind, 'not_read')
  // A period still running: until null, or after today.
  assert.deepEqual(creditRecordsReading({ ...ended, until: null, bureauReportRead: true, statuses: [ours()], dispute: DISPUTE }), { kind: 'not_read', reason: 'period_running' })
  assert.deepEqual(creditRecordsReading({ ...ended, until: '2026-12-01', bureauReportRead: true, statuses: [ours({ reportDate: '2026-12-05' })], dispute: DISPUTE }), { kind: 'not_read', reason: 'period_running' })
  // Not read at all.
  assert.deepEqual(creditRecordsReading({ ...ended, bureauReportRead: false, statuses: [ours()], dispute: DISPUTE }), { kind: 'not_read', reason: 'no_report_read' })
  // Without `dispute` the rule is as first written (Lane 3's call until it passes the dispute).
  assert.deepEqual(creditRecordsReading({ ...ended, until: null, bureauReportRead: true, statuses: [] }), { kind: 'matches' })
})
