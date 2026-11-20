import { expect, test } from '../fixtures/harbor-test'
import { PAID_STAGES_DEFERRED, paidStagesEnabled } from '../helpers/paid-stages'
import { readReleaseFixtures } from '../../release/release-fixtures'
import { PRODUCT_CATALOGUE } from '../../../lib/payments/product-catalogue'

// Both tests start from the buy button, which stage 1 does not show.
test.skip(!paidStagesEnabled, PAID_STAGES_DEFERRED)

const fixtures = readReleaseFixtures()
const syntheticEvidence = { annotation: { type: 'evidence-class', description: 'synthetic-provider' } }

test('payment failure keeps the user on the case and offers a safe retry', syntheticEvidence, async ({ page }) => {
  const caseId = fixtures.payments.selfServeCheckoutCaseId

  await page.route('**/api/payments/create-checkout-session', (route) =>
    route.fulfill({
      status: 402,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'payment_action_required' }),
    }),
  )
  await page.goto(`/app/case/${caseId}/dashboard`)
  await page.getByRole('button', { name: 'Get Bank dispute pack' }).click()

  await expect(page).toHaveURL(new RegExp(`/app/case/${caseId}/dashboard`))
  await expect(page.getByText(/payment_action_required|payment.*failed|try again/i).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Get Bank dispute pack$|try again/i }).first()).toBeEnabled()
})

test('successful return waits for delayed entitlement instead of showing a false failure', async ({ page }) => {
  const { caseId, sessionId } = fixtures.payments.delayedEntitlement
  const product = PRODUCT_CATALOGUE.self_serve_report.checkoutKey
  await page.goto(`/app/case/${caseId}/dashboard?payment=success&session_id=${sessionId}&product=${product}`)

  await expect(page.getByText('Confirming payment', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/payment failed/i)).toHaveCount(0)
})
