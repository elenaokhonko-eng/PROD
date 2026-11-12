import { expect, test } from '@playwright/test'
import { readHarborAuthMode } from '../config'
import { expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

const authPages = [
  { path: '/sign-in', heading: 'Welcome back.' },
  { path: '/sign-up', heading: 'Create your case account.' },
]

for (const route of authPages) {
  test(`${route.path} renders its available auth mode and exact Harbor copy`, async ({ page }, testInfo) => {
    const errors = monitorClientErrors(page)
    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' })

    expect(response?.status(), await response?.text()).toBeLessThan(400)
    expect(new URL(page.url()).pathname).toBe(route.path)
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible()

    if (readHarborAuthMode(testInfo.config.metadata) === 'configured') {
      await expect(page.locator('.cl-rootBox')).toBeVisible()
    } else {
      await expect(page.locator('.cl-rootBox')).toHaveCount(0)
    }

    const singpassCopy = 'Singpass sign-in is not currently available.'
    await expect(page.getByText(singpassCopy)).toHaveCount(2)
    await expect(page.getByRole('button', { name: singpassCopy })).toBeDisabled()

    await expectNoHorizontalOverflow(page)
    errors.assertNone()
  })
}

const protectedAnonymousGuards = [{ from: '/app' }, { from: '/app/case/new' }]

for (const route of protectedAnonymousGuards) {
  test(`${route.from} enforces anonymous guard by configured auth mode`, async ({ page }, testInfo) => {
    const authMode = readHarborAuthMode(testInfo.config.metadata)
    const response = await page.goto(route.from, { waitUntil: 'domcontentloaded' })

    if (authMode === 'configured') {
      await expect(page).toHaveURL((url) => {
        if (url.pathname !== '/sign-in') return false
        const redirectUrl = url.searchParams.get('redirect_url')
        return !redirectUrl || decodeURIComponent(redirectUrl).endsWith(route.from)
      })
      return
    }

    expect(new URL(page.url()).pathname).toBe(route.from)
    expect(response?.status()).toBe(503)
    await expect(page.getByText('Authentication is not configured.')).toBeVisible()
  })
}

test('/app/signup redirects anonymous users to canonical /sign-up', async ({ page }) => {
  await page.goto('/app/signup', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL((url) => {
    if (url.pathname !== '/sign-up') return false
    return !url.searchParams.has('redirect_url')
  })
})

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
