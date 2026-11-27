import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/harbor-test'
import { PACK_ACTION } from '../../../lib/harbor/packs'
import { createServiceClientFromEnvironment } from '../helpers/disposable-records'
import {
  createLinkedAccount,
  deleteClerkUser,
  payWithTestCard,
  startFreshCase,
  syntheticNarrative,
} from '../helpers/fresh-account'
import { PAID_STAGES_DEFERRED, paidStagesEnabled } from '../helpers/paid-stages'
import { answerTimeline, FINAL_REPLY_TEN_DAYS_AGO } from '../helpers/fidrec-timeline'

// CR-2 (26 Nov 2026): pack first from the public pages into My cases, and nobody signed in is sent back to the public
// home page. Fresh accounts, Stripe test mode, synthetic content only; each Clerk test user is deleted afterwards.
// The sign-up form itself is Clerk's; these tests check that a pack button leads a visitor to it with the pack step as
// the destination, then sign the new account in and open that destination, as Clerk does after sign-up.

test.use({ storageState: { cookies: [], origins: [] } })

const PACKS = [
  { pack: 'bank', productCode: 'self_serve_report', amount: 18 },
  { pack: 'fidrec', productCode: 'escalation_pack', amount: 188 },
] as const

/** Every public home page the browser visits from here on. */
function watchHomeVisits(page: Page) {
  const visits: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return
    const url = new URL(frame.url())
    if (url.hostname !== 'checkout.stripe.com' && url.pathname === '/') visits.push(url.href)
  })
  return visits
}

