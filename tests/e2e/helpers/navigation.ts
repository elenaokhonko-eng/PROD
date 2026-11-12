import { expect, type Page } from '@playwright/test'
import { isProductionHost } from '../config'

export async function gotoWithoutProductionRedirect(page: Page, path: string) {
  const probe = await page.request.get(path, { maxRedirects: 0 })
  const previewOrigin = new URL(probe.url()).origin
  let blockedProductionUrl: string | null = null

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (isProductionHost(url.hostname)) {
      blockedProductionUrl = url.href
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })

  if (probe.status() >= 300 && probe.status() < 400) {
    const location = probe.headers().location
    expect(location, `Redirect response for ${path} must include Location`).toBeTruthy()
    const target = new URL(location!, previewOrigin)
    expect(isProductionHost(target.hostname), `Preview redirect attempted to reach production: ${target.href}`).toBe(false)
    expect(target.origin, `Unexpected cross-origin preview redirect: ${target.href}`).toBe(previewOrigin)
  }

  await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect(blockedProductionUrl, `Preview navigation attempted to reach production: ${blockedProductionUrl}`).toBeNull()
  expect(new URL(page.url()).origin).toBe(previewOrigin)
}
