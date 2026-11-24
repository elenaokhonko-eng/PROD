import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClauseProvider, NO_OUTCOME_LINE_KINDS } from '../../supabase/functions/_shared/facts/update/contract.ts'
import {
  afterTheEventsLine,
  COMPLAINANT,
  datePart,
  deviceRecognitionSentence,
  formatBusinessDays,
  formatCalendarDays,
  formatDate,
  formatDateTime,
  formatGap,
  formatMoney,
  formatMoneyTotal,
  gapBetween,
  GENDERED_PRONOUNS,
  NEAREST_VERSION_FALLBACK,
  SCHEME_STANDING_SENTENCE,
  SectionWriter,
} from '../../supabase/functions/_shared/facts/update/section-writer.ts'
import { accountSrfCase, cardOnlyCase, EUPG_A_TO, mixedCase, syntheticCorpus } from '../fixtures/fidrec-update/index.ts'

// Lane 6 Step 0b: the one section writer (review of 24 Nov 2026, cross-lane finding 3; Decision 2).

const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })

test('dates and times: one format, as the brief examples print them, with no time-zone conversion', () => {
  assert.equal(formatDate('2025-07-03'), '3 July 2025')
  assert.equal(formatDate('2025-12-31T23:59:00+08:00'), '31 December 2025')
  assert.equal(formatDateTime('2025-03-03T21:14:00+08:00'), '21:14 on 3 March 2025')
  // The clock time the record states, not converted to the machine's zone.
  assert.equal(formatDateTime('2025-03-03T21:14:00Z'), '21:14 on 3 March 2025')
  assert.equal(formatDateTime('2025-03-03'), '3 March 2025')
  assert.equal(formatDate('not a date'), 'not a date')
  assert.equal(datePart('2025-09-12T20:10:00+08:00'), '2025-09-12')
  assert.equal(datePart(null), null)
})

test('money: the pack\'s existing format, and totals per currency', () => {
  assert.equal(formatMoney(sgd(7_550)), 'S$7,550')
  assert.equal(formatMoney(sgd(49_999.99)), 'S$49,999.99')
  assert.equal(formatMoney({ amount: 120, currency: 'USD', amountSgd: null }), 'USD 120')
  assert.equal(formatMoneyTotal([sgd(1_980), sgd(2_450), sgd(3_120)]), 'S$7,550')
  assert.equal(formatMoneyTotal([sgd(0.1), sgd(0.2)]), 'S$0.30')
  assert.equal(formatMoneyTotal([sgd(100), { amount: 120, currency: 'USD', amountSgd: null }]), 'S$100 and USD 120')
})

test('gaps: words, rounded down, never printed longer than they were', () => {
  const s = 1000
  const m = 60 * s
  const h = 60 * m
  assert.equal(formatGap(40 * s), '40 seconds')
  assert.equal(formatGap(1 * s), '1 second')
  assert.equal(formatGap(22 * m), '22 minutes')
  assert.equal(formatGap(1 * m), '1 minute')
  assert.equal(formatGap(h), '1 hour')
  assert.equal(formatGap(12 * h - 20 * s), '11 hours 59 minutes')
  assert.equal(formatGap(12 * h), '12 hours')
  assert.equal(formatGap(26 * h + 5 * m), '1 day 2 hours 5 minutes')
  assert.equal(formatGap(-5 * m), '0 seconds')
  assert.equal(gapBetween('2025-09-12T20:10:00+08:00', '2025-09-12T20:32:00+08:00'), 22 * m)
  assert.equal(formatGap(gapBetween('2025-09-12T20:10:00+08:00', '2025-09-12T20:32:00+08:00')!), '22 minutes')
  assert.equal(gapBetween(null, '2025-09-12T20:32:00+08:00'), null)
  assert.equal(formatCalendarDays(1), '1 calendar day')
  assert.equal(formatCalendarDays(30), '30 calendar days')
  assert.equal(formatBusinessDays(21), '21 business days')
})

