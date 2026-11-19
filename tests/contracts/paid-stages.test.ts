import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildCaseCapabilityBillingResponse } from '../../lib/billing/case-capabilities'
import { paidStagesAvailableFrom, paidStagesEnabled } from '../../lib/billing/paid-stages'

// Stage 1 launches the free evaluation only: both paid products are off unless PAID_STAGES_ENABLED is exactly true.

test('paid stages are off unless explicitly enabled', () => {
  const saved = { enabled: process.env.PAID_STAGES_ENABLED, from: process.env.PAID_STAGES_AVAILABLE_FROM }
  try {
    delete process.env.PAID_STAGES_ENABLED
    assert.equal(paidStagesEnabled(), false)
    for (const value of ['false', '1', 'yes', '']) {
      process.env.PAID_STAGES_ENABLED = value
      assert.equal(paidStagesEnabled(), false, value)
    }
    process.env.PAID_STAGES_ENABLED = 'TRUE'
    assert.equal(paidStagesEnabled(), true)

    delete process.env.PAID_STAGES_AVAILABLE_FROM
    assert.equal(paidStagesAvailableFrom(), '2026-12-01')
    process.env.PAID_STAGES_AVAILABLE_FROM = 'soon'
    assert.equal(paidStagesAvailableFrom(), '2026-12-01')
    process.env.PAID_STAGES_AVAILABLE_FROM = '2026-12-08'
    assert.equal(paidStagesAvailableFrom(), '2026-12-08')
  } finally {
    if (saved.enabled === undefined) delete process.env.PAID_STAGES_ENABLED
    else process.env.PAID_STAGES_ENABLED = saved.enabled
    if (saved.from === undefined) delete process.env.PAID_STAGES_AVAILABLE_FROM
    else process.env.PAID_STAGES_AVAILABLE_FROM = saved.from
  }
})

test('checkout refuses both products with product_not_available before any reservation', () => {
  const route = readFileSync('app/api/payments/create-checkout-session/route.ts', 'utf8')
  assert.match(route, /if \(!paidStagesEnabled\(\)\) \{[\s\S]*?reason: "product_not_available"[\s\S]*?status: 409/)
  assert.ok(route.indexOf('paidStagesEnabled()') < route.indexOf('"reserve_checkout_purchase_v1"'))
})

test('no buy button while paid stages are off, even when the case is ready to buy', () => {
  const free = { plan: 'free', features: {}, purchased_at: null }
  const off = buildCaseCapabilityBillingResponse({
    caseId: 'c1', entitlement: free, purchases: [],
    readiness: { report: { ready: true, reason: null }, fidrecPack: { ready: true, reason: null } },
    paidStages: { enabled: false, availableFrom: '2026-12-01' },
  })
  assert.equal(off.capabilities.report.canCheckout, false)
  assert.equal(off.capabilities.fidrecPack.canCheckout, false)
  assert.equal(off.access.paidStagesEnabled, false)
  assert.equal(off.access.paidStagesAvailableFrom, '2026-12-01')
  const route = readFileSync('app/api/cases/[caseId]/capabilities/route.ts', 'utf8')
  assert.match(route, /const paidStages = paidStagesState\(\)[\s\S]*?buildCaseCapabilityBillingResponse\(\{[\s\S]*?paidStages,/)
  // Stage 1 doesn't read the buying rules, so it doesn't depend on the stage 2 migration being applied.
  assert.match(route, /if \(paidStages\.enabled\) \{[\s\S]*?loadProductReadiness/)
})
