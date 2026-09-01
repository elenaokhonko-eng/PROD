import { expect, test } from '@playwright/test'
import { readHarborAnalyticsConfigured } from '../config'
import { expectMinimumTextContrast, expectNoHorizontalOverflow } from '../helpers/page-quality'

test('keyboard-only flow reaches navigation and returns focus after closing settings dialog', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  await page.keyboard.press('Tab')
  const firstFocus = page.locator(':focus')
  const firstHref = await firstFocus.getAttribute('href')
  const firstLabel = await firstFocus.getAttribute('aria-label')
  expect(firstHref === '#main-content' || firstLabel === 'Display and sensory settings').toBe(true)

  if (firstHref === '#main-content') {
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toHaveAttribute('href', '/')
  }

  const settings = page.getByRole('button', { name: 'Display and sensory settings' })
  await settings.focus()
  const dialog = page.getByRole('dialog')
  await settings.press('Enter')
  await expect(dialog).toBeVisible()

  await expect(dialog.getByRole('heading', { name: 'Display and sensory settings' })).toBeVisible()

  const quietMode = dialog.getByRole('button', { name: 'quiet', exact: true })
  await quietMode.focus()
  await quietMode.press('Space')
  await expect(page.locator('html')).toHaveAttribute('data-sensory', 'quiet')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(settings).toBeFocused()
})

test('home analytics delivery matches configured telemetry mode', async ({ page }, testInfo) => {
  const analyticsConfigured = readHarborAnalyticsConfigured(testInfo.config.metadata)
  let analyticsCalls = 0

  await page.route('**/api/analytics/track**', (route) => {
    analyticsCalls += 1
    return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  if (analyticsConfigured) {
    await expect.poll(() => analyticsCalls).toBeGreaterThanOrEqual(1)
    return
  }

  await page.waitForTimeout(500)
  expect(analyticsCalls).toBe(0)
})

test('router honors reduced motion and keeps readable contrast', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/router', { waitUntil: 'domcontentloaded' })

  const movingElements = await page.locator('body *').evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = getComputedStyle(element)
        const animationMs = parseFloat(style.animationDuration) * (style.animationDuration.includes('ms') ? 1 : 1000)
        const transitionMs = parseFloat(style.transitionDuration) * (style.transitionDuration.includes('ms') ? 1 : 1000)
        return animationMs > 10 || transitionMs > 10
      })
      .map((element) => `${element.tagName.toLowerCase()}.${(element as HTMLElement).className}`)
      .slice(0, 20),
  )

  expect(movingElements, 'Reduced-motion mode must disable nonessential animation and transition').toEqual([])
  await expectNoHorizontalOverflow(page)
  await expectMinimumTextContrast(page)
})
