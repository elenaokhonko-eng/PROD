import { expect, test, type Page } from '@playwright/test'
import { readHarborAuthMode } from '../config'

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

  await page.route('**/api/analytics/track**', (route) =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }),
  )
  await page.route('**/api/resources', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Official resources are not currently available' }),
    }),
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
    const providerAuthUnavailable =
      path.startsWith('/sign-') && readHarborAuthMode(testInfo.config.metadata) === 'credential-withheld'
    test.skip(providerAuthUnavailable, 'Provider auth visuals require configured nonproduction Clerk credentials.')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(path, { waitUntil: 'domcontentloaded' })

    if (path.startsWith('/sign-')) {
      await expect(page.locator('.cl-rootBox')).toBeVisible()
    } else {
      await expect(page.locator('main')).toBeVisible()
    }

    await settleRoute(page, path)

    await expect(page).toHaveScreenshot(`${snapshotName(path)}-${testInfo.project.name}.png`, {
      animations: 'disabled',
      fullPage: true,
      maxDiffPixelRatio: 0.005,
    })
  })
}

async function settleRoute(page: Page, path: (typeof routes)[number]) {
  if (path === '/resources') {
    await expect(page.getByRole('heading', { level: 2, name: 'Official resources are not currently available' })).toBeVisible()
    return
  }

  if (path === '/coming-soon' || path === '/marketplace/volunteers') {
    await expect.poll(() => new URL(page.url()).pathname).toBe('/marketplace')
    await expect(page.getByRole('heading', { level: 1, name: 'Help categories being considered.' })).toBeVisible()
    return
  }

  if (path === '/router/tracker') {
    await expect(page.getByRole('heading', { level: 1, name: 'Keep your complaint records together' })).toBeVisible()
  }
}

function snapshotName(path: string) {
  return path === '/' ? 'home' : path.slice(1).replaceAll('/', '-')
}