test.describe('pack first', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Creates Clerk users and Stripe test payments once per release SHA.')
    test.skip(!paidStagesEnabled, PAID_STAGES_DEFERRED)
    test.setTimeout(20 * 60_000)
  })

  for (const start of ['/pricing', '/'] as const) {
    for (const { pack, productCode, amount } of PACKS) {
      test(`a new account starting at ${start} buys the ${pack} pack and reaches its documents list`, async ({ page }) => {
        const supabase = createServiceClientFromEnvironment()
        await page.goto(start)
        await page.getByRole('link', { name: PACK_ACTION[pack] }).first().click()
        await page.waitForURL((url) => url.pathname.startsWith('/sign-up'), { timeout: 60_000 })
        expect(new URL(page.url()).searchParams.get('redirect_url')).toBe(`/app/pack/${pack}`)

        const { clerkUserId, email, profileId } = await createLinkedAccount(page, supabase)
        try {
          const homeVisits = watchHomeVisits(page)
          await page.goto(`/app/pack/${pack}`)
          if (pack === 'fidrec') {
            // Sold upfront: the condition is stated, nothing is asked.
            await expect(page.locator('[data-fidrec-before-payment]')).toBeVisible({ timeout: 60_000 })
            const buy = page.getByRole('button', { name: /Prepare my FIDReC case/ })
            await expect(buy).toBeEnabled({ timeout: 60_000 })
            await buy.click()
          }
          await page.waitForURL(/checkout\.stripe\.com/, { timeout: 120_000 })
          await payWithTestCard(page, email)
          await page.waitForURL((url) => url.pathname === '/app', { timeout: 180_000 })

          const { data: cases } = await supabase.from('cases').select('id, primary_narrative').eq('user_id', profileId)
          expect(cases, 'one empty case, created before payment').toHaveLength(1)
          const caseId = cases![0].id as string
          await expect
            .poll(async () => {
              const { data } = await supabase.from('case_purchases').select('product_code, payment_status, amount').eq('case_id', caseId)
              return data
            }, { timeout: 180_000, message: 'Stripe webhook records the paid purchase on the case' })
            .toEqual([{ product_code: productCode, payment_status: 'paid', amount }])

          await page.getByRole('link', { name: 'Add a new case' }).first().click()
          await page.waitForURL((url) => url.pathname === '/app/case/new')
          // CR-2 as amended: a FIDReC case starts with the timeline questionnaire, then the story.
          if (pack === 'fidrec') await answerTimeline(page, FINAL_REPLY_TEN_DAYS_AGO)
          await page.locator('#story').fill(syntheticNarrative)
          await page.getByRole('button', { name: 'Submit the story' }).click()
          await page.waitForURL(new RegExp(`/app/case/${caseId}/dashboard$`), { timeout: 120_000 })
          await expect(page.locator(`[data-pack-evidence="${pack}"]`)).toBeVisible({ timeout: 120_000 })

          const { count } = await supabase.from('cases').select('id', { count: 'exact', head: true }).eq('user_id', profileId)
          expect(count, 'the story filled that case; no second one').toBe(1)
          expect(homeVisits).toEqual([])
        } finally {
          await deleteClerkUser(clerkUserId)
        }
      })
    }
  }

  // Where each pack button ends up (Elena, 27 Nov 2026). The address is printed so the run's log shows it. A visit to
  // "/" is not judged on its own: the home page can report one by itself after it loads (gate run 45867707804).
  for (const cases of ['no case', 'one case'] as const) {
    test(`signed in with ${cases}, every pack button ends inside the dashboard`, async ({ page }) => {
      const supabase = createServiceClientFromEnvironment()
      const account =
        cases === 'one case'
          ? await startFreshCase(page, supabase, syntheticNarrative)
          : await createLinkedAccount(page, supabase)
      const caseId = 'caseId' in account ? (account.caseId as string) : null
      try {
        const buttons = [
          { from: '/pricing', name: PACK_ACTION.bank, pack: 'bank' },
          { from: '/pricing', name: PACK_ACTION.fidrec, pack: 'fidrec' },
          { from: '/', name: PACK_ACTION.bank, pack: 'bank' },
          { from: '/', name: PACK_ACTION.fidrec, pack: 'fidrec' },
          // The route strip on the home page.
          { from: '/', name: 'Bank dispute pack', pack: 'bank' },
          { from: '/', name: 'FIDReC escalation pack', pack: 'fidrec' },
        ] as const
        const ended = (url: URL, pack: 'bank' | 'fidrec') =>
          caseId
            ? url.pathname === `/app/case/${caseId}/dashboard` && url.searchParams.get('pack') === pack
            : pack === 'bank'
              ? url.hostname === 'checkout.stripe.com'
              : url.pathname === '/app/pack/fidrec'
        for (const { from, name, pack } of buttons) {
          await page.goto(from, { waitUntil: 'networkidle' })
          await page.getByRole('link', { name, exact: true }).first().click()
          await page.waitForURL((url) => ended(url, pack), { timeout: 120_000 })
          const address = new URL(page.url())
          console.log(`pack button: ${cases}: "${name}" on ${from} -> ${address.hostname}${address.hostname === 'checkout.stripe.com' ? '' : address.pathname + address.search}`)
          if (caseId) await expect(page.locator(`[data-asked-pack="${pack}"]`)).toBeVisible({ timeout: 120_000 })
          else if (pack === 'fidrec') await expect(page.locator('[data-pack-first="fidrec"] [data-fidrec-offer]')).toBeVisible({ timeout: 120_000 })
        }
        // Back from Stripe: no stuck "Redirecting to secure payment" screen. With a case, the buy button on it opens
        // Stripe and Back returns to that case; with none, Back is My cases.
        await page.goto('/pricing', { waitUntil: 'networkidle' })
        await page.getByRole('link', { name: PACK_ACTION.bank, exact: true }).first().click()
        if (caseId) {
          await page.locator('[data-asked-pack="bank"]').getByRole('button', { name: /Get Bank dispute pack/ }).click()
        }
        await page.waitForURL(/checkout\.stripe\.com/, { timeout: 120_000 })
        await page.goBack()
        await page.waitForURL((url) => url.pathname === (caseId ? `/app/case/${caseId}/dashboard` : '/app'), { timeout: 60_000 })
        await expect(page.getByText('Redirecting to secure payment')).toHaveCount(0)
      } finally {
        await deleteClerkUser(account.clerkUserId)
      }
    })
  }

  test('the free evaluation button never opens Stripe', async ({ page }) => {
    const supabase = createServiceClientFromEnvironment()
    const { clerkUserId } = await createLinkedAccount(page, supabase)
    const paymentRequests: string[] = []
    // A pack chosen and left unpaid earlier must not follow the person into the free evaluation.
    await page.goto('/app/pack/fidrec')
    await expect(page.locator('[data-fidrec-offer]')).toBeVisible({ timeout: 120_000 })
    page.on('request', (request) => {
      if (/checkout\.stripe\.com|create-checkout-session|\/api\/cases\/pack-first/.test(request.url())) paymentRequests.push(request.url())
    })
    try {
      await page.goto('/')
      await page.getByRole('link', { name: 'Start my free evaluation' }).first().click()
      await page.locator('#story').fill(syntheticNarrative)
      await page.getByRole('button', { name: 'Get my free evaluation' }).click()
      await page.waitForURL(/\/app\/case\/[0-9a-f-]{36}\/dashboard$/, { timeout: 180_000 })
      await expect(page.getByText('Where are you with your bank?')).toBeVisible({ timeout: 120_000 })
      expect(paymentRequests).toEqual([])
    } finally {
      await deleteClerkUser(clerkUserId)
    }
  })
})
