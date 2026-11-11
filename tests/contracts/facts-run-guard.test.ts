import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { firstRunningRun } from '../../lib/server/facts/run-reconcile'

test('when two fact checks start together, the earliest goes on and a tie goes to the lower id (G3b re-check, 11 Nov)', () => {
  assert.equal(
    firstRunningRun([
      { id: 'ff469b15', created_at: '2026-11-11T12:08:28.116Z' },
      { id: '91788bdf', created_at: '2026-11-11T12:08:27.495Z' },
    ]),
    '91788bdf',
  )
  assert.equal(
    firstRunningRun([
      { id: 'b', created_at: '2026-11-11T12:08:28.000Z' },
      { id: 'a', created_at: '2026-11-11T12:08:28.000Z' },
    ]),
    'a',
  )
  assert.equal(firstRunningRun([]), null)
})

test('a fact check stands down right after it starts unless it is the first one running', () => {
  const source = readFileSync('lib/server/facts/run-reconcile.ts', 'utf8')
  const start = source.indexOf('const runId = run.id as string')
  const guard = source.indexOf('await standDownUnlessFirst(service, caseId, runId)')
  const work = source.indexOf('const reusable = new Map')
  assert.ok(start > 0 && guard > start && work > guard, 'the guard runs between starting the run and doing any work')
})

test('starting a case links a brand-new account before treating it as signed out (G3b re-check, 11 Nov)', () => {
  const source = readFileSync('app/api/cases/bootstrap/route.ts', 'utf8')
  assert.match(source, /provisionClerkProfileWithRuntimeDependencies\(userId\)/)
  assert.match(source, /const user = await currentUserLinkingNewAccount\(\)/)
})
