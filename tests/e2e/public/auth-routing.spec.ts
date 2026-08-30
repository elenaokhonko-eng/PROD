import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

const authPages = [
  { path: '/sign-in', heading: 'Welcome back.' },
  { path: '/sign-up', heading: 'Create your case account.' },
]

for (const route of authPages) {
  test(`${route.path} renders Clerk and exact Harbor auth copy`, async ({ page }) => {
    const errors = monitorClientErrors(page)
    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' })

    expect(response?.status(), await response?.text()).toBeLessThan(400)
    expect(new URL(page.url()).pathname).toBe(route.path)
    await expect(page.locator('.cl-rootBox')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible()

    const singpassCopy = 'Singpass sign-in is not currently available.'
    await expect(page.getByText(singpassCopy)).toHaveCount(2)
    await expect(page.getByRole('button', { name: singpassCopy })).toBeDisabled()

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
