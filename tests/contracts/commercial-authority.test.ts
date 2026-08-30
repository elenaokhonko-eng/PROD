import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHECKOUT_PRODUCT_KEYS,
  PRODUCT_CATALOGUE,
  isCheckoutProductKey,
  requireCheckoutProduct,
} from '../../lib/payments/product-catalogue'

const enabledCheckoutKeys = ['fidrec_tier2_pack', 'self_serve_report'] as const

test('commercial authority keeps the known checkout key registry stable', () => {
  assert.deepEqual([...CHECKOUT_PRODUCT_KEYS].sort(), ['fidrec_tier2_pack', 'human_consult_30m', 'self_serve_report'])
  assert.equal(PRODUCT_CATALOGUE.self_serve_report.amountSgd, 18)
  assert.equal(PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd, 188)
  assert.equal(PRODUCT_CATALOGUE.human_consult_30m.amountSgd, 99)
})

test('only S$18 and S$188 are enabled for release checkout flows', () => {
  for (const key of enabledCheckoutKeys) {
    assert.equal(isCheckoutProductKey(key), true)
  }
  assert.equal((enabledCheckoutKeys as readonly string[]).includes('human_consult_30m'), false)
})

test('S$0 remains a non-checkout path', () => {
  assert.equal(isCheckoutProductKey('free'), false)
  assert.equal(isCheckoutProductKey('tier0_free'), false)
})

test('unsupported subscription and regeneration keys stay unknown and fail closed', () => {
  for (const key of [
    'subscription',
    'subscription_monthly',
    'regeneration',
    'report_regeneration_8',
    'report_regeneration_12',
  ]) {
    assert.equal(isCheckoutProductKey(key), false, `${key} must fail closed as unsupported`)
    assert.throws(() => requireCheckoutProduct(key), /Unknown or missing checkout product_key/)
  }
})
