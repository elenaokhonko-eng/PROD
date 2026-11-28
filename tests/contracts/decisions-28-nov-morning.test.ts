import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { useStateMachine, type StateMachineInput } from '../../hooks/state-machine/use-state-machine'
import { nothingToBuy } from '../../lib/journey/pack-case'
import { journeyQuestionPlan } from '../../lib/journey/journey-plan'
import { documentLimit, MAX_PDF_PAGES, sortSelection, UPLOAD_TOO_MANY_PAGES_MESSAGE, UPLOAD_TOO_LARGE_MESSAGE } from '../../lib/upload-limits'

// Elena's decisions of the morning of 28 Nov 2026. Synthetic names only.
const read = (file: string) => readFileSync(file, 'utf8')

const base: StateMachineInput = {
  reportPurchase: null,
  validation: null,
  gapItems: [],
  narratives: null,
  entitlementPlan: 'free',
  documents: [],
  decision: null,
  report: null,
}
const evaluated = { tier0_summary: { id: 'n1' }, tier0_evidence_checklist: null, tier0_srf_signal: null, other: [] } as never

test('a pack with no free evaluation asks the free evaluation’s questions before the facts', () => {
  for (const [pack, confirm] of [
    [{ bankPackOwned: true }, 'L2-ConfirmBankFacts'],
    [{ fidrecPackOwned: true }, 'L3-ConfirmFidrecFacts'],
  ] as const) {
    assert.equal(useStateMachine({ ...base, ...pack, journeyAnswered: false, intakeAnswered: false }), 'S1-Journey')
    assert.equal(useStateMachine({ ...base, ...pack, journeyAnswered: true, intakeAnswered: false }), 'S1-IntakeForm')
    assert.equal(useStateMachine({ ...base, ...pack, journeyAnswered: true, intakeAnswered: true }), confirm)
    assert.equal(useStateMachine({ ...base, ...pack, narratives: evaluated, journeyAnswered: false, intakeAnswered: false }), confirm, 'a free evaluation was made: not asked again')
  }
})

test('the FIDReC timeline comes before those questions, and a waiting pack shows its wait', () => {
  const fidrec = { ...base, fidrecPackOwned: true, journeyAnswered: false, intakeAnswered: false }
  assert.equal(useStateMachine({ ...fidrec, fidrecTimelineAnswered: false }), 'L3-ConfirmFidrecFacts')
  assert.equal(useStateMachine({ ...fidrec, fidrecTimelineAnswered: true, fidrecWaiting: true }), 'L3-ConfirmFidrecFacts')
})

test('the questions the FIDReC timeline already answered are not asked twice', () => {
  assert.deepEqual(journeyQuestionPlan(null), { askComplaint: true, askReply: true, replyIsFinal: false, initial: {} })
  const timeline = { complained: true, complaintDate: '2026-10-05', reply: 'answer', replyDate: '2026-10-20', final: true } as never
  assert.deepEqual(journeyQuestionPlan(timeline), {
    askComplaint: false,
    askReply: false,
    replyIsFinal: true,
    initial: { journey_reported_to_bank: 'yes' },
  })
  const dashboard = read('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx')
  assert.match(dashboard, /<JourneyQuestions timeline=/)
  assert.match(read('hooks/state-machine/facts/use-journey-answered.ts'), /JOURNEY_KEYS\.policeReport/)
})

test('a paid buyer is not told the questions are the free triage', () => {
  assert.match(read('components/state-machine/layer1/intake-form.tsx'), /paid \? '' : ' This is the free triage — no charge\.'/)
})

test('choosing a case: a FIDReC case is never asked to pay; a bank pack case can add the FIDReC pack', () => {
  const none = { bankOwned: false, fidrecOwned: false }
  const bank = { bankOwned: true, fidrecOwned: false }
  const fidrec = { bankOwned: false, fidrecOwned: true }
  assert.equal(nothingToBuy('bank', none), false)
  assert.equal(nothingToBuy('fidrec', none), false)
  assert.equal(nothingToBuy('fidrec', bank), false, 'upgrade')
  assert.equal(nothingToBuy('bank', bank), true)
  assert.equal(nothingToBuy('fidrec', fidrec), true)
  assert.equal(nothingToBuy('bank', fidrec), true)
  assert.match(read('app/(case)/app/pack/[pack]/page.tsx'), /nothingToBuy\(pack/)
  assert.match(read('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx'), /'S1-Tier0DraftPending', 'L2-ConfirmBankFacts'\]/)
})

test('10 documents of 15 pages for the evaluation and both packs', () => {
  assert.equal(MAX_PDF_PAGES, 15)
  assert.deepEqual(documentLimit({}), { max: 10, of: 'evaluation' })
  assert.deepEqual(documentLimit({ allow_self_serve_report: true }), { max: 10, of: 'pack' })
  assert.deepEqual(documentLimit({ allow_escalation_pack: true }), { max: 10, of: 'pack' })
})

test('the screen checks a selection before sending it, and one refused file does not stop the rest', () => {
  const file = (name: string, pages: number | null = 1, size = 1000) => ({ name, pages, size })
  const sorted = sortSelection(
    [file('a.pdf'), file('long.pdf', 16), file('big.pdf', 1, 16 * 1024 * 1024), file('b.pdf'), file('c.pdf')],
    8,
    { max: 10, of: 'evaluation' },
  )
  assert.deepEqual(sorted.send.map((f) => f.name), ['a.pdf', 'b.pdf'])
  assert.deepEqual(sorted.refused, [
    { name: 'long.pdf', fault: 'too_long', message: UPLOAD_TOO_MANY_PAGES_MESSAGE },
    { name: 'big.pdf', fault: null, message: UPLOAD_TOO_LARGE_MESSAGE },
    { name: 'c.pdf', fault: 'too_many', message: 'You can add up to 10 documents for this evaluation.' },
  ])
  const hook = read('hooks/state-machine/layer1/use-upload-evidence.ts')
  assert.match(hook, /sortSelection\(/)
  assert.match(hook, /continue/)
  assert.match(hook, /onSettled/)
  assert.match(hook, /\/api\/evidence\/refusal/)
})

test('two uploads at once cannot pass the document limit: the count is taken again after saving', () => {
  const route = read('app/api/evidence/upload/route.ts')
  const saved = route.indexOf('"register_evidence_upload_v1"')
  assert.ok(route.indexOf('heldAfterSaving > limit.max') > saved)
  assert.match(route.slice(saved), /from\("evidence"\)\.delete\(\)\.eq\("id"/)
})
