import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { useStateMachine, type StateMachineInput } from '../../hooks/state-machine/use-state-machine'

// Stage 1 (free evaluation only): story -> journey questions -> intake -> evidence -> confirm facts -> free
// evaluation -> recommendation and the two paid options as "available from".

const base: StateMachineInput = {
  reportPurchase: null, validation: null, gapItems: [], narratives: null, entitlementPlan: null,
  documents: [], decision: null, report: null,
}

test('journey questions come first and only until they are answered', () => {
  assert.equal(useStateMachine({ ...base, journeyAnswered: false }), 'S1-Journey')
  assert.equal(useStateMachine({ ...base, journeyAnswered: true }), 'S1-IntakeForm')
  assert.equal(useStateMachine({ ...base, journeyAnswered: null }), 'S1-IntakeForm', 'unknown never blocks the case')
  const drafted = { ...base, journeyAnswered: false, narratives: { tier0_summary: {} as never, tier0_evidence_checklist: null, tier0_srf_signal: null, other: [] } }
  assert.notEqual(useStateMachine(drafted), 'S1-Journey', 'an existing evaluation is never sent back to the journey')
})

const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')

test('the dashboard runs the confirm step inline and shows next steps while paid stages are off', () => {
  assert.match(dashboard, /node === 'S1-Journey' \? \(\s*<JourneyQuestions/)
  assert.match(dashboard, /node === 'S1-Tier0DraftPending' \? \(\s*<ConfirmAndEvaluate caseId=\{caseId\} \/>/)
  assert.match(dashboard, /const paidStagesOff = capabilityBilling\?\.access\.paidStagesEnabled === false/)
  assert.match(dashboard, /<NextSteps caseId=\{caseId\} priceLabels=\{priceLabels\} \/>/)
  const confirm = readFileSync('components/state-machine/facts/confirm-and-evaluate.tsx', 'utf8')
  assert.match(confirm, /onConfirmed=\{\(id\) => \{\s*setSnapshotId\(id\)\s*generate\.mutate\(id\)/)
})

test('email interest uses the account address and a service-role write to the existing waitlist', () => {
  const route = readFileSync('app/api/waitlist/route.ts', 'utf8')
  assert.match(route, /const user = await getCurrentUser\(\)\s*if \(!user\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/)
  assert.match(route, /\.from\("profiles"\)\s*\.select\("email"\)/)
  assert.doesNotMatch(route, /body\??\.email/, 'never an address typed into the request')
  assert.match(route, /createServiceClient\(\)/)
  assert.match(route, /\.from\("waitlist"\)/)
  assert.match(route, /new Set\(\["bank_pack", "fidrec_pack"\]\)/)
})

test('the recommendation uses only confirmed facts and the paid-stages switch', () => {
  const lib = readFileSync('lib/server/facts/recommendation.ts', 'utf8')
  assert.match(lib, /\.eq\("stage", "free"\)/)
  assert.match(lib, /fact\.label === "confirmed" \|\| fact\.label === "claimant_only"/)
  assert.match(lib, /bankPackEnabled: paidStages\.enabled/)
})
