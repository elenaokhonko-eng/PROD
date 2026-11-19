import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'
import { BANK_HOTLINES, OFFICIAL_SOURCES } from '../../../lib/resources/official-help'

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
  // Brief W1 §J groups: Start, What you get, Cost, Privacy.
  const pricingCategory = page.getByRole('button', { name: 'Cost', exact: true })
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

// Brief W1 §I: the Resources list is in the server HTML, so it works without JavaScript; every hotline is a phone link.
test('resources page lists every checked hotline and official source without JavaScript', async ({ browser, request }) => {
  const html = await (await request.get('/resources')).text()
  for (const line of BANK_HOTLINES) {
    expect(html, line.bank).toContain(line.bank)
    expect(html, line.bank).toContain(`href="tel:${line.tel}"`)
  }
  for (const source of OFFICIAL_SOURCES) expect(html, source.title).toContain(source.link.href)

  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/resources')
  await expect(page.getByTestId('bank-hotlines').locator(':scope > li')).toHaveCount(BANK_HOTLINES.length)
  await expect(page.getByRole('heading', { level: 2, name: 'Bank fraud hotlines' })).toBeVisible()
  for (const title of ['ScamShield', 'Police report', 'MoneySense', 'FIDReC', 'MAS']) {
    await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible()
  }
  await expect(page.getByText('Last checked 18 Nov 2026.')).toBeVisible()
  await context.close()
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
