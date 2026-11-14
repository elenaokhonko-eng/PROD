import { expect, test, type Page } from '@playwright/test'

// Analytics 2 (brief W1 §N), as rendered: the steps before sign-up fire once per tab, carry the tab's channel, and never
// carry the story.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/track**', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }))
})

async function captureSteps(page: Page) {
  const steps: Record<string, unknown>[] = []
  await page.route('**/api/funnel', async (route) => {
    steps.push(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({ status: 204 })
  })
  return steps
}

test('home, story and sign-up steps, once each, with the channel and without the story', async ({ page }) => {
  const steps = await captureSteps(page)
  await page.goto('/?utm_source=test-group&utm_medium=post&utm_campaign=nov', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => steps.map((step) => step.event)).toContain('home_viewed')

  const box = page.getByRole('textbox', { name: 'Your story' })
  await box.fill('A synthetic story used only by this test.')
  await box.pressSequentially(' More.')
  await page.getByRole('button', { name: 'Get my free evaluation' }).click()
  await page.waitForURL(/\/sign-up/)
  await expect.poll(() => steps.map((step) => step.event)).toContain('signup_reached')

  expect(steps.map((step) => step.event)).toEqual(['home_viewed', 'story_started', 'story_submitted', 'signup_reached'])
  const tabIds = new Set(steps.map((step) => step.anon_session_id))
  expect(tabIds.size).toBe(1)
  for (const step of steps) {
    expect(step).toMatchObject({ utm_source: 'test-group', utm_medium: 'post', utm_campaign: 'nov' })
    expect(Object.keys(step).sort()).toEqual(
      ['anon_session_id', 'device_class', 'event', 'path', 'referrer_host', 'utm_campaign', 'utm_medium', 'utm_source'],
    )
    expect(JSON.stringify(step)).not.toContain('synthetic story')
  }
})

test('a reload in the same tab does not count the home page twice', async ({ page }) => {
  const steps = await captureSteps(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => steps.length).toBe(1)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  expect(steps.filter((step) => step.event === 'home_viewed')).toHaveLength(1)
})

test('the funnel address takes only the listed steps', async ({ request }) => {
  const valid = { event: 'home_viewed', anon_session_id: '00000000-0000-4000-8000-000000000001', path: '/', device_class: 'desktop' }
  expect((await request.post('/api/funnel', { data: valid })).status()).toBe(204)
  expect((await request.post('/api/funnel', { data: { ...valid, event: 'page_view' } })).status()).toBe(400)
})

test('Analytics 2 is not shown to visitors', async ({ request }) => {
  expect((await request.get('/analytics2')).status()).toBe(404)
})
