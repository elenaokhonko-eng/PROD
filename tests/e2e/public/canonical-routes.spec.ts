import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

for (const path of ['/pricing', '/how-it-works']) {
  test(`${path} is a single canonical public route`, async ({ page, request }) => {
    const direct = await request.get(path, { maxRedirects: 0 })
    expect(direct.status(), await direct.text()).toBe(200)
    expect(direct.headers().location).toBeUndefined()

    const errors = monitorClientErrors(page)
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    expect(new URL(page.url()).pathname).toBe(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expectNoHorizontalOverflow(page)
    errors.assertNone()
  })
}

test('/product serves canonical product content and routes to pricing', async ({ page, request }) => {
  const response = await request.get('/product', { maxRedirects: 0 })
  expect(response.status(), await response.text()).toBe(200)
  expect(response.headers().location).toBeUndefined()

  await page.goto('/product', { waitUntil: 'domcontentloaded' })
  expect(new URL(page.url()).pathname).toBe('/product')
  await expect(page.getByRole('heading', { level: 1, name: 'One calm place to organise what happened.' })).toBeVisible()

  const pricingLinks = await page.locator('a[href="/pricing"]:visible').count()
  const howItWorksLinks = await page.locator('a[href="/how-it-works"]:visible').count()
  expect(pricingLinks).toBeGreaterThan(0)
  expect(howItWorksLinks).toBeGreaterThan(0)
})

test('public plan CTAs use canonical pricing and avoid retired consultation links', async ({ page }) => {
  for (const path of ['/', '/pricing', '/how-it-works']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })

    const localPricingLinks = await page.locator('a[href="/pricing"]:visible').count()
    expect(localPricingLinks).toBeGreaterThan(0)

    await expect(page.locator('a[href*="consultation"]')).toHaveCount(0)
    await expect(page.locator('a[href*="/api/payments/create-checkout"]')).toHaveCount(0)
  }
})
