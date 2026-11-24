import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addCalendarDays,
  BRIDGE_STATEMENT_KEYS,
  businessDaysBetween,
  calendarDaysBetween,
  clauseAppliesToGroup,
  ComparisonWriter,
  groupOf,
  LINK_STATEMENT_KEYS,
  linkStatementKeyFor,
  linkStatementsFor,
} from '../../supabase/functions/_shared/facts/rules/link-statements.ts'
import { TWELVE_HOUR_STATEMENT_KEYS } from '../../supabase/functions/_shared/facts/rules/duty-time-checks.ts'
import { CARD_OPENING_STATEMENT_KEY } from '../../supabase/functions/_shared/facts/rules/mas-notice-checks.ts'
import {
  SG_PUBLIC_HOLIDAY_DATES,
  SG_PUBLIC_HOLIDAYS,
  SG_PUBLIC_HOLIDAYS_SOURCE,
  sgHolidayListCovers,
} from '../../supabase/functions/_shared/facts/rules/sg-public-holidays.ts'
import {
  ALL_STATEMENT_KEYS,
  createFakeClauseProvider,
  DECIDED_STATEMENT_KEYS_2026_11_24,
  STATEMENT_KEYS,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { formatDateTime, formatGap } from '../../supabase/functions/_shared/facts/update/section-writer.ts'
import { accountSrfCase, cardOnlyCase, EUPG_A_TO, mixedCase, syntheticCorpus } from '../fixtures/fidrec-update/index.ts'

// FIDReC standards brief v5, 4a "Link statements" (decision 20), and the section writer the comparison sections share.

const provider = createFakeClauseProvider(syntheticCorpus)
const account = accountSrfCase.data.payments
const cards = cardOnlyCase.data.payments

// Changed with PR #56: the contract's link group now also holds the two Decision 9 bridge statements.
test('the link and bridge keys are the contract keys', () => {
  assert.deepEqual([...Object.values(LINK_STATEMENT_KEYS), ...Object.values(BRIDGE_STATEMENT_KEYS)], [...STATEMENT_KEYS.link])
})

test('each clause compared calls for its own link statement, or none', () => {
  const table: Array<[string, string | null]> = [
    ['mas.srf/4.2.1', 'link.srf_4_2'],
    ['mas.srf/4.2.5', 'link.srf_4_2'],
    ['mas.srf/4.4', null],
    ['mas.srf/7.9', null],
    ['mas.srf/fn8', null],
    ['mas.eupg/4.7', 'link.eupg_s4'],
    ['mas.eupg/4.26', 'link.eupg_s4'],
    ['mas.eupg/3.14', null],
    ['mas.eupg/7.7', null],
    ['mas.fsm-n07/9', 'bridge.mas_requirement'],
    ['mas.fsm-n05/test', 'bridge.mas_requirement'],
    ['abs.card_code/5', null],
    ['abs.release_20250217/verification', null],
    ['visa.core_rules/11.8.5', null],
  ]
  for (const [clause, link] of table) assert.equal(linkStatementKeyFor(clause), link, clause)
})

test('link statements follow differs lines on account payments only, once each, in order of first use', () => {
  const keys = linkStatementsFor([
    { clauseKey: 'mas.eupg/4.9', outcome: 'matches', group: 'account' },
    { clauseKey: 'mas.srf/4.2.2', outcome: 'differs', group: 'card' },
    { clauseKey: 'mas.eupg/4.10', outcome: 'differs', group: 'account' },
    { clauseKey: 'mas.srf/4.2.3', outcome: 'differs', group: 'account' },
    { clauseKey: 'mas.eupg/4.7', outcome: 'differs', group: 'account' },
    { clauseKey: 'mas.srf/4.2.1', outcome: 'not_shown', group: 'account' },
  ])
  assert.deepEqual(keys, ['link.eupg_s4', 'link.srf_4_2'])
  assert.deepEqual(linkStatementsFor([{ clauseKey: 'mas.eupg/4.10', outcome: 'differs', group: 'card' }]), [])
})

test('payment groups: bank and e-wallet payments are account payments; cards are cards; others are not routed', () => {
  assert.equal(groupOf('account_transfer'), 'account')
  assert.equal(groupOf('ewallet'), 'account')
  assert.equal(groupOf('sg_card'), 'card')
  assert.equal(groupOf('other'), null)
  assert.equal(groupOf(null), null)
})

test('the instrument guard refuses SRF clauses and non-card EUPG paragraphs for card payments', () => {
  for (const key of ['mas.srf/4.2.1', 'mas.srf/7.9', 'mas.eupg/4.7', 'mas.eupg/4.21', 'mas.eupg/4.25', 'mas.eupg/4.26', 'mas.eupg/5.2', 'mas.eupg/3.14']) {
    assert.equal(clauseAppliesToGroup(key, cards), false, key)
    assert.equal(clauseAppliesToGroup(key, account), true, key)
  }
  for (const key of ['mas.eupg/4.10', 'mas.eupg/4.14', 'mas.fsm-n07/9']) assert.equal(clauseAppliesToGroup(key, cards), true, key)
  // A mixed set is refused when any payment is outside the clause.
  assert.equal(clauseAppliesToGroup('mas.eupg/4.7', mixedCase.data.payments), false)
})

test('the writer refuses a guarded clause rather than printing it', async () => {
  const w = new ComparisonWriter('duty_time_checks', { provider, evidenceIds: {} })
  const printed = await w.compare({ clauseKey: 'mas.eupg/4.7', onDate: '2025-09-12', record: 'r', outcome: 'differs', evidenceIds: [], group: 'card', payments: cards })
  assert.equal(printed, false)
  assert.deepEqual(w.result().lines, [])
})

test('a differs line on account payments prints its link statement once; the statement is read for the date', async () => {
  const w = new ComparisonWriter('duty_time_checks', { provider, evidenceIds: {} })
  for (let i = 0; i < 2; i++) {
    await w.compare({ clauseKey: 'mas.eupg/4.7', onDate: '2025-07-03', record: `r${i}`, outcome: 'differs', evidenceIds: ['E4'], group: 'account', payments: account })
  }
  const r = w.result()
  assert.deepEqual(r.lines.map((l) => l.kind), ['comparison', 'statement', 'comparison'])
  const s = r.lines[1]
  assert.ok(s.kind === 'statement')
  assert.equal(s.statement.statementKey, 'link.eupg_s4')
  assert.equal(s.statement.revision, 1)
  assert.equal(s.statement.text, 'Placeholder statement link.eupg_s4, revision 1.')
  assert.deepEqual(s.statement.clauseKeys, ['mas.eupg/4.7'])
  assert.deepEqual(s.statement.evidenceIds, ['E4'])
  assert.deepEqual(r.citations.map((c) => [c.clauseKey, c.versionLabel]), [['mas.eupg/4.7', 'A']])
  assert.deepEqual(r.flags, [])
})

test('after a change of wording the link statement prints as under review and the run is flagged', async () => {
  const w = new ComparisonWriter('duty_time_checks', { provider, evidenceIds: {} })
  await w.compare({ clauseKey: 'mas.eupg/4.7', onDate: EUPG_A_TO, record: 'r', outcome: 'differs', evidenceIds: [], group: 'account', payments: account })
  const r = w.result()
  const s = r.lines[1]
  assert.ok(s.kind === 'statement' && s.statement.text === null && s.statement.revision === null)
  assert.deepEqual(r.flags, [{ code: 'statement_under_review', key: 'link.eupg_s4', onDate: EUPG_A_TO }])
  assert.equal(r.citations[0].versionLabel, 'B')
})

test('a clause not held prints with an empty expected side and one flag per clause and date', async () => {
  const w = new ComparisonWriter('duty_time_checks', { provider, evidenceIds: {} })
  for (let i = 0; i < 2; i++) {
    await w.compare({ clauseKey: 'mas.srf/7.9', onDate: '2025-07-03', record: 'r', outcome: 'matches', evidenceIds: [], group: 'account', payments: account })
  }
  const r = w.result()
  assert.equal(r.lines.length, 2)
  assert.ok(r.lines.every((l) => l.kind === 'comparison' && l.comparison.expected === ''))
  assert.deepEqual(r.flags, [{ code: 'clause_not_held', key: 'mas.srf/7.9', onDate: '2025-07-03' }])
  assert.deepEqual(r.citations, [])
})

// Changed with PR #56: gaps and times print with the shared section writer ("11 hours 59 minutes", "3 July 2025").
test('time helpers: calendar days, business days, durations and times as the record gives them', () => {
  assert.equal(calendarDaysBetween('2025-07-01', '2025-07-31'), 30)
  assert.equal(calendarDaysBetween('2025-02-28', '2025-03-01'), 1)
  assert.equal(businessDaysBetween('2025-07-04', '2025-07-07'), 1, 'Friday to Monday')
  assert.equal(businessDaysBetween('2025-07-07', '2025-08-05'), 21)
  assert.equal(businessDaysBetween('2025-07-07', '2025-08-05', new Set(['2025-07-31'])), 20)
  assert.equal(formatGap(11 * 3_600_000 + 59 * 60_000), '11 hours 59 minutes')
  assert.equal(formatGap(26 * 3_600_000), '1 day 2 hours')
  assert.equal(formatDateTime('2025-07-03T21:06:00+08:00'), '21:06 on 3 July 2025')
  assert.equal(addCalendarDays('2025-07-07', 30), '2025-08-06')
})

// Changed with PR #56 (Decision 9): the proposed keys were agreed. `*.highrisk.wallet` is replaced by the definitions.
test('the statement keys Lane 3 prints are agreed contract keys; no *.highrisk.wallet key is used', () => {
  const used = [...Object.values(TWELVE_HOUR_STATEMENT_KEYS), CARD_OPENING_STATEMENT_KEY, BRIDGE_STATEMENT_KEYS.cardLossSharing, 'mas.reply.20260113.wallet', 'eupg.section8.outofscope']
  for (const key of used) {
    assert.ok((DECIDED_STATEMENT_KEYS_2026_11_24 as readonly string[]).includes(key), key)
    assert.ok((ALL_STATEMENT_KEYS as readonly string[]).includes(key), key)
  }
  assert.ok(!(ALL_STATEMENT_KEYS as readonly string[]).some((k) => k.endsWith('.highrisk.wallet')))
})

// ---------------------------------------------------------------------------------------------------------------
// Singapore public holidays (Decision 11)
// ---------------------------------------------------------------------------------------------------------------

test('the public-holiday list: MOM source, 2024 to 2027, every Sunday holiday followed by its Monday in lieu', () => {
  assert.equal(SG_PUBLIC_HOLIDAYS_SOURCE.publisher, 'Ministry of Manpower')
  assert.ok(SG_PUBLIC_HOLIDAYS_SOURCE.urls.every((u) => u.startsWith('https://www.mom.gov.sg/')))
  const years = new Set(SG_PUBLIC_HOLIDAYS.map((h) => h.date.slice(0, 4)))
  assert.deepEqual([...years], ['2024', '2025', '2026', '2027'])
  for (const h of SG_PUBLIC_HOLIDAYS) {
    const day = new Date(`${h.date}T00:00:00Z`).getUTCDay()
    if (day === 0) {
      const monday = addCalendarDays(h.date, 1)
      assert.ok(SG_PUBLIC_HOLIDAYS.some((x) => x.date === monday && x.inLieuOf === h.date), `Monday after ${h.date}`)
    }
    if (h.inLieuOf) assert.equal(day, 1, h.date)
  }
  assert.equal(SG_PUBLIC_HOLIDAY_DATES.size, SG_PUBLIC_HOLIDAYS.length, 'no date twice')
  assert.ok(sgHolidayListCovers('2025-07-07', '2027-12-31'))
  assert.ok(!sgHolidayListCovers('2023-12-20', '2024-01-10'))
  // National Day 2026 is a Sunday: Monday 10 August is not a business day.
  assert.equal(businessDaysBetween('2026-08-07', '2026-08-11', SG_PUBLIC_HOLIDAY_DATES), 1)
})
