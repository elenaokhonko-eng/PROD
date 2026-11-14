import { expect, test } from '@playwright/test'

// Brief W1 §A and §4.1: the primary button is on the first screen at phone and desktop sizes; the phone header has
// its own start button; on phones a sticky start bar appears only after the story box.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }))
})

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1366, height: 768 },
]) {
  test(`the primary button is visible without scrolling at ${viewport.width} x ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const hero = page.locator('main').getByRole('link', { name: 'Start my free evaluation' }).first()
    await expect(hero).toBeVisible()
    const box = await hero.boundingBox()
    expect(box, 'hero button has a box').not.toBeNull()
    expect(box!.y + box!.height, 'the hero button ends inside the first screen').toBeLessThanOrEqual(viewport.height)
    await expect(hero).toHaveAttribute('href', '/#tell-your-story')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Scammed? Find out where you stand, and what to do next.')
  })
}

test('the phone header carries the start button next to the menu', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const header = page.locator('header').first()
  await expect(header.getByRole('link', { name: 'Start my free evaluation' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Open navigation menu' })).toBeVisible()
})

test('on phones the sticky start bar appears only after the story box', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const bar = page.getByTestId('sticky-start-bar')
  await expect(bar).toHaveCount(0)

  await page.locator('#tell-your-story').scrollIntoViewIfNeeded()
  await expect(bar).toHaveCount(0)

  await page.getByRole('heading', { name: 'Three ways we can help' }).scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 400))
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('link', { name: 'Start my free evaluation' })).toHaveAttribute('href', '/#tell-your-story')

  await page.locator('footer').scrollIntoViewIfNeeded()
  await expect(bar).toHaveCount(0)
})
