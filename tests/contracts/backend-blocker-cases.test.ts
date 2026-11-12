import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backendBlockerCases,
  evidenceCases,
  migrationPreflightCases,
  paymentCases,
  paymentLifecycleDuplicateCases,
  paymentLifecyclePermutations,
  paymentLifecycleStatuses,
  workerLeaseCases,
} from './backend-blocker-cases'

test('Backend blocker contract case IDs are unique and complete', () => {
  const ids = backendBlockerCases.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(workerLeaseCases.length, 2)
  assert.equal(evidenceCases.length, 4)
  assert.equal(paymentCases.length, 7)
  assert.equal(migrationPreflightCases.length, 1)
})

test('every Backend blocker contract case is deterministic and assertive', () => {
  for (const item of backendBlockerCases) {
    assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    assert.ok(item.requirement.length > 20, `${item.id} requirement`)
    assert.ok(item.steps.length > 0, `${item.id} steps`)
    assert.ok(item.invariant.length > 20, `${item.id} invariant`)
    for (const step of item.steps) {
      assert.ok(step.action)
      assert.ok(step.expect)
    }
  }
})

test('worker lease fixtures use a fixed clock and exercise every expired-owner mutation', () => {
  const expired = workerLeaseCases.find((item) => item.id === 'expired-owner-cannot-mutate-before-reclaim')!
  assert.deepEqual(expired.steps.map((step) => step.action), [
    'heartbeat',
    'defer',
    'write_output',
    'settle_completed',
  ])
  assert.ok(expired.steps.every((step) => typeof step.atMs === 'number'))

  const transfer = workerLeaseCases.find((item) => item.id === 'worker-a-to-b-lease-transfer-fences-a')!
  assert.deepEqual(transfer.steps.map((step) => `${step.actor}:${step.expect}`), [
    'workerB:lease_generation_2',
    'workerA:denied_stale_generation',
    'workerA:denied_stale_generation',
    'workerB:accepted',
    'workerB:completed_once',
  ])
})

test('evidence fixtures cover atomic success, rollback/retry, mixed outcomes, and expired collaborators', () => {
  assert.deepEqual(evidenceCases.map((item) => item.id), [
    'evidence-register-and-enqueue-commit-atomically',
    'evidence-enqueue-failure-rolls-back-registration',
    'ready-evidence-is-not-downgraded-by-pending-peer',
    'expired-collaborator-upload-and-process-denied',
  ])
  const rollback = evidenceCases[1]
  assert.equal(rollback.fixture.failpoint, 'after_document_before_enqueue')
  assert.deepEqual(rollback.steps.map((step) => step.expect), [
    'transaction_failed',
    'zero_documents_zero_jobs',
    'one_document_one_job',
  ])
})

test('payment fixtures include each non-destructive lifecycle and blocked second-checkout status', () => {
  for (const status of ['paid', 'partially-refunded', 'refunded', 'disputed']) {
    assert.ok(paymentCases.some((item) => item.id === `${status}-unfulfilled-purchase-blocks-second-checkout`))
  }
  assert.ok(paymentCases.some((item) => item.id === 'concurrent-checkout-reservation-is-single-winner'))
  assert.ok(paymentCases.some((item) => item.id === 'concurrent-completion-is-idempotent'))
  assert.ok(paymentCases.some((item) => item.id === 'payment-lifecycle-permutations-are-monotonic'))

  assert.equal(paymentLifecyclePermutations.length, 24)
  assert.equal(new Set(paymentLifecyclePermutations.map((events) => events.join('|'))).size, 24)
  for (const events of paymentLifecyclePermutations) {
    assert.deepEqual([...events].sort(), [...paymentLifecycleStatuses].sort())
  }
  assert.equal(paymentLifecycleDuplicateCases.length, 24 * 4 * 5)
  assert.equal(
    new Set(paymentLifecycleDuplicateCases.map(({ events, duplicateEventIndex, replayAfterEventCount }) =>
      `${events.join('|')}:${duplicateEventIndex}:${replayAfterEventCount}`,
    )).size,
    paymentLifecycleDuplicateCases.length,
  )
})

test('migration preflight conflict fixture is complete, unique, and deterministically sorted', () => {
  const migration = migrationPreflightCases[0]
  const conflicts = migration.fixture.conflicts as string[]
  assert.deepEqual(conflicts, [
    'duplicate_provider_event',
    'duplicate_provider_session',
    'missing_case_owner',
    'owner_mismatch',
    'unsupported_payment_status',
  ])
  assert.equal(new Set(conflicts).size, conflicts.length)
  assert.deepEqual(conflicts, [...conflicts].sort())
  assert.deepEqual(migration.steps.map((step) => step.expect), [
    'same_sorted_conflict_report',
    'unchanged',
  ])
})
