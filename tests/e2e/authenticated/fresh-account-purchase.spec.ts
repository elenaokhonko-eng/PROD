import { expect, test } from '../fixtures/harbor-test'
import { createServiceClientFromEnvironment } from '../helpers/disposable-records'
import {
  completeFreeEvaluation,
  deleteClerkUser,
  payWithTestCard,
  smsPhishingNarrative,
  startFreshCase,
  syntheticNarrative,
} from '../helpers/fresh-account'
import { PAID_STAGES_DEFERRED, paidStagesEnabled } from '../helpers/paid-stages'

// A brand-new account on the default free plan goes through the product the way a customer does: onboarding creates
// the case, the journey questions, the intake form, any follow-up questions, an evidence upload, confirming the facts
// in the dashboard and the free evaluation. Stage 1 (paid stages off) then shows the next steps; with paid stages on,
// the D6 regression continues to Stripe test-mode Checkout and the report. Nothing is seeded for these accounts.
// Synthetic content only. The Clerk test user is deleted afterwards; its purchase rows stay as payment records.

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('fresh free account', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Creates a Clerk user and a Stripe test payment once per release SHA.')
  })

  test('a brand-new free account completes the free evaluation and sees the next steps (stage 1)', async ({ page }) => {
    test.skip(paidStagesEnabled, 'Stage 1 only: with paid stages on, the purchase test below covers this path.')
    test.setTimeout(30 * 60_000)
    const supabase = createServiceClientFromEnvironment()
    const { clerkUserId, caseId, email } = await startFreshCase(page, supabase, smsPhishingNarrative)

    try {
      await completeFreeEvaluation(page, caseId, smsPhishingNarrative)
      // The SRF section is written by the server from fixed rules, never by the model.
      await expect(page.getByText('How the rules may apply', { exact: true })).toBeVisible()
      await expect(page.getByText(/^- SRF: the Shared Responsibility Framework/m).first()).toBeVisible()

      await expect(page.getByRole('heading', { name: 'Your next steps' })).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText('Available shortly', { exact: true }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: /Get Bank Pack/i })).toHaveCount(0)
      await page.getByRole('button', { name: 'Email me when it’s available' }).first().click()
      await expect(page.getByText(/^Thank you\. We’ll email /)).toBeVisible()

      // Checkout refuses both products until stage 2.
      const token = await page.evaluate(async () => {
        const clerk = (globalThis as unknown as { Clerk?: { session?: { getToken(o: { template: string }): Promise<string | null> } } }).Clerk
        return clerk?.session?.getToken({ template: 'supabase' }) ?? null
      })
      for (const productKey of ['self_serve_report', 'fidrec_tier2_pack']) {
        const response = await page.request.post('/api/payments/create-checkout-session', {
          data: { caseId, productKey },
          headers: { authorization: `Bearer ${token}` },
          maxRedirects: 0,
        })
        expect(response.status(), productKey).toBe(409)
        expect(((await response.json()) as { reason?: string }).reason).toBe('product_not_available')
      }
    } finally {
      await supabase.from('waitlist').delete().eq('email', email.toLowerCase())
      await deleteClerkUser(clerkUserId)
    }
  })

  test('a brand-new free account can buy the S$18 report end to end', async ({ page }) => {
    test.skip(!paidStagesEnabled, PAID_STAGES_DEFERRED)
    test.setTimeout(30 * 60_000)
    const supabase = createServiceClientFromEnvironment()
    const { clerkUserId, caseId, email } = await startFreshCase(page, supabase, syntheticNarrative)

    try {
      await completeFreeEvaluation(page, caseId, syntheticNarrative)
      const buy = page.getByRole('button', { name: /Get Bank Pack/i })
      await expect(buy).toBeEnabled()

      await buy.click()
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 120_000 })
      await payWithTestCard(page, email)
      await page.waitForURL(new RegExp(`/app/case/${caseId}/dashboard`), { timeout: 180_000 })

      await expect
        .poll(async () => {
          const { data } = await supabase
            .from('case_purchases')
            .select('product_code, payment_status, amount')
            .eq('case_id', caseId)
          return data
        }, { timeout: 180_000, message: 'Stripe webhook records the paid purchase' })
        .toEqual([{ product_code: 'self_serve_report', payment_status: 'paid', amount: 18 }])

      // A generated report has its own title; every report shows these.
      await expect(page.getByText('Executive summary', { exact: true })).toBeVisible({ timeout: 15 * 60_000 })
      await expect(page.getByText('Generated automatically by GuideBuoy AI').first()).toBeVisible()
      const { data: reports } = await supabase.from('reports').select('status').eq('case_id', caseId)
      expect(reports).toEqual([{ status: 'COMPLETED' }])
    } finally {
      await deleteClerkUser(clerkUserId)
    }
  })
})
