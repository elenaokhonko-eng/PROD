import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildCaseCapabilityBillingResponse } from '../../lib/billing/case-capabilities'
import { bankPackEnabled } from '../../lib/billing/paid-stages'
import { parseProductReadiness, PRODUCT_READINESS_REASONS } from '../../lib/billing/product-readiness'
import { deriveMissing } from '../../components/state-machine/transition/eligibility-gate'

// Stage 2 buying rules (Elena, 13 Nov 2026; docs/release/stage2-plan.md §3a): each pack is sold on its own. The bank
// pack needs only a story; the FIDReC pack also needs the route answer. The database rules themselves are tested in
// scripts/sql/tests/test_product_readiness.sql.

const ready = { ready: true, reason: null } as const
const free = { plan: 'free', features: {}, purchased_at: null }
const migration = readFileSync('supabase/migrations/20261120120000_product_readiness.sql', 'utf8')

test('every reason code the API knows is one the database returns, and the other way round', () => {
  const fromSql = new Set([...migration.matchAll(/'ready', false, 'reason', '([a-z_]+)'/g)].map((m) => m[1]))
  assert.deepEqual([...fromSql].sort(), [...PRODUCT_READINESS_REASONS].sort())
})

test('the RPC answer is read strictly: anything unexpected is not ready', () => {
  assert.deepEqual(parseProductReadiness({ ready: true, reason: null }), ready)
  assert.deepEqual(parseProductReadiness({ ready: false, reason: 'story_missing' }), { ready: false, reason: 'story_missing' })
  assert.deepEqual(parseProductReadiness({ ready: false, reason: 'fidrec_too_early', opens_on: '2026-12-18' }), {
    ready: false,
    reason: 'fidrec_too_early',
    opensOn: '2026-12-18',
  })
  assert.deepEqual(parseProductReadiness({ ready: 'true' }), { ready: false, reason: 'product_not_available' })
  assert.deepEqual(parseProductReadiness(null), { ready: false, reason: 'product_not_available' })
  assert.deepEqual(parseProductReadiness({ ready: false, reason: 'free_draft_missing' }), { ready: false, reason: 'product_not_available' })
})

test('the packs are independent: the FIDReC pack is for sale without the bank pack, and its plan does not include it', () => {
  const both = buildCaseCapabilityBillingResponse({ caseId: 'c1', entitlement: free, purchases: [], readiness: { report: ready, fidrecPack: ready } })
  assert.equal(both.capabilities.report.canCheckout, true)
  assert.equal(both.capabilities.fidrecPack.canCheckout, true)
  assert.equal(both.capabilities.fidrecPack.state, 'available')

  const fidrecOnly = buildCaseCapabilityBillingResponse({
    caseId: 'c1',
    entitlement: { plan: 'escalation_pack', features: { allow_escalation_pack: true, allow_self_serve_report: false }, purchased_at: null },
    purchases: [],
    readiness: { report: ready, fidrecPack: { ready: false, reason: 'already_purchased' } },
  })
  assert.equal(fidrecOnly.capabilities.report.entitled, false)
  assert.equal(fidrecOnly.capabilities.report.state, 'available')
  assert.equal(fidrecOnly.capabilities.fidrecPack.state, 'owned')
})

test('each pack reports one state with its reason', () => {
  const early = buildCaseCapabilityBillingResponse({
    caseId: 'c1',
    entitlement: free,
    purchases: [],
    readiness: {
      report: { ready: false, reason: 'story_missing' },
      fidrecPack: { ready: false, reason: 'fidrec_too_early', opensOn: '2026-12-18' },
    },
  })
  assert.deepEqual([early.capabilities.report.state, early.capabilities.report.reason], ['unavailable', 'story_missing'])
  assert.deepEqual([early.capabilities.fidrecPack.state, early.capabilities.fidrecPack.reason], ['unavailable', 'fidrec_too_early'])
  assert.equal(early.capabilities.fidrecPack.opensOn, '2026-12-18')

  const bankOff = buildCaseCapabilityBillingResponse({
    caseId: 'c1',
    entitlement: free,
    purchases: [],
    readiness: { report: ready, fidrecPack: ready },
    bankPackEnabled: false,
  })
  assert.equal(bankOff.capabilities.report.canCheckout, false)
  assert.deepEqual([bankOff.capabilities.report.state, bankOff.capabilities.report.reason], ['unavailable', 'product_not_available'])
  assert.equal(bankOff.capabilities.report.purchaseReady, true, 'the rules still pass, so stage 1 screens stay as they are')
  assert.equal(bankOff.capabilities.fidrecPack.canCheckout, true)

  const stage1 = buildCaseCapabilityBillingResponse({
    caseId: 'c1',
    entitlement: free,
    purchases: [],
    readiness: { report: ready, fidrecPack: ready },
    paidStages: { enabled: false, availableFrom: '2026-12-01' },
  })
  assert.equal(stage1.capabilities.report.state, 'unavailable')
  assert.equal(stage1.capabilities.fidrecPack.reason, 'product_not_available')

  const unknown = buildCaseCapabilityBillingResponse({ caseId: 'c1', entitlement: free, purchases: [] })
  assert.equal(unknown.capabilities.report.canCheckout, false)
  assert.equal(unknown.capabilities.fidrecPack.canCheckout, false)
})

