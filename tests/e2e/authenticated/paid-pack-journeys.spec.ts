import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/harbor-test'
import { createServiceClientFromEnvironment } from '../helpers/disposable-records'
import {
  addPackEvidence,
  completeFreeEvaluation,
  confirmFactsInDashboard,
  deleteClerkUser,
  payWithTestCard,
  startFreshCase,
  syntheticNarrative,
} from '../helpers/fresh-account'
import { PAID_STAGES_DEFERRED, paidStagesEnabled } from '../helpers/paid-stages'

// Stage 2 (Elena, 20 Nov 2026): each pack works on its own and after the free evaluation. Fresh accounts, Stripe test
// mode, synthetic content only; each Clerk test user is deleted afterwards.

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('paid pack journeys', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Creates Clerk users and Stripe test payments once per release SHA.')
    test.skip(!paidStagesEnabled, PAID_STAGES_DEFERRED)
    test.setTimeout(30 * 60_000)
  })

  // Dates in Singapore time; a final reply ten days ago is one the FIDReC route accepts.
  const daysAgo = (days: number) => new Date(Date.now() + 8 * 3_600_000 - days * 86_400_000).toISOString().slice(0, 10)
  const tenDaysAgo = () => daysAgo(10)

  // Part B walk-through (25 Nov, PB-17), steps 3.2–3.4: each closed route says why, offers no purchase, and the answer
  // can be changed. Before the fix "not complained yet" showed nothing, and an answer could not be changed.
  async function walkClosedFidrecRoutes(page: Page) {
    const offer = page.locator('[data-fidrec-offer]').first()
    const buy = offer.getByRole('button', { name: /Prepare my FIDReC case/ })
    const change = offer.getByRole('button', { name: 'Change my answer' })
    const answer = async (label: string, date: string | null) => {
      await offer.getByText(label, { exact: true }).click()
      if (date) await offer.locator('input[type="date"]').fill(date)
      await offer.getByRole('button', { name: 'Save', exact: true }).click()
    }

    await answer('I haven’t complained to my bank in writing yet', null)
    await expect(offer.getByText(/FIDReC needs your bank to have had the chance to answer first/)).toBeVisible({ timeout: 60_000 })
    await expect(buy).toBeDisabled()

    await change.click()
    await answer('I complained in writing and haven’t had a final reply', daysAgo(3))
    await expect(offer.getByText(/four weeks after your written complaint to the bank\. You can get this pack from/)).toBeVisible({ timeout: 60_000 })
    await expect(buy).toBeDisabled()

    await change.click()
    await answer('Yes, my bank has given its final reply', daysAgo(215))
    await expect(offer.getByText(/up to six months after the bank’s final reply, and that time has passed/)).toBeVisible({ timeout: 60_000 })
    await expect(buy).toBeDisabled()

    await change.click()
  }

  async function rememberIntent(page: Page, intent: 'bank' | 'fidrec') {
    await page.goto('/')
    await page.evaluate((value) => localStorage.setItem('guidebuoy.packIntent', JSON.stringify({ intent: value, at: Date.now() })), intent)
  }

  async function answerFidrecRoute(page: Page) {
    const offer = page.locator('[data-fidrec-offer]').first()
    await offer.getByText('Yes, my bank has given its final reply', { exact: true }).click()
    await offer.locator('input[type="date"]').fill(tenDaysAgo())
    await offer.getByRole('button', { name: 'Save', exact: true }).click()
    const buy = offer.getByRole('button', { name: /Prepare my FIDReC case/ })
    await expect(buy).toBeEnabled({ timeout: 60_000 })
    return buy
  }

  async function payAndReturn(page: Page, email: string, caseId: string, productCode: string, amount: number) {
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 120_000 })
    await payWithTestCard(page, email)
    await page.waitForURL(new RegExp(`/app/case/${caseId}/dashboard`), { timeout: 180_000 })
    const supabase = createServiceClientFromEnvironment()
    await expect
      .poll(async () => {
        const { data } = await supabase.from('case_purchases').select('product_code, payment_status, amount').eq('case_id', caseId).eq('product_code', productCode)
        return data
      }, { timeout: 180_000, message: 'Stripe webhook records the paid purchase' })
      .toEqual([{ product_code: productCode, payment_status: 'paid', amount }])
  }

  test('the Bank dispute pack bought straight away, without the free evaluation (?intent=bank)', async ({ page }) => {
    const supabase = createServiceClientFromEnvironment()
    await rememberIntent(page, 'bank')
    const { clerkUserId, caseId, email } = await startFreshCase(page, supabase, syntheticNarrative)
    try {
      const intent = page.locator('[data-pack-intent="bank"]')
      await intent.getByRole('button', { name: /Get Bank dispute pack/ }).click()
      await payAndReturn(page, email, caseId, 'self_serve_report', 18)

      // Part B walk-through (25 Nov, PB-2): facts confirmed before the documents are added. The S$18 purchase test
      // keeps the other order (documents first).
      await confirmFactsInDashboard(page, caseId, 'bank')
      await expect(page.getByText('Thank you, your facts are confirmed', { exact: true })).toBeVisible({ timeout: 60_000 })
      await expect(page.getByRole('button', { name: 'Generate your Bank dispute pack' })).toBeDisabled()
      await addPackEvidence(page, 'bank')
      // Once the documents are read the step goes back to the facts by itself, and one press confirms and starts the pack.
      await expect(page.getByRole('heading', { name: 'Confirm your facts' })).toBeVisible({ timeout: 120_000 })
      await confirmFactsInDashboard(page, caseId, 'bank')
      await expect(page.getByText('Executive summary', { exact: true })).toBeVisible({ timeout: 5 * 60_000 })
      await expect(page.getByText('We couldn’t prepare your bank dispute pack')).toHaveCount(0)
      const { data: narratives } = await supabase.from('case_narratives').select('id').eq('case_id', caseId).eq('narrative_type', 'tier0_summary')
      expect(narratives, 'no free evaluation was needed').toEqual([])
      const { data: snapshots } = await supabase
        .from('case_fact_snapshots')
        .select('id')
        .eq('case_id', caseId)
        .eq('stage', 'bank')
        .order('created_at', { ascending: false })
      expect(snapshots, 'one confirmation before the documents, one after').toHaveLength(2)
      const { data: reports } = await supabase.from('reports').select('report_type, status, fact_snapshot_id').eq('case_id', caseId)
      expect(reports).toEqual([{ report_type: 'bank_pack_v1', status: 'COMPLETED', fact_snapshot_id: snapshots?.[0]?.id }])
    } finally {
      await deleteClerkUser(clerkUserId)
    }
  })

  test('the free evaluation, then the FIDReC pack', async ({ page }) => {
    const supabase = createServiceClientFromEnvironment()
    const { clerkUserId, caseId, email } = await startFreshCase(page, supabase, syntheticNarrative)
    try {
      await completeFreeEvaluation(page, caseId, syntheticNarrative)
      const buy = await answerFidrecRoute(page)
      await buy.click()
      await payAndReturn(page, email, caseId, 'escalation_pack', 188)

      await addPackEvidence(page, 'fidrec')
      await confirmFactsInDashboard(page, caseId, 'fidrec')
      await expect(page.getByText('Points for the institution', { exact: true })).toBeVisible({ timeout: 5 * 60_000 })
      await expect(page.getByText('Filing with FIDReC', { exact: true })).toBeVisible()
      const { data: reports } = await supabase.from('reports').select('report_type, status').eq('case_id', caseId)
      expect(reports).toEqual([{ report_type: 'fidrec_pack_v1', status: 'COMPLETED' }])
    } finally {
      await deleteClerkUser(clerkUserId)
    }
  })

  test('the FIDReC pack on its own, without the free evaluation or the bank pack (?intent=fidrec)', async ({ page }) => {
    const supabase = createServiceClientFromEnvironment()
    await rememberIntent(page, 'fidrec')
    const { clerkUserId, caseId, email } = await startFreshCase(page, supabase, syntheticNarrative)
    try {
      await expect(page.locator('[data-pack-intent="fidrec"]')).toBeVisible({ timeout: 120_000 })
      await walkClosedFidrecRoutes(page)
      const buy = await answerFidrecRoute(page)
      // The open route keeps its answer on screen and can still be changed.
      await expect(page.locator('[data-fidrec-offer] [data-fidrec-route-answer="final_reply"]').first()).toBeVisible()
      await expect(page.locator('[data-fidrec-offer]').first().getByRole('button', { name: 'Change my answer' })).toBeVisible()
      await buy.click()
      await payAndReturn(page, email, caseId, 'escalation_pack', 188)

      await addPackEvidence(page, 'fidrec')
      await confirmFactsInDashboard(page, caseId, 'fidrec')
      await expect(page.getByText('Points for the institution', { exact: true })).toBeVisible({ timeout: 5 * 60_000 })
      const { data: purchases } = await supabase.from('case_purchases').select('product_code').eq('case_id', caseId)
      expect(purchases, 'no bank pack was needed').toEqual([{ product_code: 'escalation_pack' }])
    } finally {
      await deleteClerkUser(clerkUserId)
    }
  })
})
