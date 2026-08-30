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

test('/product redirects to /how-it-works instead of serving duplicate content', async ({ request }) => {
  const response = await request.get('/product', { maxRedirects: 0 })
  expect([301, 302, 307, 308]).toContain(response.status())
  expect(new URL(response.headers().location!, response.url()).pathname).toBe('/how-it-works')
})

test('public plan CTAs use the canonical pricing authority', async ({ page }) => {
  for (const path of ['/', '/how-it-works']) {
    await page.goto(path)
    const localPricingLinks = page.locator('a[href="/pricing"]')
    await expect(localPricingLinks.first()).toBeVisible()
    await expect(page.locator('a[href="/product"]')).toHaveCount(0)
  }
})
