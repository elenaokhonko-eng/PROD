import { expect, test } from '../fixtures/harbor-test'
import { createClerkUser, deleteClerkUser, signIn, smsPhishingNarrative } from '../helpers/fresh-account'

// G3b re-check, 11 Nov (R-02): a new account's token has no supabase_uuid for the first seconds after sign-up (2.5 to
// 2.7 s in three probes), until Clerk's user.created webhook links it to its profile. A person who wrote their story
// first lands on /onboarding inside that window, and the case failed to start. Unlike startFreshCase, these accounts do
// not wait for the webhook: they sign in and open onboarding at once, as a person does. Synthetic content only.

// About 1,800 words, like the long story in the re-check (L-13), and under the 20,000-character limit.
const longNarrative = Array.from({ length: 30 }, (_, i) =>
  `Day ${i + 1} of what happened. On 3 October 2026 an SMS that looked like it came from Synthetic Bank said my ` +
  'token had expired and gave a link. I opened it, entered my login and the one-time password, and the page said ' +
  'the token was renewed. That evening S$4,250 left my savings account to a payee I did not know and S$780 was ' +
  'charged to my card. I called the bank on 4 October and reported it to the police on 5 October.',
).join(' ')

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('new account onboarding', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Creates Clerk users once per release SHA.')
  })

  for (const [name, narrative] of [
    ['short story', smsPhishingNarrative],
    ['long story', longNarrative],
    ['short story again', smsPhishingNarrative],
  ] as const) {
    test(`a new account starts its case on the first attempt straight after sign-up (${name})`, async ({ page }) => {
      test.setTimeout(5 * 60_000)
      expect(narrative.length).toBeLessThanOrEqual(20_000)
      const email = `harbor.release.onboard.${Date.now()}.${Math.random().toString(36).slice(2, 8)}+clerk_test@example.com`
      const clerkUserId = await createClerkUser(email)
      const statuses: number[] = []
      page.on('response', (response) => {
        if (new URL(response.url()).pathname === '/api/cases/bootstrap') statuses.push(response.status())
      })

      try {
        await signIn(page, clerkUserId)
        await page.evaluate((story) => sessionStorage.setItem('gb_pending_narrative', JSON.stringify({ narrative: story })), narrative)
        await page.goto('/onboarding')
        await page.waitForURL(/\/app\/case\/[0-9a-f-]{36}\/dashboard$/, { timeout: 120_000 })
        await expect(page.getByText('We couldn’t start your case.', { exact: false })).toHaveCount(0)
        expect(statuses[0], 'the first case-start request succeeds').toBe(201)
      } finally {
        await deleteClerkUser(clerkUserId)
      }
    })
  }
})
