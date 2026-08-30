import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

for (const path of ['/sign-in', '/sign-up']) {
  test(`${path} renders the Clerk authentication surface`, async ({ page }) => {
    const errors = monitorClientErrors(page)
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' })

    expect(response?.status()).toBeLessThan(400)
    expect(new URL(page.url()).pathname).toBe(path)
    await expect(page.locator('.cl-rootBox')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    errors.assertNoHydrationErrors()
  })
}

const redirects = [
  { from: '/app', to: '/' },
  { from: '/app/signup', to: '/sign-up' },
  { from: '/app/case/new', to: '/sign-in' },
  { from: '/onboarding', to: '/sign-up' },
  { from: '/invite/harbor-invalid-token', to: '/sign-up' },
]

for (const route of redirects) {
  test(`${route.from} follows only its expected anonymous redirect`, async ({ page }) => {
    await page.goto(route.from, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL((url) => url.pathname === route.to)
  })
}
