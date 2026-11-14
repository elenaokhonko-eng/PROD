import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }),
  )
})

test('faq exposes stateful explorer and keeps contact workflow disabled', async ({ page }) => {
  const errors = monitorClientErrors(page)
  await page.goto('/faq', { waitUntil: 'networkidle' })

  await expect(page.getByRole('heading', { level: 1, name: 'Honest answers for a stressful moment.' })).toBeVisible()
  const search = page.getByLabel('Search questions')
  await expect(search).toBeVisible()

  const allCategory = page.getByRole('button', { name: 'All', exact: true })
  const pricingCategory = page.getByRole('button', { name: 'Products and pricing' })
  await pricingCategory.click()
  await expect(pricingCategory).toHaveAttribute('aria-pressed', 'true')
  await allCategory.click()
  await expect(allCategory).toHaveAttribute('aria-pressed', 'true')

  // Brief W1 §F: the Singpass question is gone; search still finds and opens an answer.
  await search.fill('Singpass')
  await expect(page.getByRole('button', { name: /Singpass/ })).toHaveCount(0)
  await search.fill('legal advice')
  await expect.poll(async () => search.inputValue()).toBe('legal advice')
  const reviewQuestion = page.getByRole('button', { name: 'Is this legal advice? Does a person review it?' })
  await expect(reviewQuestion).toBeVisible()
  await reviewQuestion.click()
  await expect(page.getByText(/GuideBuoy is automated and is not legal advice/)).toBeVisible()

  // Finding D5: no form; contact is by email.
  await expect(page.getByRole('link', { name: 'info@guidebuoyai.sg' }).first()).toHaveAttribute('href', 'mailto:info@guidebuoyai.sg')

  const enabledContactActions = await page
    .locator('button:not([disabled]), [role="button"]:not([aria-disabled="true"])')
    .filter({ hasText: /contact|send|submit/i })
    .count()
  expect(enabledContactActions).toBe(0)

  await expectNoHorizontalOverflow(page)
  errors.assertNoHydrationErrors()
})

// Finding D5: while the directory is unavailable the page says it is under development, offers no retry and shows
// no substitute resources.
test('resources page says the directory is under development when the API is down', async ({ page }) => {
  let requestCount = 0
  await page.route('**/api/resources**', (route) => {
    requestCount += 1
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'resources_unavailable' }),
    })
  })

  await page.goto('/resources', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Our verified resources directory is under development.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Visit official website' })).toHaveCount(0)
  expect(requestCount).toBe(1)
})

test('resources page renders loading and ready/filter states when API responds', async ({ page }) => {
  // Hold the response until the loading state has been seen, so slow hydration cannot skip it.
  let releaseResponse: () => void = () => {}
  const responseReleased = new Promise<void>((resolve) => { releaseResponse = resolve })
  await page.route('**/api/resources**', async (route) => {
    await responseReleased
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
  releaseResponse()
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
  await expect(page.getByText(/^S\$18$/)).toBeVisible()
  await expect(page.getByText(/^S\$188$/)).toBeVisible()
  // Brief W1 §B3 (replacing finding D2's line on each card): the consultation is offered once, in "What GuideBuoy is".
  await expect(page.getByRole('complementary', { name: 'What GuideBuoy is' })).toHaveCount(1)
  await expect(page.getByRole('complementary', { name: 'What GuideBuoy is' })).toContainText('a 30-minute consultation is S$99')

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
