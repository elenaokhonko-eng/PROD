import { expect, test } from '@playwright/test'
import { expectMinimumTextContrast, expectNoHorizontalOverflow } from '../helpers/page-quality'

test('keyboard-only flow reaches primary navigation and opens and closes Lumi support', async ({ page }) => {
  await page.goto('/')

  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveAttribute('href', '/')

  const openLumi = page.getByRole('button', { name: 'Open Lumi support' })
  await openLumi.focus()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Lumi is listening' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator(':focus')).toHaveCount(1)

  const focusable = dialog.locator(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  const focusableCount = await focusable.count()
  await focusable.last().focus()
  await page.keyboard.press('Tab')
  await expect(focusable.first()).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(openLumi).toBeFocused()
  expect(focusableCount).toBeGreaterThan(0)
})

test('router honors reduced motion and keeps readable contrast', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/router')

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
