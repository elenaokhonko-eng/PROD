import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasCompletedIntakeResponses,
  REQUIRED_INTAKE_RESPONSE_KEYS,
  type IntakeResponseSnapshot,
} from '../../lib/intake-completion'
import { useStateMachine, type StateMachineInput } from '../../hooks/state-machine/use-state-machine'

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

function completedResponses(): IntakeResponseSnapshot[] {
  return REQUIRED_INTAKE_RESPONSE_KEYS.map((question_key) => ({
    question_key,
    response_value: `answer for ${question_key}`,
  }))
}

test('persisted required intake responses restore the evidence-upload state after remount', () => {
  const hasSubmittedIntake = hasCompletedIntakeResponses(completedResponses())

  assert.equal(hasSubmittedIntake, true)
  assert.equal(useStateMachine({ ...base, hasSubmittedIntake }), 'S1-EvidenceUpload')
  assert.equal(useStateMachine({ ...base, hasSubmittedIntake }), 'S1-EvidenceUpload')
})

test('partial or blank persisted responses do not mark intake complete', () => {
  const missingRequiredResponse = completedResponses().slice(1)
  const blankRequiredResponse = completedResponses().map((response, index) =>
    index === 0 ? { ...response, response_value: '   ' } : response,
  )

  assert.equal(hasCompletedIntakeResponses(missingRequiredResponse), false)
  assert.equal(hasCompletedIntakeResponses(blankRequiredResponse), false)
  assert.equal(hasCompletedIntakeResponses(null), false)
})
