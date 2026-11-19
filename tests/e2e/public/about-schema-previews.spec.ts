import { expect, test } from '@playwright/test'
import { FAQ_GROUPS, faqAnswer } from '../../../lib/harbor/faq'
import { MARKDOWN_COPIES } from '../../../lib/seo/public-routes.mjs'
import { expectNoHorizontalOverflow } from '../helpers/page-quality'

// Brief W1 §G, §J, §L5, §L6 (Release 4), checked in the server HTML and the rendered page.

const ROUTES = MARKDOWN_COPIES.map((copy) => copy.route)
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>)
const meta = (html: string, property: string) =>
  html.match(new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`))?.[1]

test('§L6: every indexable page has its own og:url, title and a 1200 × 630 PNG preview image', async ({ request }) => {
  for (const route of ROUTES) {
    const html = await (await request.get(route)).text()
    // Next.js writes the home page's address without the trailing slash, as in its canonical link.
    expect(meta(html, 'og:url'), route).toBe(route === '/' ? 'https://guidebuoyai.sg' : `https://guidebuoyai.sg${route}`)
    expect(meta(html, 'og:title'), route).toBe(html.match(/<title>([^<]*)<\/title>/)?.[1])
    expect(meta(html, 'twitter:card'), route).toBe('summary_large_image')
    const image = meta(html, 'og:image')
    expect(image, route).toBeTruthy()
    expect(meta(html, 'og:image:width'), route).toBe('1200')
    expect(meta(html, 'og:image:height'), route).toBe('630')
    const response = await request.get(new URL(image!).pathname + new URL(image!).search)
    expect(response.status(), `${route} image`).toBe(200)
    expect(response.headers()['content-type'], `${route} image`).toBe('image/png')
    const png = await response.body()
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], `${route} image size`).toEqual([1200, 630])
  }
})

test('§L5: structured data is in the server HTML of Home, Pricing, FAQ and About', async ({ request }) => {
  const types = async (route: string) => jsonLd(await (await request.get(route)).text()).map((d) => d['@type'])
  expect(await types('/')).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'WebApplication']))
  expect(await types('/pricing')).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'WebApplication']))
  expect(await types('/faq')).toEqual(expect.arrayContaining(['Organization', 'FAQPage']))
  expect(await types('/about')).toEqual(expect.arrayContaining(['Organization', 'Person']))
  const pricing = jsonLd(await (await request.get('/pricing')).text()).find((d) => d['@type'] === 'WebApplication')!
  // This build has the paid packs off.
  expect((pricing.offers as { availability: string }[]).map((o) => o.availability)).toEqual([
    'https://schema.org/InStock',
    'https://schema.org/PreOrder',
    'https://schema.org/PreOrder',
  ])
})

test('§J: every FAQ question and answer is in the server HTML, and several can be open at once', async ({ page, request }) => {
  const html = (await (await request.get('/faq')).text()).replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  for (const item of FAQ_GROUPS.flatMap((group) => group.items)) {
    expect(html, item.question).toContain(item.question)
    expect(html, item.question).toContain(faqAnswer(item, false))
  }
  await page.goto('/faq', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Who is GuideBuoy for?' }).click()
  await page.getByRole('button', { name: 'Can I get a refund?' }).click()
  await expect(page.getByText(/Anyone aged 18 or over/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Terms, clause 6.4' })).toBeVisible()
})

test('§G: About shows the founder note, the company check and ends with the primary button', async ({ page }) => {
  await page.goto('/about', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'The burden should sit on the system, not the person who was harmed.' })).toBeVisible()
  await expect(page.getByText(/I started GuideBuoy after helping friends/)).toBeVisible()
  await expect(page.getByText('— Elena Okhonko, founder')).toBeVisible()
  const company = page.getByRole('region', { name: 'Check this company' })
  await expect(company).toContainText('GuideBuoy AI SG Pte Ltd · UEN 202545875C')
  await expect(company.getByRole('link', { name: /Check on ACRA BizFile/ })).toHaveAttribute('href', 'https://www.bizfile.gov.sg/')
  await expect(page.locator('main').getByRole('link', { name: 'Start my free evaluation' }).last()).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
