import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// The pack intent carried across sign-up (PB-18, PB-19) was removed by CR-2 (26 Nov 2026; pack-first.test.ts). What
// stays from the same walk-through is here: the FIDReC route question (PB-17) and no flash after paying.

// Part B walk-through (25 Nov, PB-17): "not complained yet" left the reason at complaint_not_raised, as before any
// answer, so the route question stayed up and its message never showed; an answer that opened the pack could not be
// changed.
test('the FIDReC route question shows the saved answer and can be changed in every state', () => {
  const offer = readFileSync('components/state-machine/transition/fidrec-offer.tsx', 'utf8')
  // Gate run 45631835006 (26 Nov): and not while the saved answer is still loading.
  assert.match(offer, /const needsAnswer = editing \|\| \(!loading && saved === null && props\.reason === 'complaint_not_raised'\)/)
  assert.match(offer, /const loading = props\.savedRoute === undefined/)
  // Local gate repro (26 Nov): a save finishing after the person had started changing the answer closed it again.
  assert.match(offer, /disabled=\{saving\} onClick=\{startEditing\}>\s*Change my answer/)
  assert.match(offer, /if \(now\.route === route && now\.date === date\) props\.onDraftChange\(\{ route: null, date: '', editing: false \}\)/)
  assert.match(offer, /\{!needsAnswer && \(blocked \|\| saved\) \? \(/)
  assert.match(offer, /onClick=\{startEditing\}>\s*Change my answer/)
  const hook = readFileSync('hooks/state-machine/facts/use-fidrec-route.ts', 'utf8')
  assert.match(hook, /\.in\('question_key', \[\.\.\.ROUTE_KEYS\]\)/)
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /savedRoute=\{fidrecRouteQuery\.isError \? null : fidrecRouteQuery\.data\}/)
  assert.match(dashboard, /await Promise\.all\(\[paymentStatusQuery\.refetch\(\), fidrecRouteQuery\.refetch\(\)\]\)/)
})

test('nothing flashes after paying: the payment check comes before the free evaluation’s steps', () => {
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.ok(dashboard.indexOf(') : isAwaitingPaymentConfirmation ? (') > 0)
  assert.ok(dashboard.indexOf(') : isAwaitingPaymentConfirmation ? (') < dashboard.indexOf(") : node === 'S1-Journey'"))
  assert.equal(dashboard.split(') : isAwaitingPaymentConfirmation ? (').length - 1, 1)
})
