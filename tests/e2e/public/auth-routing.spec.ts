import { expect, test } from '@playwright/test'
import { readHarborAuthMode } from '../config'
import { expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

// Brief W1 §F: plain wording, no Singpass, a way back to the site.
const authPages = [
  { path: '/sign-in', heading: 'Welcome back.', subline: 'Sign in to continue your case.' },
  { path: '/sign-up', heading: 'Save your case', subline: 'Create a free account to keep your story private and get your evaluation.' },
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

    await expect(page.getByText(route.subline)).toBeVisible()
    await expect(page.getByText(/Singpass/)).toHaveCount(0)
    await expect(page.getByText(/authenticated case workspace/)).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'GuideBuoy AI' })).toHaveAttribute('href', '/')
    await expect(page.locator('main')).toHaveCount(1)
    if (route.path === '/sign-up') {
      await expect(page.getByText('Free. No card needed. We never ask for your bank login, PIN or OTP.')).toBeVisible()
    }

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
