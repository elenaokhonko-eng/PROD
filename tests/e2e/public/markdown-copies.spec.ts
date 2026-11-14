import { expect, test } from '@playwright/test'
import { MARKDOWN_COPIES } from '../../../lib/seo/public-routes.mjs'

// Addendum M §M6 and Addendum A §A3–A5, against the production build.
const CHROME_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }))
})

for (const { name, route } of MARKDOWN_COPIES) {
  test(`${route}: markdown copy, headers, negotiation and discovery`, async ({ request, page }) => {
    const copy = await request.get(`/${name}.md`)
    expect(copy.status()).toBe(200)
    const headers = copy.headers()
    expect(headers['content-type']).toBe('text/markdown; charset=utf-8')
    expect(headers.vary).toContain('Accept')
    expect(headers.link).toContain(`<https://guidebuoyai.sg${route === '/' ? '' : route}>; rel="canonical"`)
    expect(Number(headers['x-markdown-tokens'])).toBeGreaterThan(0)
    const markdown = await copy.text()
    expect(markdown.startsWith('---\ntitle: ')).toBe(true)
    expect(markdown).toMatch(/^# .+/m)

    const html = await request.get(route, { headers: { Accept: 'text/html' } })
    expect(html.headers()['content-type']).toContain('text/html')
    expect(Buffer.byteLength(markdown)).toBeLessThan((await html.body()).byteLength / 4)
    expect(html.headers().link).toContain(`</${name}.md>; rel="alternate"; type="text/markdown"`)

    const negotiated = await request.get(route, { headers: { Accept: 'text/markdown' } })
    expect(negotiated.headers()['content-type']).toBe('text/markdown; charset=utf-8')
    expect(await negotiated.text()).toBe(markdown)
    for (const accept of ['*/*', CHROME_ACCEPT, 'text/html, text/markdown']) {
      const response = await request.get(route, { headers: { Accept: accept } })
      expect(response.headers()['content-type'], accept).toContain('text/html')
    }

    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await expect(page.locator(`head link[rel="alternate"][type="text/markdown"][href$="/${name}.md"]`)).toHaveCount(1)
  })
}

test('the home copy points to the story box and the FAQ copy has every answer', async ({ request }) => {
  expect(await (await request.get('/index.md')).text()).toContain('Start your free evaluation at https://guidebuoyai.sg/#tell-your-story')
  const faq = await (await request.get('/faq.md')).text()
  expect(faq).toContain('### What is the free evaluation?')
  expect(faq).toContain('GuideBuoy puts your facts in order')
})

test('account, app and API addresses have no markdown copy', async ({ request }) => {
  for (const path of ['/sign-in.md', '/sign-up.md', '/onboarding.md', '/app.md', '/api/health.md', '/markdown/pricing']) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404)
  }
})

test('llms.txt links each copy and every link answers; llms-full.txt has every page; the sitemap has no copies', async ({ request }) => {
  const llms = await (await request.get('/llms.txt')).text()
  const links = [...llms.matchAll(/\]\((https:\/\/guidebuoyai\.sg[^)]*)\)/g)].map((match) => match[1])
  expect(links).toEqual(MARKDOWN_COPIES.map((copy) => `https://guidebuoyai.sg/${copy.name}.md`))
  for (const link of links) expect((await request.get(link.replace('https://guidebuoyai.sg', ''))).status(), link).toBe(200)

  const full = await request.get('/llms-full.txt')
  expect(full.status()).toBe(200)
  const fullText = await full.text()
  for (const { route } of MARKDOWN_COPIES) expect(fullText).toContain(`URL: https://guidebuoyai.sg${route === '/' ? '' : route}\n`)

  expect(await (await request.get('/sitemap.xml')).text()).not.toContain('.md<')
})

test('auth.md is served as markdown', async ({ request }) => {
  const response = await request.get('/auth.md')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toBe('text/markdown; charset=utf-8')
  expect(await response.text()).toContain('# GuideBuoy auth.md')
})
