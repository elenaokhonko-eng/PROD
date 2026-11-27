import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assembleBankPack,
  assembleFidrecPack,
  BANK_PACK_CHECKS,
  bankPackFallback,
  describeReferenceSource,
  fidrecPackFallback,
  fidrecRouteFromFacts,
  NO_CLAUSE_MATCHED_NOTE,
  produceChecked,
  type SnapshotFacts,
  validateOutput,
} from '../../lib/facts'
import { fidrecTimelineCheck, fidrecTimelineResponses, readFidrecTimeline, type FidrecTimeline } from '../../lib/journey/fidrec-timeline'

// Elena's approvals of 27 Nov 2026 on the decision sheet (items 1-5, 12, 13, 16). Synthetic values only.
const read = (file: string) => readFileSync(file, 'utf8')
const today = '2026-11-27'

test('only an answer opens the early route: "still looking into it" does not', () => {
  const base = { complained: true, complaintDate: '2026-11-14', replyDate: null, final: null }
  const looking: FidrecTimeline = { ...base, answered: 'looking' }
  assert.deepEqual(fidrecTimelineCheck(looking, today), { available: false, reason: 'fidrec_too_early', availableFrom: '2026-12-12', complaintDate: '2026-11-14' })
  assert.equal((fidrecTimelineCheck({ ...base, answered: 'answer', final: false, replyDate: '2026-11-20' }, today) as { route?: string }).route, 'answered')
  assert.deepEqual(readFidrecTimeline(fidrecTimelineResponses(looking)), looking)
  // The same on the confirmed facts: an interim reply is not an answer.
  const facts = {
    written_complaint_sent: { value: { value: 'yes', date: '2026-11-14', reference: null, channel: null }, label: 'confirmed' },
    bank_reply: { value: { status: 'interim', date: null, outcome: null, qualifies: null, reference: null }, label: 'confirmed' },
  } as unknown as SnapshotFacts
  assert.equal(fidrecRouteFromFacts(facts, today).available, false)
  const form = read('components/state-machine/facts/fidrec-timeline.tsx')
  for (const option of ['Yes, it gave its answer', 'It said it is still looking into it', 'No, not yet']) assert.ok(form.includes(option), option)
})

test('both pack failure messages end at the email address, and neither offers a refund', () => {
  const screen = read('components/state-machine/facts/confirm-and-evaluate.tsx')
  for (const pack of ['Bank dispute pack', 'FIDReC pack']) {
    assert.ok(screen.includes(`'We couldn’t complete your ${pack} this time. You can try again now. If it still doesn’t work, email info@guidebuoyai.sg.'`), pack)
  }
  assert.doesNotMatch(screen, /refund/i)
})

test('the bank pack is never delivered in its fixed wording', () => {
  const fn = read('supabase/functions/run_bank_pack_v1/index.ts')
  const refusal = fn.indexOf('if (result.source === "fallback") {')
  assert.ok(refusal > 0 && refusal < fn.indexOf('rpc("commit_bank_pack_v1"'), 'refused before anything is committed')
  assert.match(fn.slice(refusal), /reason: "output_validation_failed"/)
})

test('a blocked reference is described by where it comes from; an invented one is not', () => {
  const documents = [
    { id: 'E2', label: 'a letter or email from your bank (uploaded)', type: 'BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL', text: 'Synthetic letter. Our reference TST-100.' },
  ]
  const story = 'The caller quoted STY-200 to me.'
  const fidrec = (ref: string) => describeReferenceSource(ref, { documents, story, voice: 'complainant' })
  const bank = (ref: string) => describeReferenceSource(ref, { documents, story, voice: 'first_person' })
  assert.equal(fidrec('TST-100'), 'the reference shown in the institution’s letter (E2)')
  assert.equal(fidrec('STY-200'), 'a reference given in the complainant’s account, with no supporting document')
  assert.equal(bank('TST-100'), 'the reference shown in your letter or email')
  assert.equal(bank('STY-200'), 'a reference I gave in my account, with no supporting document')
  assert.equal(fidrec('INV-999'), null)
  assert.equal(fidrec('TST-10'), null, 'part of another reference is not a match')
})

test('the sentence stays, with the description where the number was; an invented one is rewritten', async () => {
  const describe = (ref: string) => (ref === 'STY-200' ? 'a reference given in the complainant’s account, with no supporting document' : null)
  const run = async (text: string) => {
    const calls: Array<string | null> = []
    const result = await produceChecked<string>({
      facts: {},
      options: {},
      generate: async (previous) => {
        calls.push(previous)
        return text
      },
      mapText: (s, fn) => fn(s),
      texts: (s) => [s],
      fallback: () => 'fallback',
      describeReference: describe,
    })
    return { result, calls }
  }
  const described = await run('The caller quoted STY-200 during the call.')
  assert.equal(described.result.source, 'model')
  assert.equal(described.result.output, 'The caller quoted a reference given in the complainant’s account, with no supporting document during the call.')
  assert.equal(described.calls.length, 1)
  assert.deepEqual(described.result.rejectedReferences, ['STY-200'], 'still counted for the log')
  const invented = await run('The caller quoted INV-999 during the call.')
  assert.equal(invented.result.source, 'fallback')
  assert.match(invented.calls[1] ?? '', /rewrite without it/)
  for (const file of ['supabase/functions/run_fidrec_pack_v1/index.ts', 'supabase/functions/run_bank_pack_v1/index.ts']) {
    assert.match(read(file), /describeReference: \(ref\) => describeReferenceSource\(/, file)
  }
})

test('the bank pack removes no sentence: saying no complaint was sent is rewritten by the AI', () => {
  const text = 'I have not yet sent a written complaint. I ask the bank to look into the payments.'
  assert.ok(validateOutput([text], {}, { forbidden: BANK_PACK_CHECKS.forbidden }).some((f) => f.check === 'forbidden'))
  const pack = assembleBankPack({ prose: { ...bankPackFallback({}), executive_summary: text }, source: 'model', facts: {}, findings: [] })
  assert.equal(pack.executive_summary, text, 'nothing is taken out after the checks')
})

test('the screen shows every payment', () => {
  const view = read('components/state-machine/layer2/report-view.tsx')
  assert.doesNotMatch(view, /disputed_transactions\.slice\(|Showing first/)
})

test('the FIDReC pack is not delivered when the rule lookup fails, and says so when no clause applies', () => {
  const fn = read('supabase/functions/run_fidrec_pack_v1/index.ts')
  const lookup = fn.slice(fn.indexOf('clauses = await retrieveClauses('), fn.indexOf('const quotables'))
  assert.match(lookup, /reason: "output_validation_failed"[\s\S]*422/)
  const pack = (clauses: never[] | undefined) => assembleFidrecPack({
    prose: fidrecPackFallback({}), source: 'model', facts: {}, findings: [], evidenceIndex: [],
    route: { available: true, route: 'four_weeks', deadline: null }, finalReplyUsed: false, clauses, today,
  })
  assert.equal(NO_CLAUSE_MATCHED_NOTE, 'No rule clause was matched to the payments in this case.')
  assert.equal(pack([]).duties_note, NO_CLAUSE_MATCHED_NOTE)
  assert.match(read('components/state-machine/layer3/fidrec-pack-view.tsx'), /pack\.institution_duties\?\.length \|\| pack\.duties_note/)
  assert.match(read('lib/server/facts/fidrec-pack-pdf.ts'), /pack\.institution_duties\?\.length \|\| pack\.duties_note/)
})
