import { expect, test } from '@playwright/test'
import { marketingRoutes, routerStaticRoutes } from '../fixtures/public-routes'
import {
  expectNamedInteractiveControls,
  expectNoHorizontalOverflow,
  monitorClientErrors,
} from '../helpers/page-quality'

for (const route of [...marketingRoutes, ...routerStaticRoutes]) {
  test(`${route.path} renders without redirect, overflow, or client errors`, async ({ page }) => {
    const errors = monitorClientErrors(page)
    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' })

    expect(response?.status(), `HTTP status for ${route.path}`).toBeLessThan(400)
    expect(new URL(page.url()).pathname).toBe(route.expectedPath ?? route.path)
    await expect(page.getByRole('heading', { name: route.landmark }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await expectNamedInteractiveControls(page)
    errors.assertNoHydrationErrors()
    errors.assertNone()
  })
}
