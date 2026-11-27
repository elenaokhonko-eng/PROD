import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { describeFailures, referenceKinds } from '../../lib/facts'
import { fidrecRouteResponses } from '../../lib/journey/fidrec-route-answers'

// Gate run 45867707804 (27 Nov 2026) and Elena's decisions on it. Synthetic values only.
const values = (rows: ReturnType<typeof fidrecRouteResponses>) => Object.fromEntries(rows.map((r) => [r.question_key, r.response_value]))

test('a changed route answer clears what the earlier answer filled in', () => {
  // The failed run: a written complaint left from the earlier answer, dated after the final reply chosen next.
  const toFinal = values(fidrecRouteResponses({ fidrec_route: 'final_reply', fidrec_final_reply_date: '2026-11-17' }, { route: 'no_reply', date: '2026-11-24' }))
  assert.equal(toFinal.journey_written_complaint, '')
  assert.equal(toFinal.journey_written_complaint_date, '')
  assert.equal(toFinal.journey_bank_reply_date, '2026-11-17')
  // A complaint dated before the final reply contradicts nothing and stays.
  const consistent = values(fidrecRouteResponses({ fidrec_route: 'final_reply', fidrec_final_reply_date: '2026-11-10' }, { route: 'no_reply', date: '2026-10-04' }))
  assert.ok(!('journey_written_complaint' in consistent))
  for (const next of [{ fidrec_route: 'no_reply', fidrec_complaint_date: '2026-10-04' }, { fidrec_route: 'not_complained' }]) {
    const rows = values(fidrecRouteResponses(next as Record<string, string>, { route: 'final_reply', date: '2026-11-10' }))
    assert.equal(rows.journey_bank_reply_status, '', next.fidrec_route)
    assert.equal(rows.journey_bank_reply_date, '', next.fidrec_route)
  }
  const withdrawn = values(fidrecRouteResponses({ fidrec_route: 'not_complained' }, { route: 'no_reply', date: '2026-10-04' }))
  assert.equal(withdrawn.journey_written_complaint, '')
  // The first answer, or the same route with a new date, clears nothing.
  assert.deepEqual(Object.keys(values(fidrecRouteResponses({ fidrec_route: 'not_complained' }, null))), ['fidrec_route'])
  const sameRoute = values(fidrecRouteResponses({ fidrec_route: 'no_reply', fidrec_complaint_date: '2026-10-05' }, { route: 'no_reply', date: '2026-10-04' }))
  assert.equal(sameRoute.journey_written_complaint_date, '2026-10-05')
  for (const file of ['app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'app/(case)/app/pack/[pack]/_components/pack-first-client.tsx']) {
    assert.match(readFileSync(file, 'utf8'), /fidrecRouteResponses\(answers, [a-zA-Z.]*(route|fidrecRouteQuery)[a-zA-Z.]*\.data/, file)
  }
})

test('the kind of a rejected reference says where it came from, never what it is', () => {
  const kinds = referenceKinds(['FSM-N08', 'TEST-1111', 'ZZ-99', 'AB-12'], {
    documents: 'Synthetic letter, reference TEST-1111.',
    story: 'I was given AB-12 by the caller.',
    ruleClauses: 'MAS Notice FSM-N08 on technology risk.',
  })
  assert.deepEqual(kinds, ['rule_clause', 'document', 'not_found', 'story'])
})

test('the retry tells the AI to rewrite without a reference that is not in the confirmed facts', () => {
  assert.equal(
    describeFailures([{ check: 'reference', detail: 'ZZ-99' }]),
    '- reference: your draft included a reference that is not in the confirmed facts (ZZ-99); rewrite without it',
  )
  assert.equal(describeFailures([{ check: 'date', detail: '1 Jan 2026' }]), '- date: 1 Jan 2026')
})

test('the FIDReC pack is never delivered in its fixed wording', () => {
  const fn = readFileSync('supabase/functions/run_fidrec_pack_v1/index.ts', 'utf8')
  const refusal = fn.indexOf('if (result.source === "fallback") {')
  const commit = fn.indexOf('rpc("commit_fidrec_pack_v1"')
  assert.ok(refusal > 0 && refusal < commit, 'refused before anything is committed')
  assert.match(fn.slice(refusal, commit), /reason: "output_validation_failed"/)
  assert.match(fn, /reference_kinds: referenceKinds\(/)
  // The screen already says so and offers another try.
  const screen = readFileSync('components/state-machine/facts/confirm-and-evaluate.tsx', 'utf8')
  assert.match(screen, /reason === 'output_validation_failed'\s+\? copy\.failedReason/)
  assert.match(screen, /generate\.mutate\(snapshotId\)\}>Try again/)
})
