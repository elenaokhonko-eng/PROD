import assert from 'node:assert/strict'
import test from 'node:test'
import {
  businessDaysBetween,
  calendarDaysBetween,
  clauseAppliesToGroup,
  formatDuration,
  formatTime,
  groupOf,
  LINK_STATEMENT_KEYS,
  linkStatementKeyFor,
  linkStatementsFor,
  SectionWriter,
} from '../../supabase/functions/_shared/facts/rules/link-statements.ts'
import { PROPOSED_HIGH_RISK_WALLET_STATEMENT_KEYS } from '../../supabase/functions/_shared/facts/rules/duty-time-checks.ts'
import { PROPOSED_CARD_OPENING_STATEMENT_KEY } from '../../supabase/functions/_shared/facts/rules/mas-notice-checks.ts'
import {
  ALL_STATEMENT_KEYS,
  createFakeClauseProvider,
  STATEMENT_KEYS,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { accountSrfCase, cardOnlyCase, EUPG_A_TO, mixedCase, syntheticCorpus } from '../fixtures/fidrec-update/index.ts'

// FIDReC standards brief v5, 4a "Link statements" (decision 20), and the section writer the comparison sections share.

const provider = createFakeClauseProvider(syntheticCorpus)
const account = accountSrfCase.data.payments
const cards = cardOnlyCase.data.payments

test('the link keys are the contract keys', () => {
  assert.deepEqual(Object.values(LINK_STATEMENT_KEYS), [...STATEMENT_KEYS.link])
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
  const w = new SectionWriter('duty_time_checks', provider)
  const printed = await w.compare({ clauseKey: 'mas.eupg/4.7', onDate: '2025-09-12', record: 'r', outcome: 'differs', evidenceIds: [], group: 'card', payments: cards })
  assert.equal(printed, false)
  assert.deepEqual(w.result().lines, [])
})

test('a differs line on account payments prints its link statement once; the statement is read for the date', async () => {
  const w = new SectionWriter('duty_time_checks', provider)
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
  const w = new SectionWriter('duty_time_checks', provider)
  await w.compare({ clauseKey: 'mas.eupg/4.7', onDate: EUPG_A_TO, record: 'r', outcome: 'differs', evidenceIds: [], group: 'account', payments: account })
  const r = w.result()
  const s = r.lines[1]
  assert.ok(s.kind === 'statement' && s.statement.text === null && s.statement.revision === null)
  assert.deepEqual(r.flags, [{ code: 'statement_under_review', key: 'link.eupg_s4', onDate: EUPG_A_TO }])
  assert.equal(r.citations[0].versionLabel, 'B')
})

test('a clause not held prints with an empty expected side and one flag per clause and date', async () => {
  const w = new SectionWriter('duty_time_checks', provider)
  for (let i = 0; i < 2; i++) {
    await w.compare({ clauseKey: 'mas.srf/7.9', onDate: '2025-07-03', record: 'r', outcome: 'matches', evidenceIds: [], group: 'account', payments: account })
  }
  const r = w.result()
  assert.equal(r.lines.length, 2)
  assert.ok(r.lines.every((l) => l.kind === 'comparison' && l.comparison.expected === ''))
  assert.deepEqual(r.flags, [{ code: 'clause_not_held', key: 'mas.srf/7.9', onDate: '2025-07-03' }])
  assert.deepEqual(r.citations, [])
})

test('time helpers: calendar days, business days, durations and times as the record gives them', () => {
  assert.equal(calendarDaysBetween('2025-07-01', '2025-07-31'), 30)
  assert.equal(calendarDaysBetween('2025-02-28', '2025-03-01'), 1)
  assert.equal(businessDaysBetween('2025-07-04', '2025-07-07'), 1, 'Friday to Monday')
  assert.equal(businessDaysBetween('2025-07-07', '2025-08-05'), 21)
  assert.equal(businessDaysBetween('2025-07-07', '2025-08-05', new Set(['2025-07-31'])), 20)
  assert.equal(formatDuration(11 * 3_600_000 + 59 * 60_000), '11 h 59 min')
  assert.equal(formatDuration(26 * 3_600_000), '1 day 2 h 0 min')
  assert.equal(formatTime('2025-07-03T21:06:00+08:00'), '21:06 on 3 Jul 2025')
})

test('the two proposed keys fit the statement key pattern and are not in the contract yet', () => {
  const proposed = [...Object.values(PROPOSED_HIGH_RISK_WALLET_STATEMENT_KEYS), PROPOSED_CARD_OPENING_STATEMENT_KEY]
  assert.deepEqual(proposed, ['srf.highrisk.wallet', 'eupg.highrisk.wallet', 'bridge.mas_requirement.cards'])
  for (const key of proposed) {
    assert.match(key, /^[a-z0-9_]+(\.[a-z0-9_]+)+$/)
    assert.ok(!(ALL_STATEMENT_KEYS as readonly string[]).includes(key), key)
  }
})