test('BANK_PACK_ENABLED is off unless exactly true, and only with paid stages on', () => {
  const saved = { PAID_STAGES_ENABLED: process.env.PAID_STAGES_ENABLED, BANK_PACK_ENABLED: process.env.BANK_PACK_ENABLED }
  try {
    process.env.PAID_STAGES_ENABLED = 'true'
    delete process.env.BANK_PACK_ENABLED
    assert.equal(bankPackEnabled(), false)
    process.env.BANK_PACK_ENABLED = 'yes'
    assert.equal(bankPackEnabled(), false)
    process.env.BANK_PACK_ENABLED = ' TRUE '
    assert.equal(bankPackEnabled(), true)
    process.env.PAID_STAGES_ENABLED = 'false'
    assert.equal(bankPackEnabled(), false)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('checkout and the capabilities API both apply readiness, and the database applies it again', () => {
  const checkout = readFileSync('app/api/payments/create-checkout-session/route.ts', 'utf8')
  assert.match(checkout, /if \(!productSwitchedOn\(productKey\)\)/)
  assert.match(checkout, /loadProductReadiness\(service, caseId, productKey\)/)
  assert.ok(checkout.indexOf('loadProductReadiness(service') < checkout.indexOf('"reserve_checkout_purchase_v1"'))
  assert.match(checkout, /reason: notReady/)
  // An existing purchase still reaches the reservation, which resumes or repairs it.
  assert.ok(checkout.includes('if (!readiness.ready && readiness.reason !== "already_purchased")'))
  const capabilities = readFileSync('app/api/cases/[caseId]/capabilities/route.ts', 'utf8')
  assert.match(capabilities, /loadProductReadiness\(service, caseId, "self_serve_report"\)/)
  assert.match(capabilities, /loadProductReadiness\(service, caseId, "fidrec_tier2_pack"\)/)
  assert.match(capabilities, /bankPackEnabled: bankPackEnabled\(\)/)
  assert.match(migration, /v_readiness := public\.get_case_product_readiness_v1\(p_case_id, p_checkout_product_key\)/)
  assert.doesNotMatch(migration, /FI Guide purchase required|qualifying FI capability required/)
})

test('paying for the bank pack grants it; it is generated only after the bank facts are confirmed', () => {
  const webhook = readFileSync('app/api/payments/webhook/route.ts', 'utf8')
  assert.match(webhook, /grantReportEntitlement: async[\s\S]*?rpc\("grant_self_serve_report_capability_v1"/)
  assert.doesNotMatch(webhook, /enqueue_post_payment_report_generation/)
  const reconcile = migration.slice(migration.indexOf('FUNCTION public.reconcile_established_case_purchase_fulfilment_v1'))
  assert.doesNotMatch(reconcile.slice(0, reconcile.indexOf('$$;')), /enqueue_post_payment_report_generation/)
})

test('prerequisite keys match what get_case_eligibility returns', () => {
  const rpc = readFileSync('supabase/migrations/20260419140000_get_case_eligibility_self_serve.sql', 'utf8')
  const types = readFileSync('lib/types/eligibility.ts', 'utf8')
  for (const key of ['has_extract_run', 'has_validation_run', 'has_decision_run', 'has_processed_documents']) {
    assert.match(rpc, new RegExp(`'${key}'`))
    assert.match(types, new RegExp(`\\b${key}: boolean`))
  }
  for (const stale of ['has_extract', 'has_validation', 'has_decision', 'has_documents']) {
    assert.doesNotMatch(types, new RegExp(`\\b${stale}: boolean`))
  }
})

test('the blocked screen names what is actually missing', () => {
  const prerequisites = { has_extract_run: true, has_validation_run: true, has_decision_run: false, has_processed_documents: true }
  const blocked = { ready: false, blockedReason: 'story_missing' } as const
  assert.deepEqual(deriveMissing(blocked, { prerequisites } as never), [])
  assert.deepEqual(deriveMissing(blocked, { prerequisites: { ...prerequisites, has_validation_run: false } } as never), ['validation'])
  assert.deepEqual(deriveMissing(blocked, { prerequisites: { ...prerequisites, has_processed_documents: false } } as never), ['documents'])
})
