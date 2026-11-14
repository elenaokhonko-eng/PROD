import { expect, test } from '@playwright/test'

// Brief W1 §C and Addendum V §V4, as rendered.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }))
})

test('on a 375 x 812 phone the story heading and the submit button fit in one screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const heading = page.getByRole('heading', { name: 'Tell GuideBuoy what happened — in your own words.' })
  const submit = page.getByRole('button', { name: 'Get my free evaluation' })
  await heading.scrollIntoViewIfNeeded()
  const top = (await heading.boundingBox())!.y
  const submitBox = (await submit.boundingBox())!
  expect(submitBox.y + submitBox.height - top).toBeLessThan(812)
  await expect(page.locator('#story-include')).toBeHidden()
})

test('on a desktop the guidance starts open', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#story-include')).toBeVisible()
})

test('the placeholder is one line and the worked example is text under the box', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('textbox', { name: 'Your story' })).toHaveAttribute('placeholder', 'Start anywhere. You can edit it before you continue.')
  await page.getByText('See an example').click()
  await expect(page.locator('blockquote')).toContainText('On 12 March 2026, at about 9 pm, I received an email that looked like it came from my bank.')
})

test('the story card is the only element on the home page with a box shadow', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const shadowed = await page.evaluate(() =>
    [...document.querySelectorAll('main *')]
      .filter((element) => getComputedStyle(element).boxShadow !== 'none')
      .filter((element) => element.closest('[aria-labelledby="capture-title"]') === element || !element.closest('[aria-labelledby="capture-title"]'))
      .map((element) => element.getAttribute('aria-labelledby') ?? element.tagName.toLowerCase() + '.' + [...element.classList].slice(0, 2).join('.')),
  )
  // Focus rings and form controls inside the story card are its own; outside it, nothing else may cast a shadow.
  expect(shadowed).toEqual(['capture-title'])
})