test('the complainant: one neutral form (Decision 2)', () => {
  assert.deepEqual(COMPLAINANT, {
    noun: 'the complainant',
    Noun: 'The complainant',
    subject: 'they',
    object: 'them',
    possessive: 'their',
    possessivePronoun: 'theirs',
  })
  const sentences = [
    deviceRecognitionSentence('not_mine', 'Phone model EX-300'),
    deviceRecognitionSentence('mine', null),
    deviceRecognitionSentence('not_sure', 'Phone model EX-300'),
    deviceRecognitionSentence(null, null),
  ]
  assert.deepEqual(sentences, [
    "The complainant states that the device labelled 'Phone model EX-300' is not theirs.",
    'The complainant states that this device is theirs.',
    "The complainant states that they are not sure whether the device labelled 'Phone model EX-300' is theirs.",
    'The complainant has not said whether this device is theirs.',
  ])
  for (const line of [...sentences, SCHEME_STANDING_SENTENCE, NEAREST_VERSION_FALLBACK('Visa', '2025-09-12', '2026-10-24'), afterTheEventsLine('2026-01-13')]) {
    assert.doesNotMatch(line, GENDERED_PRONOUNS, line)
  }
})

test('fixed lines defined once: the scheme standing sentence; fallback and after-the-events lines take dates', () => {
  assert.equal(
    SCHEME_STANDING_SENTENCE,
    'Card scheme rules are an agreement between the card scheme and the card issuer. The cardholder is not a party to them. They are shown here as the process available to the issuer.',
  )
  assert.equal(
    NEAREST_VERSION_FALLBACK('Visa', '2025-09-12', '2026-10-24'),
    "This pack does not hold Visa's rules as in force on 12 September 2025. The nearest edition held is dated 24 October 2026. The lines below are from that edition.",
  )
  assert.equal(afterTheEventsLine('2026-01-13'), 'This reply is dated 13 January 2026, after the events in this case.')
})

test('the writer cites each clause once per date, flags what is not held, and prints a statement once per section', async () => {
  const provider = createFakeClauseProvider(syntheticCorpus)
  const w = new SectionWriter('duty_time_checks', { provider, evidenceIds: accountSrfCase.data.evidenceIds })

  assert.ok(await w.clause('mas.eupg/4.7', '2025-07-03'))
  assert.ok(await w.clause('mas.eupg/4.7', '2025-07-03'))
  assert.ok(await w.clause('mas.eupg/4.7', EUPG_A_TO))
  assert.equal(await w.clause('mas.srf/4.2.5', '2025-06-15'), null)
  assert.equal(await w.clause('mas.srf/4.2.5', '2025-06-15'), null)
  assert.deepEqual(w.citations.map((c) => `${c.clauseKey}@${c.onDate}:${c.versionLabel}`), [
    'mas.eupg/4.7@2025-07-03:A',
    `mas.eupg/4.7@${EUPG_A_TO}:B`,
  ])
  assert.deepEqual(w.flags, [{ code: 'clause_not_held', key: 'mas.srf/4.2.5', onDate: '2025-06-15' }])

  assert.equal(await w.statement('srf.newdevice.bank', '2025-07-03', ['E4']), true)
  assert.equal(await w.statement('srf.newdevice.bank', '2025-07-03', ['E4']), false, 'once per section')
  assert.equal(await w.statement('link.eupg_s4', EUPG_A_TO), false, 'no approved revision for this wording')
  const statements = w.lines.filter((l) => l.kind === 'statement')
  assert.equal(statements.length, 2)
  assert.ok(w.flags.some((f) => f.code === 'statement_under_review' && f.key === 'link.eupg_s4'))

  w.text('A fixed line.', { step: 2, evidenceIds: ['E4'] })
  w.conduct({ kind: 'does_not_refer_to', marker: 'app_installed', documentKey: 'mas.eupg', clauseKey: null, onDate: '2025-07-03' })
  w.record({ time: '21:06 on 3 July 2025' }, ['E4'])
  const result = w.result()
  assert.equal(result.sectionId, 'duty_time_checks')
  assert.deepEqual(result.lines.map((l) => l.kind), ['statement', 'statement', 'text', 'conduct', 'record'])
  assert.deepEqual(w.evidence('transactions', 'access_events', 'transactions'), ['E1', 'E4'])
})

