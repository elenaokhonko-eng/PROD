import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { HARBOR_VISUAL_FIXTURES } from '../../lib/harbor/visual-fixtures'

const PUBLIC_ROUTES = [
  { name: 'home', path: '/', markers: ['Tell it once', 'A calmer way to move forward'] },
  { name: 'how-it-works', path: '/how-it-works', markers: ['Six calm steps', 'From something went wrong'] },
  { name: 'pricing', path: '/pricing', markers: ['Free to start. Paid only when you choose more.', 'Clear, one-off prices'] },
  { name: 'resources', path: '/resources', markers: ['Official resources are not currently available', 'Try again'] },
  { name: 'marketplace', path: '/marketplace', markers: ['Future help directory', 'Planned—not currently available through GuideBuoy.'] },
  { name: 'about', path: '/about', markers: ['Why GuideBuoy exists', 'The burden should sit on the system'] },
  { name: 'faq', path: '/faq', markers: ['FAQ and contact', 'Honest answers for a stressful moment.'] },
] as const

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
] as const

test.describe('Harbor responsive visual acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/analytics/track', (route) => route.fulfill({ status: 204 }))
    await page.route('**/api/router/session', (route) => route.fulfill({
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
    }))
  })

  for (const viewport of VIEWPORTS) {
    test(`public routes at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: 'reduce' })

      for (const route of PUBLIC_ROUTES) {
        await page.goto(route.path)
        await expect(page.locator('main')).toBeVisible()
        await expect(page.locator('h1').first()).toBeVisible()
        for (const marker of route.markers) {
          await expect(page.locator('body')).toContainText(marker)
        }
        await expectNoHorizontalOverflow(page)
        await attachScreenshot(page, testInfo, `${viewport.name}-${route.name}`)
      }
    })

    test(`all 61 fixture states at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const capturedFamilies = new Set<string>()

      for (const fixture of HARBOR_VISUAL_FIXTURES) {
        await page.goto(`/harbor-fixtures?state=${encodeURIComponent(fixture.id)}`)
        await expect(page.getByTestId('fixture-card')).toBeVisible()
        await expect(page.getByText(fixture.id, { exact: true })).toBeVisible()
        await expectNoHorizontalOverflow(page)

        if (!capturedFamilies.has(fixture.family)) {
          await attachScreenshot(page, testInfo, `${viewport.name}-family-${fixture.family}`)
          capturedFamilies.add(fixture.family)
        }
      }

      expect(HARBOR_VISUAL_FIXTURES).toHaveLength(61)
      expect(capturedFamilies.size).toBe(9)
    })
  }

  test('theme and sensory combinations remain reversible', async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORTS[0])
    await page.goto('/harbor-fixtures?state=F3-analysis')

    const root = page.locator('html')
    const trigger = page.getByRole('button', { name: 'Display and sensory settings' })
    await trigger.click()
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect(root).toHaveAttribute('data-sensory', 'steady')
    await attachScreenshot(page, testInfo, 'mobile-steady-light')

    await page.getByRole('button', { name: /Use dark theme/ }).click()
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await attachScreenshot(page, testInfo, 'mobile-steady-dark')

    await page.getByRole('button', { name: /Use light theme/ }).click()
    await page.getByRole('button', { name: 'quiet', exact: true }).click()
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect(root).toHaveAttribute('data-sensory', 'quiet')
    await attachScreenshot(page, testInfo, 'mobile-quiet-light')

    await page.getByRole('button', { name: /Use dark theme/ }).click()
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await attachScreenshot(page, testInfo, 'mobile-quiet-dark')

    await page.getByRole('button', { name: 'A moment' }).click()
    await expect(page.getByRole('heading', { name: 'Take a moment' })).toBeVisible()
    await expect(root).toHaveAttribute('data-sensory', 'grounding')
    await attachScreenshot(page, testInfo, 'mobile-grounding-dark')

    await page.getByRole('button', { name: 'Return when ready' }).click()
    await expect(root).toHaveAttribute('data-sensory', 'quiet')
    await expect(trigger).toBeFocused()

    await trigger.click()
    await page.getByRole('button', { name: /Use light theme/ }).click()
    await page.getByRole('button', { name: 'A moment' }).click()
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect(root).toHaveAttribute('data-sensory', 'grounding')
    await attachScreenshot(page, testInfo, 'mobile-grounding-light')

    await page.getByRole('button', { name: 'Return when ready' }).click()
    await expect(root).toHaveAttribute('data-sensory', 'quiet')
    await expect(trigger).toBeFocused()

    await trigger.click()
    await page.getByRole('button', { name: 'steady', exact: true }).click()
    await expect(root).toHaveAttribute('data-sensory', 'steady')
  })
})

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.right > viewport + 1 || bounds.left < -1 || element.scrollWidth > element.clientWidth + 1
      })
      .slice(-8)
      .map((element) => {
        const bounds = element.getBoundingClientRect()
        return {
          element: element.tagName.toLowerCase(),
          className: element.className.toString().slice(0, 120),
          text: element.textContent?.trim().slice(0, 80),
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          boxSizing: getComputedStyle(element).boxSizing,
        }
      })

    const container = document.querySelector<HTMLElement>('.gb-container')
    const containerBounds = container?.getBoundingClientRect()
    const containerStyle = container ? getComputedStyle(container) : null

    return {
      viewport,
      content: document.documentElement.scrollWidth,
      offenders,
      container: container && containerBounds && containerStyle
        ? {
            left: containerBounds.left,
            right: containerBounds.right,
            width: containerBounds.width,
            cssWidth: containerStyle.width,
            boxSizing: containerStyle.boxSizing,
            paddingInline: `${containerStyle.paddingLeft} ${containerStyle.paddingRight}`,
          }
        : null,
    }
  })
  expect(dimensions.content, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1)
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png',
  })
}
