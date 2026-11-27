import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  answerCandidates,
  assembleFidrecPack,
  FINAL_REPLY_EXPIRED_NOTE,
  fidrecPackFallback,
  fidrecRouteFromFacts,
  type SnapshotFacts,
} from '../../lib/facts'
import {
  FIDREC_BEFORE_PAYMENT,
  FIDREC_NOT_COMPLAINED,
  fidrecTimelineCheck,
  fidrecTimelineResponses,
  fidrecWaitingText,
  readFidrecTimeline,
  type FidrecTimeline,
} from '../../lib/journey/fidrec-timeline'

// CR-2, "FIDReC pack: sold upfront, questionnaire after payment" (docs/release/cr-2-one-dashboard-flow.md, amended
// 27 Nov 2026). Synthetic dates only.
const today = '2026-11-27'

const SITUATIONS: Array<{ name: string; answers: FidrecTimeline; expected: Record<string, unknown> }> = [
  {
    name: 'the bank has answered and the matter is not resolved',
    answers: { complained: true, complaintDate: '2026-11-20', answered: 'answer', replyDate: '2026-11-24', final: false },
    expected: { available: true, route: 'answered' },
  },
  {
    name: 'four weeks have passed since the written complaint',
    answers: { complained: true, complaintDate: '2026-10-30', answered: 'no', replyDate: null, final: null },
    expected: { available: true, route: 'four_weeks' },
  },
  {
    name: 'complained, no answer yet, under four weeks',
    answers: { complained: true, complaintDate: '2026-11-14', answered: 'no', replyDate: null, final: null },
    expected: { available: false, reason: 'fidrec_too_early', complaintDate: '2026-11-14', availableFrom: '2026-12-12' },
  },
  {
    name: 'not complained to the bank in writing yet',
    answers: { complained: false, complaintDate: null, answered: null, replyDate: null, final: null },
    expected: { available: false, reason: 'complaint_not_raised' },
  },
  {
    name: 'a final reply more than six months old',
    answers: { complained: true, complaintDate: '2026-02-01', answered: 'answer', replyDate: '2026-04-01', final: true },
    expected: { available: true, route: 'final_reply', deadline: '2026-10-01' },
  },
]

// The generator works from the confirmed facts, which the questionnaire's answers reach through the same mapping the
// confirm step uses. Every candidate is taken as confirmed.
function factsFrom(answers: FidrecTimeline): SnapshotFacts {
  const rows = fidrecTimelineResponses(answers).map((r) => ({ questionKey: r.question_key, value: r.response_value, revisionId: 'r1' }))
  return Object.fromEntries(answerCandidates(rows).candidates.map((c) => [c.factKey, { value: c.value, label: 'confirmed' }])) as SnapshotFacts
}

for (const { name, answers, expected } of SITUATIONS) {
  test(`${name}: the questionnaire's outcome, and the generator agrees`, () => {
    const check = fidrecTimelineCheck(answers, today)
    for (const [key, value] of Object.entries(expected)) assert.equal((check as Record<string, unknown>)[key], value, key)
    assert.deepEqual(fidrecRouteFromFacts(factsFrom(answers), today), check)
  })
}

test('the approved wording, exactly as written', () => {
  assert.equal(FIDREC_BEFORE_PAYMENT, 'FIDReC takes a complaint after you have complained to your bank, and the bank has answered or four weeks have passed. If that is not yet your situation, your pack waits for you until it is.')
  assert.equal(
    fidrecWaitingText('2026-11-14', '2026-12-12'),
    "FIDReC takes a complaint once your bank has answered and the matter is not resolved, or four weeks after your written complaint (Rule 13(1)(i)). Your written complaint is dated 14 Nov 2026, so the four weeks end on 12 Dec 2026. You can wait for your bank's reply, or write to your bank now and ask for its answer. Your pack is ready to generate as soon as either happens.",
  )
  assert.equal(FIDREC_NOT_COMPLAINED, 'FIDReC sends back a dispute that was not first raised with the bank (Rule 4(2)). The Bank dispute pack prepares that written complaint from your facts. Send it to your bank, then come back here when your bank replies, or when its reply does not resolve the matter. Your FIDReC pack waits for you.')
  const doc = readFileSync('components/state-machine/facts/fidrec-timeline.tsx', 'utf8') + readFileSync('components/state-machine/transition/fidrec-offer.tsx', 'utf8')
  assert.doesNotMatch(doc, /refund/i, 'no screen offers a refund')
  assert.doesNotMatch(doc + FIDREC_NOT_COMPLAINED, /restart|new six months|reset the/i, 'nothing says a new letter restarts the six months')
})

