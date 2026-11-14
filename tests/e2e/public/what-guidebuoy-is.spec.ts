import { expect, test } from '@playwright/test'

// Brief W1 §B3 acceptance: one "What GuideBuoy is" block on each page that sells or explains the product; on every
// public page "has not been reviewed by a person" appears 0 times and "S$99" at most twice.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }))
})

const WITH_BLOCK = ['/', '/pricing', '/how-it-works', '/about', '/faq', '/product']
const PUBLIC_PAGES = [...WITH_BLOCK, '/resources', '/marketplace']

for (const path of PUBLIC_PAGES) {
  test(`${path}: no repeated disclaimer, the consultation price at most twice`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    expect(text.match(/has not been reviewed by a person/gi) ?? []).toHaveLength(0)
    expect((text.match(/S\$99/g) ?? []).length).toBeLessThanOrEqual(2)
    const blocks = page.getByRole('complementary', { name: 'What GuideBuoy is' })
    await expect(blocks).toHaveCount(WITH_BLOCK.includes(path) ? 1 : 0)
    if (WITH_BLOCK.includes(path)) {
      await expect(blocks).toContainText('It is automated and is not legal advice; you check everything before you send it.')
      await expect(blocks.getByRole('link', { name: 'Email to book' })).toHaveAttribute('href', /^mailto:info@guidebuoyai\.sg/)
    }
  })
}
