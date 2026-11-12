import { expect, test } from '@playwright/test'
import { marketingRoutes, routerStaticRoutes } from '../fixtures/public-routes'
import {
  expectNamedInteractiveControls,
  expectNoHorizontalOverflow,
  monitorClientErrors,
} from '../helpers/page-quality'

const routerSessionToken = 'router_public_routes_smoke'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }),
  )

  let createdSessions = 0
  let session = {
    id: 'router-public-session-id',
    session_token: routerSessionToken,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  }

  await page.route('**/api/router/session**', async (route) => {
    const request = route.request()

    if (request.method() === 'POST') {
      createdSessions += 1
      session = {
        id: `router-public-session-${createdSessions}`,
        session_token: routerSessionToken,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ session }) })
      return
    }

    if (request.method() === 'PATCH') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session }) })
      return
    }

    const requestedToken = new URL(request.url()).searchParams.get('token')
    if (requestedToken !== session.session_token) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) })
      return
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session }) })
  })

  await page.route('**/api/resources**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resources: [] }) }),
  )
})

for (const route of [...marketingRoutes, ...routerStaticRoutes]) {
  test(`${route.path} renders without redirect, overflow, or client errors`, async ({ page }) => {
    const errors = monitorClientErrors(page)
    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' })

    expect(response?.status(), `HTTP status for ${route.path}`).toBeLessThan(400)

    if (route.expectedPath) {
      await expect(page).toHaveURL((url) => url.pathname === route.expectedPath)
    } else {
      expect(new URL(page.url()).pathname).toBe(route.path)
    }

    await expect(page.getByRole('heading', { name: route.landmark }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await expectNamedInteractiveControls(page)
    errors.assertNoHydrationErrors()
    errors.assertNone()
  })
}
