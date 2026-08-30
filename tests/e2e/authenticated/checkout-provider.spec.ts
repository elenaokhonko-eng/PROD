import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '../fixtures/harbor-test'
import { readReleaseFixtures } from '../../release/release-fixtures'

const fixtures = readReleaseFixtures()

test.describe('Stripe preview-provider checkout contract', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Mutating provider checks run once per release SHA.')
  })

  for (const purchase of [
    { key: 'self_serve_report', caseId: fixtures.payments.selfServeCheckoutCaseId, amount: 18 },
    { key: 'fidrec_tier2_pack', caseId: fixtures.payments.tier2CheckoutCaseId, amount: 188 },
  ] as const) {
    test(`enabled ${purchase.key} creates a test-mode one-time S$${purchase.amount} checkout`, async ({ page }) => {
      const token = await getSupabaseToken(page)
      const response = await createCheckout(page, token, purchase.caseId, purchase.key)
      expect(response.status(), await response.text()).toBe(200)
      const body = await response.json() as { url?: string }
      const checkout = new URL(body.url!)
      expect(checkout.protocol).toBe('https:')
      expect(checkout.hostname).toBe('checkout.stripe.com')
      expect(body.url).toContain('cs_test_')

      await page.goto(checkout.href, { waitUntil: 'domcontentloaded' })
      expect(new URL(page.url()).hostname).toBe('checkout.stripe.com')
      const providerText = await page.locator('body').innerText()
      expect(providerText).toMatch(
        new RegExp(`(?:S\\$|SGD)\\s*${purchase.amount}(?:\\.00)?|${purchase.amount}(?:\\.00)?\\s*SGD`, 'i'),
      )
      expect(providerText).not.toMatch(/(?:per\s+month|\/\s*month|monthly)/i)
    })
  }

  test('known disabled keys return 409 and unknown keys return 400 without any provider redirect', async ({ page }) => {
    const token = await getSupabaseToken(page)

    for (const knownDisabledKey of ['human_consult_30m'] as const) {
      const response = await createCheckout(page, token, fixtures.payments.freeCaseId, knownDisabledKey)
      expect(response.status(), `${knownDisabledKey}: ${await response.text()}`).toBe(409)
      expect(response.headers().location).toBeUndefined()
    }

    for (const unknownKey of [
      'subscription',
      'subscription_monthly',
      'report_regeneration_8',
      'report_regeneration_12',
      'unexpected_product_key',
    ]) {
      const response = await createCheckout(page, token, fixtures.payments.freeCaseId, unknownKey)
      expect(response.status(), `${unknownKey}: ${await response.text()}`).toBe(400)
      expect(response.headers().location).toBeUndefined()
    }
  })

  test('unfulfilled paid and adverse-lifecycle purchases block a second checkout', async ({ page }) => {
    const token = await getSupabaseToken(page)
    for (const [status, fixture] of Object.entries(fixtures.payments.blockedSecondCheckout)) {
      const response = await createCheckout(page, token, fixture.caseId, 'self_serve_report')
      expect(response.status(), `${status}: ${await response.text()}`).toBe(409)
      expect(response.headers().location).toBeUndefined()
    }
  })

  test('concurrent checkout reservation creates at most one provider session', async ({ page }) => {
    const token = await getSupabaseToken(page)
    const responses = await Promise.all([
      createCheckout(page, token, fixtures.payments.concurrentCheckoutCaseId, 'self_serve_report'),
      createCheckout(page, token, fixtures.payments.concurrentCheckoutCaseId, 'self_serve_report'),
    ])
    const statuses = responses.map((response) => response.status())
    expect(statuses.filter((status) => status === 200)).not.toHaveLength(0)
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true)

    const successfulUrls = await Promise.all(
      responses
        .filter((response) => response.status() === 200)
        .map(async (response) => (await response.json() as { url?: string }).url),
    )
    expect(successfulUrls.every(Boolean)).toBe(true)
    expect(new Set(successfulUrls).size, 'Successful replays must return the same reserved Stripe session').toBe(1)
  })
})

async function createCheckout(
  page: Page,
  token: string,
  caseId: string,
  productKey: string,
): Promise<APIResponse> {
  return page.request.post('/api/payments/create-checkout-session', {
    data: { caseId, productKey },
    headers: { authorization: `Bearer ${token}` },
    maxRedirects: 0,
  })
}

async function getSupabaseToken(page: Page) {
  await page.goto('/app')
  const token = await page.evaluate(async () => {
    const clerk = (globalThis as unknown as {
      Clerk?: { session?: { getToken(options: { template: string }): Promise<string | null> } }
    }).Clerk
    return clerk?.session?.getToken({ template: 'supabase' }) ?? null
  })
  expect(token, 'Clerk Supabase token must be available').toBeTruthy()
  return token!
}
