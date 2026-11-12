import assert from 'node:assert/strict'
import test from 'node:test'
import {
  expectedStateText,
  parseStateCaseFixtures,
} from '../e2e/helpers/state-case-fixtures'

function completeFixtureRecord() {
  return Object.fromEntries(
    Object.keys(expectedStateText).map((key, index) => [
      key,
      { caseId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` },
    ]),
  )
}

test('state-case fixtures require the intentional unavailable consultation state', () => {
  const record = completeFixtureRecord()
  const parsed = parseStateCaseFixtures(JSON.stringify(record))

  assert.equal(parsed.layer3Unavailable.caseId, record.layer3Unavailable.caseId)
  assert.equal('layer3Form' in parsed, false)
})

test('state-case fixtures reject the unreachable consultation form state', () => {
  const record = completeFixtureRecord()
  record.layer3Form = record.layer3Unavailable
  delete record.layer3Unavailable

  assert.throws(
    () => parseStateCaseFixtures(JSON.stringify(record)),
    /unreachable or unrecognized states: layer3Form/,
  )
})
