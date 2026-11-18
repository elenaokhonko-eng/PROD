import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }),
  )
})

for (const path of ['/pricing', '/how-it-works']) {
  test(`${path} is a single canonical public route`, async ({ page, request }) => {
    const direct = await request.get(path, { maxRedirects: 0 })
    expect(direct.status(), await direct.text()).toBe(200)
    expect(direct.headers().location).toBeUndefined()

    const errors = monitorClientErrors(page)
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    expect(new URL(page.url()).pathname).toBe(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expectNoHorizontalOverflow(page)
    errors.assertNone()
  })
}

// Brief W1 §I: /product is retired with a permanent redirect; its report outline is on How it works.
test('/product permanently redirects to How it works, which carries the report outline', async ({ page, request }) => {
  const response = await request.get('/product', { maxRedirects: 0 })
  expect(response.status()).toBe(308)
  expect(response.headers().location).toBe('/how-it-works')

  await page.goto('/product', { waitUntil: 'domcontentloaded' })
  expect(new URL(page.url()).pathname).toBe('/how-it-works')
  await expect(page.getByRole('heading', { level: 2, name: 'A structure you can review before using' })).toBeVisible()
  for (const section of ['Summary', 'Chronology', 'Transactions', 'Evidence', 'Open questions', 'Limitations']) {
    await expect(page.getByText(section, { exact: true })).toBeVisible()
  }
})

test('public plan CTAs use canonical routes and avoid retired consultation links', async ({ page }) => {
  const routes = [
    {
      path: '/',
      links: [
        // Brief W1 §A1–A3: the primary button leads to the story box; the /router link is gone.
        { name: 'Start my free evaluation', href: '/#tell-your-story' },
        { name: /See exactly how it works/, href: '/how-it-works' },
      ],
    },
    {
      path: '/pricing',
      links: [
        { name: 'Start my free evaluation', href: '/#tell-your-story' },
        { name: 'See how it works', href: '/how-it-works' },
      ],
    },
    {
      path: '/how-it-works',
      links: [
        { name: 'Start my free evaluation', href: '/#tell-your-story' },
        { name: 'Read the FAQ', href: '/faq' },
      ],
    },
  ] as const

  for (const { path, links } of routes) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })

    const main = page.locator('main')
    for (const link of links) {
      // The start button can appear more than once on a page (hero and closing band); each must point the same way.
      const matches = main.getByRole('link', { name: link.name, exact: true })
      expect(await matches.count(), String(link.name)).toBeGreaterThan(0)
      for (const match of await matches.all()) await expect(match).toHaveAttribute('href', link.href)
    }
    if (path === '/') {
      await expect(page.getByRole('button', { name: 'Get my free evaluation' })).toBeVisible()
    }
    await expect(page.locator('a[href*="consultation"]')).toHaveCount(0)
    await expect(page.locator('a[href*="/api/payments/create-checkout"]')).toHaveCount(0)
  }
})
