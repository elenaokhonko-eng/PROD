import { expect, test } from '@playwright/test'

// Brief W1 §K (retired wording) and §L3 (titles and descriptions), as rendered. The Terms and Privacy Policy are legal
// texts and change only through their own review, so they are not scanned here.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }))
})

const RETIRED = [
  'Start organising',
  'Singpass',
  'pathway signal',
  'Complaint Helper',
  'free draft',
  'Report Hub',
  'Full report',
  'durable request',
  'authenticated case workspace',
  'DID +65',
]

const PAGES = ['/', '/how-it-works', '/pricing', '/product', '/about', '/faq', '/resources', '/marketplace', '/sign-in', '/sign-up']

for (const path of PAGES) {
  test(`${path}: none of the retired wording, in the text or the head`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    // textContent, not innerText, so collapsed FAQ answers and screen-reader text count too.
    const text = await page.evaluate(() => {
      const body = document.body.cloneNode(true) as HTMLElement
      body.querySelectorAll('script, style, noscript').forEach((node) => node.remove())
      const head = [document.title, ...[...document.querySelectorAll('meta[content]')].map((meta) => meta.getAttribute('content'))]
      return `${head.join(' ')} ${body.textContent}`.replace(/\s+/g, ' ')
    })
    for (const term of RETIRED) expect(text.toLowerCase(), term).not.toContain(term.toLowerCase())
  })
}

const L3 = [
  ['/', 'Scammed in Singapore? Free scam and bank dispute evaluation · GuideBuoy', 'Tell GuideBuoy what happened and get a free evaluation: your facts in order, how Singapore\'s scam rules may apply, and your next step with your bank or FIDReC.'],
  ['/how-it-works', 'How GuideBuoy prepares your scam or bank dispute, step by step', 'From your story to a checked record and a suggested next step in six steps. Free to start, no card.'],
  ['/pricing', 'GuideBuoy pricing: free evaluation, S$18 bank pack, S$188 FIDReC pack', 'One-off prices, shown before you pay. Start free; choose a pack only if you need one.'],
  ['/about', 'About GuideBuoy AI SG Pte Ltd: who we are and why we built it', 'A Singapore company helping people who represent themselves prepare scam and financial disputes.'],
  ['/faq', 'Scam and bank dispute questions answered · GuideBuoy FAQ', 'Plain answers on getting money back after a scam, bank complaints, FIDReC, costs, privacy and how GuideBuoy works.'],
  ['/resources', 'Scam just happened? Who to call in Singapore · GuideBuoy', 'Bank fraud hotlines, ScamShield, police reporting and official guidance, in the order to use them.'],
  ['/sign-in', 'Sign in · GuideBuoy', null],
  ['/sign-up', 'Create your account · GuideBuoy', null],
] as const

for (const [path, title, description] of L3) {
  test(`${path}: the §L3 title${description ? ' and description' : ''}, and one H1`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle(title)
    if (description) await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', description)
    await expect(page.locator('h1')).toHaveCount(1)
  })
}

test('the resources page leads with calling the bank', async ({ page }) => {
  await page.goto('/resources', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Scam just happened? Call your bank first.')
})

test('the public footer gives the mobile number as Mobile / WhatsApp', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('footer')).toContainText('Mobile / WhatsApp +65 9072 7915')
})
