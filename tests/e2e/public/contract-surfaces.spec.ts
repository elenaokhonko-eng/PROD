import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track', (route) =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }),
  )
})

test('faq exposes stateful explorer and keeps contact workflow disabled', async ({ page }) => {
  const errors = monitorClientErrors(page)
  await page.goto('/faq', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { level: 1, name: 'Honest answers for a stressful moment.' })).toBeVisible()
  await expect(page.getByLabel('Search questions')).toBeVisible()

  await page.getByLabel('Search questions').fill('Singpass')
  await expect(page.getByRole('button', { name: 'Is Singpass available?' })).toBeVisible()
  await page.getByRole('button', { name: 'Is Singpass available?' }).click()
  await expect(page.getByText('Singpass sign-in is not currently available. Use an available method shown by the sign-in provider.')).toBeVisible()

  await expect(page.getByText('The contact form is not currently available. Please check back later for the verified request flow.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Contact form is not currently available.' })).toBeDisabled()

  const enabledContactActions = await page
    .locator('button:not([disabled]), [role="button"]:not([aria-disabled="true"])')
    .filter({ hasText: /contact|send|submit/i })
    .count()
  expect(enabledContactActions).toBe(0)

  await expectNoHorizontalOverflow(page)
  errors.assertNoHydrationErrors()
})

test('resources page enforces unavailable + retry behavior when API is down', async ({ page }) => {
  let requestCount = 0
  await page.route('**/api/resources', (route) => {
    requestCount += 1
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'resources_unavailable' }),
    })
  })

  await page.goto('/resources', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Official resources are not currently available' })).toBeVisible()
  await expect(page.getByText('The verified provider-backed directory could not be loaded. No resource information is being substituted locally.')).toBeVisible()

  await page.getByRole('button', { name: 'Try again' }).click()
  await expect.poll(() => requestCount >= 2).toBe(true)
})

test('resources page renders loading and ready/filter states when API responds', async ({ page }) => {
  await page.route('**/api/resources', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 120))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        resources: [
          {
            id: 'scamshield',
            name: 'ScamShield',
            summary: 'Scam guidance and support resources in Singapore.',
            category: 'Scam support',
            url: 'https://www.scamshield.gov.sg/',
          },
        ],
      }),
    })
  })

  await page.goto('/resources', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Loading official resources…' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Official resource directory' })).toBeVisible()

  const filter = page.getByLabel('Filter verified resources')
  await filter.fill('not-a-real-provider')
  await expect(page.getByText('No resources match this filter.')).toBeVisible()

  await filter.fill('ScamShield')
  await expect(page.getByRole('heading', { level: 3, name: 'ScamShield' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Visit official website' })).toHaveAttribute('href', 'https://www.scamshield.gov.sg/')
})

test('pricing and marketplace preserve disabled-service Harbor contract copy', async ({ page }) => {
  await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Free to start. Paid only when you choose more.' })).toBeVisible()
  await expect(page.getByText('S$18')).toBeVisible()
  await expect(page.getByText('S$188')).toBeVisible()
  await expect(page.getByText('Human consultation is not currently available.')).toBeVisible()

  await page.goto('/marketplace', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Help categories being considered.' })).toBeVisible()
  await expect(page.getByText('GuideBuoy does not currently provide a help directory, booking service or warm handover.')).toBeVisible()
  await expect(page.getByText('Planned—not currently available through GuideBuoy.')).toHaveCount(3)

  const disabledResourceButtons = page.getByRole('button', { name: 'View help resources' })
  await expect(disabledResourceButtons).toHaveCount(3)
  for (let index = 0; index < 3; index += 1) {
    await expect(disabledResourceButtons.nth(index)).toBeDisabled()
  }

  await expect(page.locator('a[href*="checkout"], a[href*="subscription"], a[href*="consultation"]')).toHaveCount(0)
})
