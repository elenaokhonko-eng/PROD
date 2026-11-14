import { expect, test } from '@playwright/test'
import { INDEXABLE_ROUTES, ROBOTS_TXT, SITE_ORIGIN } from '../../../lib/seo/indexing'
import { enumeratePageRoutes, requestPath } from '../../seo-routes'

const robotsMeta = (html: string) => html.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? null
const canonical = (html: string) => html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null

// Brief W1 §L4: every route that answers 200 without signing in is checked as served.
test('only the public marketing pages are indexable, each with its own canonical', async ({ request }) => {
  const indexable = new Set<string>(INDEXABLE_ROUTES)
  const routes = enumeratePageRoutes().filter((r) => !r.dynamic)
  expect(routes.length).toBeGreaterThan(INDEXABLE_ROUTES.length)

  for (const route of routes) {
    const path = requestPath(route)
    const response = await request.get(path, { maxRedirects: 0 })
    if (response.status() !== 200) continue
    const html = await response.text()
    if (indexable.has(path)) {
      expect(robotsMeta(html), path).toBe('index, follow')
      expect(canonical(html), path).toBe(`${SITE_ORIGIN}${path === '/' ? '' : path}`)
      // Addendum A §A4: agents find the machine-readable summary from any public page.
      expect(response.headers()['link'], path).toContain('</llms.txt>; rel="describedby"; type="text/plain"')
    } else {
      expect(robotsMeta(html), path).toBe('noindex, nofollow')
      expect(canonical(html), `${path} must not point search engines at another page`).toBeNull()
    }
  }
})

test('robots.txt, sitemap.xml, llms.txt and the icons are served by the app', async ({ request }) => {
  const robots = await request.get('/robots.txt')
  expect(robots.status()).toBe(200)
  expect(robots.headers()['content-type']).toMatch(/^text\/plain/)
  expect(await robots.text()).toBe(ROBOTS_TXT)

  const llms = await request.get('/llms.txt')
  expect(llms.status()).toBe(200)
  expect(llms.headers()['content-type']).toMatch(/^text\/plain/)
  expect(await llms.text()).toMatch(/^# GuideBuoy AI\n/)

  for (const icon of ['/favicon.ico', '/icon.png', '/apple-icon.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest']) {
    expect((await request.get(icon)).status(), icon).toBe(200)
  }

  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  expect(sitemap.headers()['content-type']).toMatch(/xml/)
  const locs = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  expect(locs).toEqual(INDEXABLE_ROUTES.map((p) => `${SITE_ORIGIN}${p === '/' ? '' : p}`))
})
