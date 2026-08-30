import { expect, test } from '@playwright/test'
import { marketingRoutes } from '../fixtures/public-routes'
import { gotoWithoutProductionRedirect } from '../helpers/navigation'
import { expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

test('preview serves the public release surface without production redirects', async ({ page }) => {
  for (const route of marketingRoutes) {
    const errors = monitorClientErrors(page)
    await gotoWithoutProductionRedirect(page, route.path)
    await expect(page.getByRole('heading', { name: route.landmark }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    errors.assertNone()
  }
})

test('preview serves canonical pricing and how-it-works routes directly', async ({ page }) => {
  for (const path of ['/pricing', '/how-it-works']) {
    await gotoWithoutProductionRedirect(page, path)
    expect(new URL(page.url()).pathname).toBe(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  }
})

test('preview Supabase handshake fails closed', async ({ request }) => {
  const token = `harbor_release_gate_${Date.now()}`
  const response = await request.get(`/api/router/session?token=${token}`, { maxRedirects: 0 })

  expect(response.status(), await response.text()).toBe(404)
  expect(response.headers().location, 'Handshake must not redirect').toBeUndefined()
})
