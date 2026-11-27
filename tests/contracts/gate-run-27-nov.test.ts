import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { describeFailures, referenceKinds } from '../../lib/facts'

// Gate run 45867707804 (27 Nov 2026) and Elena's decisions on it. Synthetic values only.
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