test('the writer reads the nearest version with a flag, and attaches the after-the-events date to a statement', async () => {
  const provider = createFakeClauseProvider(syntheticCorpus)
  const w = new SectionWriter('card_dispute_comparison', { provider, evidenceIds: cardOnlyCase.data.evidenceIds })
  const inForce = await w.nearestClause('mas.eupg/4.7', '2025-09-12')
  assert.equal(inForce?.relation, 'in_force')
  assert.equal(w.flags.length, 0)
  const nearest = await w.nearestClause('mas.eupg/4.7', '2024-01-01')
  assert.equal(nearest?.relation, 'later_version')
  assert.deepEqual(w.flags, [{ code: 'nearest_version_held', key: 'mas.eupg/4.7', onDate: '2024-01-01' }])
  assert.equal(await w.nearestClause('mas.eupg/none', '2025-09-12'), null)
  assert.ok(w.flags.some((f) => f.code === 'clause_not_held' && f.key === 'mas.eupg/none'))

  await w.statement('eupg.fault.term', '2025-09-12', [], { documentDatedAfterEvents: '2026-01-13' })
  const line = w.lines.find((l) => l.kind === 'statement')
  assert.ok(line && line.kind === 'statement')
  assert.equal(line.statement.documentDatedAfterEvents, '2026-01-13')
})

test('a quoted reply prints word for word with its date and clause reference, no outcome, after-the-events date set', async () => {
  const provider = createFakeClauseProvider({
    versions: [{
      version_id: 'ver-test-reply',
      document_key: 'test.reply_20260113',
      title: 'Synthetic written reply',
      publisher: 'Synthetic regulator',
      binding_level: 'announcement',
      institution: null,
      card_scheme: null,
      document_instrument_scope: ['account_transfer', 'sg_card', 'ewallet'],
      version_label: '2026-01-13',
      effective_from: '2026-01-13',
      effective_to: null,
      status: 'verified',
      source_url: 'https://example.com/reply',
      coverage: 'full',
      as_of_rule: 'any_date',
      clauses: [
        { clause_id: 'cl-r1', clause_key: 'test.reply_20260113/1', clause_ref: '1', text_content: 'Placeholder sentence one.', text_sha256: 'f'.repeat(64) },
        { clause_id: 'cl-r2', clause_key: 'test.reply_20260113/2', clause_ref: '2', text_content: 'Placeholder sentence two.', text_sha256: '0'.repeat(64) },
      ],
    }],
    statements: [],
  })
  const w = new SectionWriter('industry_practice_comparison', { provider, evidenceIds: {} })
  const printed = await w.quotation({
    documentKey: 'test.reply_20260113',
    clauseKeys: ['test.reply_20260113/1', 'test.reply_20260113/2', 'test.reply_20260113/9'],
    eventDate: '2025-09-12',
    generatedOn: '2026-11-24',
    caseEventDates: ['2025-09-12', '2025-10-20'],
    introStatementKey: 'mas.reply.20260113.wallet',
  })
  assert.equal(printed, true)
  const line = w.lines[0]
  assert.ok(line.kind === 'quotation')
  assert.ok(!('outcome' in line.quotation))
  assert.deepEqual(line.quotation.passages.map((p) => [p.clauseRef, p.text]), [['1', 'Placeholder sentence one.'], ['2', 'Placeholder sentence two.']])
  assert.equal(line.quotation.documentDate, '2026-01-13')
  assert.equal(line.quotation.readOn, '2026-11-24')
  assert.equal(line.quotation.documentDatedAfterEvents, '2026-01-13')
  assert.equal(line.quotation.sourceUrl, 'https://example.com/reply')
  assert.equal(line.quotation.intro?.text, null, 'intro statement not approved yet: under review')
  assert.ok(w.flags.some((f) => f.code === 'clause_not_held' && f.key === 'test.reply_20260113/9'))
  assert.ok(w.flags.some((f) => f.code === 'statement_under_review' && f.key === 'mas.reply.20260113.wallet'))
  assert.equal(w.citations.length, 2)
  assert.ok(NO_OUTCOME_LINE_KINDS.includes('quotation'))

  // Generated before the reply existed: nothing prints.
  const early = new SectionWriter('industry_practice_comparison', { provider, evidenceIds: {} })
  assert.equal(await early.quotation({ documentKey: 'test.reply_20260113', clauseKeys: ['test.reply_20260113/1'], eventDate: '2025-09-12', generatedOn: '2026-01-12', caseEventDates: ['2025-09-12'] }), false)
  assert.equal(early.lines.length, 0)
})

test('card events carry the amount the record states; payment lines match the transactions in the fixtures', () => {
  for (const c of [cardOnlyCase, mixedCase]) {
    for (const e of c.data.facts.card_auth_events!.value!) {
      if (e.transactionIndex === null) assert.equal(e.amount, null)
      else assert.deepEqual(e.amount, c.data.payments[e.transactionIndex].amount)
    }
  }
})
