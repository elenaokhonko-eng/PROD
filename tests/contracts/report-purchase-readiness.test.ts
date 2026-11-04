import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildCaseCapabilityBillingResponse } from '../../lib/billing/case-capabilities'
import { assessReportPurchaseReadiness } from '../../lib/billing/report-purchase-readiness'
import { deriveMissing } from '../../components/state-machine/transition/eligibility-gate'

const valid = { status: 'valid', is_valid: true }

test('a free case can buy the report once its free draft exists and validation passes', () => {
  assert.deepEqual(assessReportPurchaseReadiness({ hasFreeDraft: true, latestValidation: valid }), {
    ready: true,
    blockedReason: null,
  })
  assert.equal(assessReportPurchaseReadiness({ hasFreeDraft: true, latestValidation: { status: 'needs_user', is_valid: true } }).ready, true)
})

test('an empty case, a case without validation, or with blocking validation cannot buy the report', () => {
  assert.equal(assessReportPurchaseReadiness({ hasFreeDraft: false, latestValidation: valid }).blockedReason, 'free_draft_missing')
  assert.equal(assessReportPurchaseReadiness({ hasFreeDraft: true, latestValidation: null }).blockedReason, 'validation_missing')
  for (const latestValidation of [
    { status: 'invalid', is_valid: true },
    { status: 'error', is_valid: true },
    { status: 'valid', is_valid: false },
    { status: 'valid', is_valid: null },
  ]) {
    assert.equal(assessReportPurchaseReadiness({ hasFreeDraft: true, latestValidation }).blockedReason, 'validation_blocking')
  }
})

test('the buy button needs purchase readiness, not a paid entitlement', () => {
  const free = { plan: 'free', features: {}, purchased_at: null }
  const ready = buildCaseCapabilityBillingResponse({ caseId: 'c1', entitlement: free, purchases: [], reportPurchase: { ready: true, blockedReason: null } })
  assert.equal(ready.capabilities.report.canCheckout, true)
  assert.equal(ready.capabilities.report.purchaseReady, true)

  const blocked = buildCaseCapabilityBillingResponse({ caseId: 'c1', entitlement: null, purchases: [], reportPurchase: { ready: false, blockedReason: 'free_draft_missing' } })
  assert.equal(blocked.capabilities.report.canCheckout, false)
  assert.equal(blocked.capabilities.report.purchaseBlockedReason, 'free_draft_missing')

  const unknown = buildCaseCapabilityBillingResponse({ caseId: 'c1', entitlement: free, purchases: [] })
  assert.equal(unknown.capabilities.report.canCheckout, false)
})

test('checkout and the capabilities API both apply the readiness check', () => {
  const checkout = readFileSync('app/api/payments/create-checkout-session/route.ts', 'utf8')
  assert.match(checkout, /productKey === "self_serve_report"[\s\S]*?loadReportPurchaseReadiness\(service, caseId\)/)
  assert.match(checkout, /\{ error: "Purchase is not eligible", reason: readiness\.blockedReason \}, \{ status: 409 \}/)
  assert.ok(checkout.indexOf('loadReportPurchaseReadiness(service') < checkout.indexOf('"reserve_checkout_purchase_v1"'))
  assert.match(readFileSync('app/api/cases/[caseId]/capabilities/route.ts', 'utf8'), /loadReportPurchaseReadiness\(supabase, caseId\)/)
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
  const eligibility = { prerequisites } as never
  assert.deepEqual(deriveMissing({ ready: false, blockedReason: 'free_draft_missing' }, eligibility), [])
  assert.deepEqual(deriveMissing({ ready: false, blockedReason: 'validation_blocking' }, eligibility), ['validation'])
  assert.deepEqual(
    deriveMissing({ ready: false, blockedReason: 'free_draft_missing' }, { prerequisites: { ...prerequisites, has_processed_documents: false } } as never),
    ['documents'],
  )
})
