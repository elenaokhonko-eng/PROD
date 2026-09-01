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

const anonymousGuards = [
  { from: '/app', to: '/sign-in' },
  { from: '/app/signup', to: '/sign-up' },
  { from: '/app/case/new', to: '/sign-in' },
]

for (const route of anonymousGuards) {
  test(`${route.from} redirects anonymous users to ${route.to}`, async ({ page }) => {
    await page.goto(route.from, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL((url) => {
      if (url.pathname !== route.to) return false
      const redirectUrl = url.searchParams.get('redirect_url')
      return !redirectUrl || decodeURIComponent(redirectUrl).endsWith(route.from)
    })
  })
}

test('/onboarding renders a non-crashing setup shell when unauthenticated', async ({ page }) => {
  const errors = monitorClientErrors(page)
  await page.goto('/onboarding', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { level: 1, name: 'Setting up your case' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  errors.assertNoHydrationErrors()
})

test('/invite/:token renders a non-crashing invitation shell when unauthenticated', async ({ page }) => {
  const errors = monitorClientErrors(page)
  await page.goto('/invite/harbor-invalid-token', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('Case invitation')).toBeVisible()
  await expect(page.getByText('Checking this invitation securely.')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  errors.assertNoHydrationErrors()
})
