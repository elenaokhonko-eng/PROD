import { expect, test } from '@playwright/test'

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
  '/analytics',
  '/router',
  '/router/path-a2',
  '/router/path-e',
  '/router/tracker',
] as const

for (const path of routes) {
  test(`${path} matches its reviewed visual baseline`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(path, { waitUntil: 'networkidle' })
    await expect(page).toHaveScreenshot(`${snapshotName(path)}-${testInfo.project.name}.png`, {
      animations: 'disabled',
      fullPage: true,
      maxDiffPixelRatio: 0.005,
    })
  })
}

function snapshotName(path: string) {
  return path === '/' ? 'home' : path.slice(1).replaceAll('/', '-')
}
