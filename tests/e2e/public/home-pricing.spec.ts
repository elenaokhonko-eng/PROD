import { expect, test } from '@playwright/test'
import { expectMinimumTextContrast, expectNoHorizontalOverflow } from '../helpers/page-quality'

// Brief W1 §D, §E and Addendum V §V2, V3, V6 (Release 2). The paid packs are off in this build, so the cards show the
// "Coming shortly" state; the live state is covered by tests/contracts/home-pricing.test.ts.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }))
  await page.route('**/api/funnel', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }))
})

test('the emergency strip has the 1799 phone link and stays dismissed for the rest of the visit', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const strip = page.getByTestId('emergency-strip')
  await expect(strip).toBeVisible()
  await expect(strip.getByRole('link', { name: '1799' })).toHaveAttribute('href', 'tel:1799')
  await expect(strip.getByRole('link', { name: 'What to do in the first 24 hours' })).toHaveAttribute('href', '/resources')

  await strip.getByRole('button', { name: 'Dismiss' }).click()
  await expect(strip).toHaveCount(0)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('emergency-strip')).toHaveCount(0)
})

test('the route strip is an ordered list of four stops whose pack links open the pack cards', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const stops = page.getByTestId('route-strip').locator(':scope > li')
  await expect(stops).toHaveCount(4)
  await expect(page.getByTestId('route-strip').getByRole('link', { name: 'Bank dispute pack' })).toHaveAttribute('href', '/pricing#bank-pack')
  await expect(page.getByTestId('route-strip').getByRole('link', { name: 'FIDReC escalation pack' }).first()).toHaveAttribute('href', '/pricing#fidrec-pack')
})

test('on desktop the route strip sits above the story box, on phones below it', async ({ page }) => {
  for (const [width, above] of [[1366, true], [375, false]] as const) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const strip = await page.getByRole('heading', { name: 'Where are you now?' }).boundingBox()
    const story = await page.locator('#tell-your-story').boundingBox()
    expect(strip!.y < story!.y, `route strip above the story box at ${width}px`).toBe(above)
  }
})

test('paid cards show "Coming shortly" and no button while the packs are off', async ({ page }) => {
  await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
  for (const id of ['bank-pack', 'fidrec-pack']) {
    const card = page.locator(`#${id}`)
    await expect(card.getByText('Coming shortly', { exact: true })).toBeVisible()
    await expect(card.getByRole('link')).toHaveCount(0)
  }
  await expect(page.locator('#free-evaluation').getByRole('link', { name: 'Start my free evaluation' })).toBeVisible()
  await expect(page.getByText('Prices in Singapore dollars. No GST is added.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Terms, clause 6.4' })).toHaveAttribute('href', '/terms#section-6')
})

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1366, height: 768 },
]) {
  test(`the Pricing primary button is visible without scrolling at ${viewport.width} x ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
    const button = page.locator('main').getByRole('link', { name: 'Start my free evaluation' }).first()
    const box = await button.boundingBox()
    expect(box, 'the button has a box').not.toBeNull()
    expect(box!.y + box!.height, 'the button ends inside the first screen').toBeLessThanOrEqual(viewport.height)
  })
}

// Addendum V tests 2 and 6: text on every tint keeps 4.5:1 in both themes and in Quiet mode.
for (const path of ['/', '/pricing']) {
  for (const mode of ['light', 'dark', 'quiet'] as const) {
    test(`text contrast on ${path} in ${mode} mode`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' })
      await page.evaluate((m) => {
        if (m === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
        if (m === 'quiet') document.documentElement.setAttribute('data-sensory', 'quiet')
      }, mode)
      await page.locator('#fidrec-pack summary').click()
      await expectMinimumTextContrast(page)
      await expectNoHorizontalOverflow(page)
    })
  }
}
