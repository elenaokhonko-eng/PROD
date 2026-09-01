import { expect, type Page } from '@playwright/test'

const hydrationPattern = /hydration|did not match|server html|hydrating/i
const ignoredConsolePatterns = [
  /Download the React DevTools/i,
]

export function monitorClientErrors(page: Page) {
  const errors: string[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (!ignoredConsolePatterns.some((pattern) => pattern.test(text))) errors.push(`console: ${text}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

  return {
    assertNone() {
      expect(errors, `Unexpected browser errors on ${page.url()}`).toEqual([])
    },
    assertNoHydrationErrors() {
      expect(errors.filter((message) => hydrationPattern.test(message))).toEqual([])
    },
    all: errors,
  }
}

export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }))
  expect(
    dimensions.content,
    `Horizontal overflow: content=${dimensions.content}px viewport=${dimensions.viewport}px on ${page.url()}`,
  ).toBeLessThanOrEqual(dimensions.viewport + 1)
}

export async function expectNamedInteractiveControls(page: Page) {
  const unnamed = await page.locator('a, button, input, select, textarea').evaluateAll((elements) => {
    const hasAccessibleName = (element: HTMLElement) => {
      const explicit = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.title
      if (explicit?.trim()) return true

      if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
        if (label?.textContent?.trim()) return true
      }
      if (element.closest('label')?.textContent?.trim()) return true
      if (element.textContent?.trim()) return true

      const imageAlt = element.querySelector('img[alt]')?.getAttribute('alt')
      return Boolean(imageAlt?.trim())
    }

    return elements
      .filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      })
      .filter((element) => !hasAccessibleName(element as HTMLElement))
      .map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}: ${element.outerHTML.slice(0, 180)}`)
  })

  expect(unnamed, `Visible interactive controls must have accessible names on ${page.url()}`).toEqual([])
}

export async function expectMinimumTextContrast(page: Page, minimumRatio = 4.5) {
  const failures = await page.evaluate((minimum) => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)/)
      if (!match) return null
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] ? Number(match[4]) : 1 }
    }
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channels = [r, g, b].map((channel) => {
        const value = channel / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }
    const backgroundFor = (element: Element) => {
      let current: Element | null = element
      while (current) {
        const color = parse(getComputedStyle(current).backgroundColor)
        if (color && color.a >= 0.99) return color
        current = current.parentElement
      }
      return { r: 255, g: 255, b: 255, a: 1 }
    }

    return Array.from(document.querySelectorAll('h1, h2, h3, p, a, button, label, li, span'))
      .filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return Boolean(element.textContent?.trim()) && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      })
      .flatMap((element) => {
        const foreground = parse(getComputedStyle(element).color)
        if (!foreground || foreground.a < 0.99) return []
        const background = backgroundFor(element)
        const light = Math.max(luminance(foreground), luminance(background))
        const dark = Math.min(luminance(foreground), luminance(background))
        const ratio = (light + 0.05) / (dark + 0.05)
        return ratio + 0.05 < minimum
          ? [`${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 80)}" ratio=${ratio.toFixed(2)}`]
          : []
      })
      .slice(0, 20)
  }, minimumRatio)

  expect(failures, `Text contrast below ${minimumRatio}:1 on ${page.url()}`).toEqual([])
}
