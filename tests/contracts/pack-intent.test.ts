import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// The pack intent carried across sign-up (PB-18, PB-19) was removed by CR-2 (26 Nov 2026; pack-first.test.ts). What
// stays from the same walk-through is here: no flash after paying. The FIDReC route question (PB-17) was replaced by
// the questionnaire after payment (CR-2, amended 27 Nov; cr2-fidrec-timeline.test.ts).

test('nothing flashes after paying: the payment check comes before the free evaluation’s steps', () => {
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.ok(dashboard.indexOf(') : isAwaitingPaymentConfirmation ? (') > 0)
  assert.ok(dashboard.indexOf(') : isAwaitingPaymentConfirmation ? (') < dashboard.indexOf(") : node === 'S1-Journey'"))
  assert.equal(dashboard.split(') : isAwaitingPaymentConfirmation ? (').length - 1, 1)
})
