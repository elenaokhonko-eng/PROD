import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { describeFailures, dutyFailures, evidenceIdFailures, isHardCheck, produceChecked, type FidrecPackProse } from '../../lib/facts'

// Faults found on 28 Nov 2026. Synthetic values only.
const read = (file: string) => readFileSync(file, 'utf8')
const index = [{ id: 'E1', documentId: 'd1', label: 'your bank statement (uploaded)', facts: [] }]
const prose = (evidence: string[]) => ({
  title: 't', executive_summary: 'e', claimant_position: 'c', institution_position: 'i',
  arguments_for_claimant: [{ text: 'a point', evidence_ids: evidence }],
  arguments_for_institution: [],
  institution_duties: [{ text: 'a duty', clause_ids: [], evidence_ids: [] }],
}) as FidrecPackProse

test('a bad citation has its own name and its own instruction, never "rewrite without it"', async () => {
  const failures = [...evidenceIdFailures(prose(['E9']), index), ...evidenceIdFailures(prose([]), index), ...dutyFailures(prose(['E1']), [], {}, {})]
  assert.ok(failures.length >= 3)
  assert.deepEqual([...new Set(failures.map((f) => f.check))], ['citation'])
  assert.ok(isHardCheck('citation'))
  const said = describeFailures(failures)
  assert.match(said, /add or correct the citation/)
  assert.doesNotMatch(said, /rewrite without it|reference that is not in the confirmed facts/)
  // The "reference shown in …" wording is for a real reference number only, and only that is logged as one.
  const described: string[] = []
  const result = await produceChecked<string>({
    facts: {}, options: {}, generate: async () => 'text', mapText: (s, fn) => fn(s), texts: (s) => [s], fallback: () => 'f',
    extraChecks: () => [{ check: 'citation', detail: 'evidence IDs not in the index: E9' }],
    describeReference: (ref) => { described.push(ref); return 'x' },
  })
  assert.deepEqual(described, [])
  assert.deepEqual(result.rejectedReferences, [])
  assert.deepEqual(result.firedChecks, [['citation'], ['citation']])
})

test('the free evaluation PDF includes the payments table', () => {
  assert.match(read('app/api/cases/[caseId]/free-evaluation/pdf/route.ts'), /"tier0_transactions"/)
})

test('the pieces of a long document are read at the same time', () => {
  const runner = read('lib/server/facts/run-reconcile.ts')
  assert.doesNotMatch(runner, /const first = await read\(parts\[0\]\)/)
  assert.match(runner, /const answers = await inBatches\(parts, MODEL_CONCURRENCY/)
})

test('the gate test writes the FIDReC case’s questionnaire answers itself', () => {
  const spec = read('tests/e2e/authenticated/state-machine-families.spec.ts')
  assert.match(spec, /fidrecTimelineResponses\(\{ complained: true/)
  assert.match(spec, /if \(family === 'layer3Tier2'\) await answerTimelineFor\(fixture\.caseId\)/)
})
