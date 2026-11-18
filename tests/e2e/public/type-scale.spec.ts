import { expect, test } from '@playwright/test'

// Addendum V §V1 acceptance, as rendered: on each public page fewer than a third of text elements are 14 px, no body
// paragraph is below 16 px, and the H1 is 36 px on phones and 52 px on desktops. Captions and helper text stay 14 px in
// the muted colour, which is how they are told apart from body copy.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }))
})

const PAGES = ['/', '/how-it-works', '/pricing', '/about', '/faq', '/resources', '/marketplace']

for (const path of PAGES) {
  test(`${path}: type scale`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' })
    const result = await page.evaluate(() => {
      const visible = (el: Element) => el.getClientRects().length > 0 && !el.closest('.sr-only')
      const size = (el: Element) => parseFloat(getComputedStyle(el).fontSize)
      const texts = [...document.querySelectorAll('main *')].filter(
        (el) => visible(el) && [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 1),
      )
      const smallBody = [...document.querySelectorAll('main p, main li, main blockquote')]
        .filter((el) => visible(el) && (el.textContent ?? '').trim().length > 80 && size(el) < 16 && !el.closest('.text-muted-foreground'))
        .map((el) => (el.textContent ?? '').trim().slice(0, 50))
      return {
        share: texts.filter((el) => size(el) < 15).length / texts.length,
        smallBody,
        h1: size(document.querySelector('main h1')!),
      }
    })
    expect(result.share, 'share of 14 px text').toBeLessThan(1 / 3)
    expect(result.smallBody, 'body copy below 16 px').toEqual([])
    // §V1: 36 px on phones, 48 px on tablets, 52 px on desktops.
    const width = page.viewportSize()!.width
    expect(result.h1).toBe(width < 640 ? 36 : width < 1024 ? 48 : 52)
  })
}
