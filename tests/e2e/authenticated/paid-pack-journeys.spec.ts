import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/harbor-test'
import { createServiceClientFromEnvironment } from '../helpers/disposable-records'
import {
  addPackEvidence,
  answerJourney,
  completeFreeEvaluation,
  confirmFactsInDashboard,
  createLinkedAccount,
  deleteClerkUser,
  fillIntake,
  payWithTestCard,
  startFreshCase,
  syntheticNarrative,
} from '../helpers/fresh-account'
import { PAID_STAGES_DEFERRED, paidStagesEnabled } from '../helpers/paid-stages'
import { answerTimeline, FINAL_REPLY_TEN_DAYS_AGO } from '../helpers/fidrec-timeline'

// Stage 2 (Elena, 20 Nov 2026): each pack works on its own and after the free evaluation. Fresh accounts, Stripe test
// mode, synthetic content only; each Clerk test user is deleted afterwards.

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('paid pack journeys', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Creates Clerk users and Stripe test payments once per release SHA.')
    test.skip(!paidStagesEnabled, PAID_STAGES_DEFERRED)
    test.setTimeout(30 * 60_000)
  })

  // CR-2 as amended (27 Nov): sold upfront. The payment step states the condition and asks nothing.
  async function fidrecBuyButton(page: Page) {
    const offer = page.locator('[data-fidrec-offer]').first()
    await expect(offer.locator('[data-fidrec-before-payment]')).toContainText('your pack waits for you until it is', { timeout: 120_000 })
    await expect(offer.locator('input[type="radio"]')).toHaveCount(0)
    const buy = offer.getByRole('button', { name: /Prepare my FIDReC case/ })
    await expect(buy).toBeEnabled({ timeout: 60_000 })
    return buy
  }

  // The two situations in which the pack waits, with their approved messages, then a changed answer that opens it.
  async function walkWaitingAnswers(page: Page) {
    const change = page.getByRole('button', { name: 'Change my answers' })
    await answerTimeline(page, { complaintDaysAgo: null })
    await expect(page.locator('[data-fidrec-waiting="complaint_not_raised"]')).toContainText('Your FIDReC pack waits for you.', { timeout: 60_000 })
    await expect(page.getByRole('button', { name: /Get Bank dispute pack/ })).toBeVisible()
    await change.click()
    await answerTimeline(page, { complaintDaysAgo: 3, reply: 'looking' })
    await expect(page.locator('[data-fidrec-waiting="fidrec_too_early"]')).toContainText('so the four weeks end on', { timeout: 60_000 })
    await expect(page.getByRole('button', { name: /Get Bank dispute pack/ })).toHaveCount(0)
    await change.click()
    await answerTimeline(page, FINAL_REPLY_TEN_DAYS_AGO)
    await expect(page.locator('[data-fidrec-waiting]')).toHaveCount(0)
  }

  // CR-2, pack first: the empty case the pack step created for this account.
  async function waitingCaseId(supabase: ReturnType<typeof createServiceClientFromEnvironment>, profileId: string) {
    const { data } = await supabase.from('cases').select('id').eq('user_id', profileId)
    expect(data, 'one case, created before payment').toHaveLength(1)
    return data![0].id as string
  }

  // After payment: back in My cases, then "Add a new case" (for FIDReC the questionnaire first), the story, the same
  // questions as the free evaluation (28 Nov), and the pack's documents.
  async function addStoryAfterPaying(page: Page, caseId: string, pack: 'bank' | 'fidrec') {
    await page.getByRole('link', { name: 'Add a new case' }).first().click()
    if (pack === 'fidrec') await answerTimeline(page, FINAL_REPLY_TEN_DAYS_AGO)
    await page.locator('#story').fill(syntheticNarrative)
    await page.getByRole('button', { name: 'Submit the story' }).click()
    await page.waitForURL(new RegExp(`/app/case/${caseId}/dashboard$`), { timeout: 120_000 })
    await answerJourney(page, { afterTimeline: pack === 'fidrec' })
    await fillIntake(page, syntheticNarrative)
    await expect(page.locator(`[data-pack-evidence="${pack}"]`)).toBeVisible({ timeout: 120_000 })
  }

  // From inside a case, Stripe returns to that case; a case still waiting for its story returns to My cases.
  async function payAndReturn(page: Page, email: string, caseId: string, productCode: string, amount: number, returnsTo: 'case' | 'my cases' = 'case') {
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 120_000 })
    await payWithTestCard(page, email)
    await page.waitForURL(returnsTo === 'case' ? new RegExp(`/app/case/${caseId}/dashboard`) : (url) => url.pathname === '/app', { timeout: 180_000 })
    const supabase = createServiceClientFromEnvironment()
    await expect
      .poll(async () => {
        const { data } = await supabase.from('case_purchases').select('product_code, payment_status, amount').eq('case_id', caseId).eq('product_code', productCode)
        return data
      }, { timeout: 180_000, message: 'Stripe webhook records the paid purchase' })
      .toEqual([{ product_code: productCode, payment_status: 'paid', amount }])
  }

  test('the Bank dispute pack bought first, without the free evaluation', async ({ page }) => {
    const supabase = createServiceClientFromEnvironment()
    const { clerkUserId, email, profileId } = await createLinkedAccount(page, supabase)
    try {
      await page.goto('/app/pack/bank')
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 120_000 })
      const caseId = await waitingCaseId(supabase, profileId)
      await payAndReturn(page, email, caseId, 'self_serve_report', 18, 'my cases')
      await addStoryAfterPaying(page, caseId, 'bank')

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
      const buy = await fidrecBuyButton(page)
      // Back from Stripe: no stuck "Redirecting to secure payment" screen (CR-2).
      await buy.click()
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 120_000 })
      await page.goBack()
      await expect(page.locator('[data-harbor-ready="true"]')).toBeVisible({ timeout: 120_000 })
      await expect(page.getByText('Redirecting to secure payment')).toHaveCount(0)
      await page.locator('[data-fidrec-offer]').first().getByRole('button', { name: /Prepare my FIDReC case/ }).click()
      await payAndReturn(page, email, caseId, 'escalation_pack', 188)

      await walkWaitingAnswers(page)
      await addPackEvidence(page, 'fidrec')
      await confirmFactsInDashboard(page, caseId, 'fidrec')
      await expect(page.getByText('Points for the institution', { exact: true })).toBeVisible({ timeout: 5 * 60_000 })
      await expect(page.getByText('Filing with FIDReC', { exact: true })).toBeVisible()
      // The FIDReC pack's report page offers no Bank dispute pack.
      await expect(page.getByRole('button', { name: /Get Bank dispute pack/ })).toHaveCount(0)
      const { data: reports } = await supabase.from('reports').select('report_type, status').eq('case_id', caseId)
      expect(reports).toEqual([{ report_type: 'fidrec_pack_v1', status: 'COMPLETED' }])
    } finally {
      await deleteClerkUser(clerkUserId)
    }
  })

  test('the FIDReC pack bought first, without the free evaluation or the bank pack', async ({ page }) => {
    const supabase = createServiceClientFromEnvironment()
    const { clerkUserId, email, profileId } = await createLinkedAccount(page, supabase)
    try {
      await page.goto('/app/pack/fidrec')
      const buy = await fidrecBuyButton(page)
      const caseId = await waitingCaseId(supabase, profileId)
      await buy.click()
      await payAndReturn(page, email, caseId, 'escalation_pack', 188, 'my cases')
      await addStoryAfterPaying(page, caseId, 'fidrec')

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
