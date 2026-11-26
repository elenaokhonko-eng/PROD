import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Part B re-test, 26 Nov 2026 (Elena's decisions).
test('"They offered all of it back" is not offered as an answer; a letter that says so is still read', () => {
  assert.doesNotMatch(readFileSync('components/state-machine/facts/journey-questions.tsx', 'utf8'), /offered all of it back/i)
  assert.match(readFileSync('supabase/functions/_shared/facts/extraction.ts', 'utf8'), /"full_offer"/)
})

test('the FIDReC notes show under the evaluation with paid stages on as well as off', () => {
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  const paidFooter = dashboard.slice(dashboard.indexOf("node === 'S1-Tier0Draft' ? ("), dashboard.indexOf("node === 'T-EligibilityGate' ? ("))
  assert.match(paidFooter, /<RecommendationNotes caseId=\{caseId\} \/>/)
})