test('the answers are read back as they were given, and a changed answer leaves nothing behind', () => {
  const rows = (t: FidrecTimeline) => fidrecTimelineResponses(t)
  for (const { answers } of SITUATIONS) assert.deepEqual(readFidrecTimeline(rows(answers)), answers)
  assert.equal(readFidrecTimeline([]), null)
  assert.equal(readFidrecTimeline([{ question_key: 'journey_written_complaint', response_value: 'yes' }]), null, 'answered before payment does not count')
  const none = Object.fromEntries(rows(SITUATIONS[3].answers).map((r) => [r.question_key, r.response_value]))
  for (const key of ['journey_written_complaint_date', 'journey_bank_reply_status', 'journey_bank_reply_date', 'journey_bank_reply_outcome', 'journey_final_reply_qualifies', 'fidrec_route', 'fidrec_final_reply_date', 'fidrec_complaint_date']) {
    assert.equal(none[key], '', key)
  }
  // A written complaint is a report to the bank; "not yet" says nothing about whether the bank was told.
  assert.equal(Object.fromEntries(rows(SITUATIONS[0].answers).map((r) => [r.question_key, r.response_value])).journey_reported_to_bank, 'yes')
  assert.ok(!('journey_reported_to_bank' in none))
})

test('the questionnaire keeps what it does not ask about while a reply stands', () => {
  // The outcome given earlier ("rejected") is a fact of the case: saving the timeline must not erase it.
  for (const answers of [SITUATIONS[0].answers, SITUATIONS[4].answers]) {
    const keys = fidrecTimelineResponses(answers).map((r) => r.question_key)
    assert.ok(!keys.includes('journey_bank_reply_outcome'))
    assert.equal(keys.includes('journey_final_reply_qualifies'), answers.final !== true)
  }
})

test('an old final reply is generated, and the pack states both dates, the rules and the passage once', () => {
  const facts = factsFrom(SITUATIONS[4].answers)
  const pack = assembleFidrecPack({
    prose: fidrecPackFallback(facts), source: 'model', facts, findings: [], evidenceIndex: [],
    route: fidrecRouteFromFacts(facts, today), finalReplyUsed: false, today,
  })
  assert.ok(pack.route.startsWith('The final reply you told us about is dated 1 Apr 2026. Six months from that date ended on 1 Oct 2026 (Rule 13(1)(ii); Rule 5(vi)). '), pack.route)
  assert.equal(pack.route.split(FINAL_REPLY_EXPIRED_NOTE).length, 2, 'the passage, once')
  assert.equal(pack.route.split('1 Apr 2026').length, 2, 'the date, once')
})

test('a pack for an answered complaint says which route it is on', () => {
  const facts = factsFrom(SITUATIONS[0].answers)
  const pack = assembleFidrecPack({
    prose: fidrecPackFallback(facts), source: 'model', facts, findings: [], evidenceIndex: [],
    route: fidrecRouteFromFacts(facts, today), finalReplyUsed: false, today,
  })
  assert.ok(pack.route.startsWith('The institution has answered the complaint and the matter is not resolved (Rule 13(1)(i)). '), pack.route)
})

test('sold upfront: no question before Stripe, and no route check on the sale', () => {
  const offer = readFileSync('components/state-machine/transition/fidrec-offer.tsx', 'utf8')
  assert.match(offer, /\{FIDREC_BEFORE_PAYMENT\}/)
  assert.doesNotMatch(offer, /type="radio"|onSaveRoute/)
  const readiness = readFileSync('lib/billing/product-readiness.ts', 'utf8')
  assert.doesNotMatch(readiness, /agreeWithGenerator|case_fact_snapshots/)
  const sql = readFileSync('supabase/migrations/20261128120000_fidrec_sold_upfront.sql', 'utf8')
  assert.doesNotMatch(sql, /'complaint_not_raised'|'fidrec_too_early'|'fidrec_window_expired'|question_key/)
  assert.match(sql, /'already_purchased'/)
  assert.match(sql, /'story_missing'/)
})

test('after payment the questionnaire comes first, before the story and before anything is generated', () => {
  const newCase = readFileSync('app/(case)/app/case/new/page.tsx', 'utf8')
  assert.match(newCase, /escalation_pack/)
  assert.match(newCase, /<NewCaseSteps/)
  const steps = readFileSync('app/(case)/app/case/new/_components/new-case-steps.tsx', 'utf8')
  assert.ok(steps.indexOf('<FidrecTimelineForm') < steps.indexOf('<NarrativeCapture'))
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /<FidrecTimelineForm/)
  assert.match(dashboard, /<FidrecWaiting/)
})
