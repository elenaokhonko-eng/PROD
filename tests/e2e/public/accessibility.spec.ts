import { expect, test } from '@playwright/test'
import { expectMinimumTextContrast, expectNoHorizontalOverflow } from '../helpers/page-quality'

test('keyboard-only flow reaches navigation and returns focus after closing settings dialog', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveAttribute('href', '/')

  const settings = page.getByRole('button', { name: 'Display and sensory settings' })
  await settings.focus()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Display and sensory settings' })).toBeVisible()

  await dialog.getByRole('button', { name: 'quiet', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-sensory', 'quiet')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(settings).toBeFocused()
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
