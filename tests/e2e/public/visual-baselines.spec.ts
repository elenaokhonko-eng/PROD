import { expect, test } from '@playwright/test'

const routes = [
  '/',
  '/about',
  '/faq',
  '/privacy',
  '/how-it-works',
  '/pricing',
  '/resources',
  '/terms',
  '/marketplace',
  '/marketplace/volunteers',
  '/coming-soon',
  '/product',
  '/sign-in',
  '/sign-up',
  '/router',
  '/router/path-a2',
  '/router/path-e',
  '/router/tracker',
] as const

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('router_session_token', 'router_fixture_session')
  })

  await page.route('**/api/analytics/track', (route) =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }),
  )
  await page.route('**/api/router/session**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: {
          id: 'fixture-session',
          session_token: 'router_fixture_session',
          created_at: '2026-01-01T00:00:00.000Z',
          expires_at: '2026-01-02T00:00:00.000Z',
        },
      }),
    }),
  )
})

for (const path of routes) {
  test(`${path} matches its reviewed visual baseline`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(path, { waitUntil: 'domcontentloaded' })

    if (path.startsWith('/sign-')) {
      await expect(page.locator('.cl-rootBox')).toBeVisible()
    } else {
      await expect(page.locator('main')).toBeVisible()
    }

    await expect(page).toHaveScreenshot(`${snapshotName(path)}-${testInfo.project.name}.png`, {
      animations: 'disabled',
      fullPage: true,
      maxDiffPixelRatio: 0.005,
    })
  })
}

function snapshotName(path: string) {
  return path === '/' ? 'home' : path.slice(1).replaceAll('/', '-')
}
