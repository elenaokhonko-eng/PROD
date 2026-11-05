import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/harbor-test'
import { createServiceClientFromEnvironment } from '../helpers/disposable-records'

// D6 regression: a brand-new account on the default free plan goes from its story to a paid S$18 report the way a
// customer does: onboarding creates the case, the intake form, any follow-up questions, an evidence upload, confirming
// the facts, the free evaluation with the buy button, Stripe test-mode Checkout, then the report. Nothing is seeded
// for this account.
// Synthetic content only. The Clerk test user is deleted afterwards; its purchase rows stay as payment records.

const clerkSecretKey = process.env.HARBOR_CLERK_DEV_SECRET_KEY?.trim() ?? ''
const stepTimeoutMs = 8 * 60_000

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('fresh free account', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Creates a Clerk user and a Stripe test payment once per release SHA.')
  })

  test('a brand-new free account can buy the S$18 report end to end', async ({ page }) => {
    expect(clerkSecretKey.startsWith('sk_test_'), 'HARBOR_CLERK_DEV_SECRET_KEY must be the Clerk Development key').toBe(true)
    test.setTimeout(30 * 60_000)
    const supabase = createServiceClientFromEnvironment()
    const email = `harbor.release.fresh.${Date.now()}+clerk_test@example.com`
    const clerkUserId = await createClerkUser(email)

    try {
      // Provisioned by the staging Clerk webhook, with the default free account entitlement.
      let profileId: string | null = null
      await expect
        .poll(async () => {
          const { data } = await supabase.from('profiles').select('id').eq('clerk_id', clerkUserId).maybeSingle()
          profileId = (data as { id?: string } | null)?.id ?? null
          return profileId
        }, { timeout: 120_000, message: 'webhook provisions the new profile' })
        .not.toBeNull()
      const { data: accountEntitlement } = await supabase
        .from('user_entitlements')
        .select('plan, features')
        .eq('user_id', profileId)
        .single()
      expect(accountEntitlement).toEqual({ plan: 'free', features: {} })

      await signIn(page, clerkUserId)

      // The marketing page leaves the story in session storage; /onboarding turns it into the case.
      await page.evaluate((narrative) => sessionStorage.setItem('gb_pending_narrative', JSON.stringify({ narrative })), syntheticNarrative)
      await page.goto('/onboarding')
      await page.waitForURL(/\/app\/case\/[0-9a-f-]{36}\/dashboard$/, { timeout: 120_000 })
      const caseId = new URL(page.url()).pathname.split('/')[3]

      await fillIntake(page)
      await reachEvidenceUpload(page)
      await page.locator('input[type="file"]').setInputFiles({
        name: 'synthetic-bank-statement.pdf',
        mimeType: 'application/pdf',
        buffer: syntheticStatementPdf(),
      })

      // Nothing is generated until the facts are confirmed (C3).
      const confirmFacts = page.getByRole('link', { name: 'Confirm your facts' })
      await answerFollowUpsUntil(page, confirmFacts, stepTimeoutMs)
      await confirmFactsAndGenerate(page, caseId)

      const buy = page.getByRole('button', { name: /Get Bank Pack/i })
      await expect(page.getByText('Your free triage draft')).toBeVisible({ timeout: 180_000 })
      await expect(page.getByText('Facts you confirmed')).toBeVisible()
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

const syntheticNarrative =
  'On 3 October 2026 I received a call from someone claiming to be from Synthetic Bank fraud team. They told me my ' +
  'account was compromised and asked me to approve a transfer of S$2,400 to a "safe account". I approved it in the ' +
  'bank app. The next day I realised it was a scam and reported it to the bank and the police. The bank refused to ' +
  'refund me, saying I authorised the payment. I want the bank to refund the S$2,400.'

const intakeAnswers: Record<string, string> = {
  institution_name: 'Synthetic Bank',
  account_details: 'Savings account ending 0000 (synthetic)',
  incident_summary: syntheticNarrative,
  financial_impact: 'I lost S$2,400 in one transfer on 3 October 2026.',
  desired_outcome: 'A full refund of S$2,400 and a written explanation.',
}

async function fillIntake(page: Page) {
  await expect(page.getByText('Tell us about your complaint')).toBeVisible({ timeout: 120_000 })
  for (const [key, value] of Object.entries(intakeAnswers)) await page.locator(`#intake-${key}`).fill(value)
  await page.locator('#intake-previous_contact-No').check()
  await page.getByRole('button', { name: 'Continue' }).click()
}

async function reachEvidenceUpload(page: Page) {
  await answerFollowUpsUntil(page, page.getByText('Upload supporting evidence'), stepTimeoutMs)
}

// Follow-up questions depend on what the extract finds, so answer whatever appears until the target shows.
async function answerFollowUpsUntil(page: Page, target: Locator, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let rounds = 0
  while (Date.now() < deadline) {
    if (await target.first().isVisible().catch(() => false)) return
    // The "A few more details" heading sits outside the form; the form is the one with "Save answers".
    const followUps = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save answers' }) })
    if (await followUps.isVisible().catch(() => false)) {
      expect(++rounds, 'follow-up rounds').toBeLessThanOrEqual(4)
      await answerFollowUps(followUps)
      continue
    }
    await page.waitForTimeout(5_000)
  }
  await expect(target.first()).toBeVisible({ timeout: 1_000 })
}

async function answerFollowUps(form: Locator) {
  for (const group of await form.getByRole('radiogroup').all()) await group.getByRole('radio').first().check()
  for (const field of await form.locator('textarea').all()) if (!(await field.inputValue())) await field.fill('Synthetic answer for the release test.')
  for (const field of await form.locator('input:not([type="radio"]):not([type="hidden"])').all()) {
    if (await field.inputValue()) continue
    const type = await field.getAttribute('type')
    const label = await field.evaluate((input) => (input as HTMLInputElement).labels?.[0]?.textContent ?? '')
    const numeric = type === 'number' || (await field.getAttribute('inputmode')) === 'decimal' || /amount|lost|how much/i.test(label)
    await field.fill(type === 'date' ? '2026-10-03' : numeric ? '2400' : 'Synthetic answer')
  }
  await form.locator('button[type="submit"]').click()
  await form.page().waitForTimeout(5_000)
}

// Answers every open item on the confirm screen: the first value for a conflict, "Keep it" for a claim without a
// document, "Not known" for a missing fact. Then confirms and generates the free evaluation.
async function confirmFactsAndGenerate(page: Page, caseId: string) {
  await page.getByRole('link', { name: 'Confirm your facts' }).click()
  await page.waitForURL(new RegExp(`/app/case/${caseId}/facts\\?stage=free`))
  await expect(page.getByText(/left to check|Everything is confirmed/)).toBeVisible({ timeout: 180_000 })

  for (let round = 0; round < 20; round++) {
    const open = page.locator('form').filter({ has: page.getByText('To check', { exact: true }) }).first()
    if (!(await open.count())) break
    const notKnown = open.getByRole('radio', { name: 'Not known' })
    await ((await notKnown.count()) ? notKnown : open.getByRole('radio').first()).check()
    const saved = page.waitForResponse((r) => r.url().includes(`/api/cases/${caseId}/facts?stage=free`) && r.request().method() === 'GET')
    await open.getByRole('button', { name: 'Save answer' }).click()
    await saved
  }
  await expect(page.getByText('Everything is confirmed.')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm and continue to your free evaluation' }).click()
  await page.getByRole('button', { name: 'Get my free evaluation' }).click()
  await page.waitForURL(new RegExp(`/app/case/${caseId}/dashboard$`), { timeout: 180_000 })
}

async function payWithTestCard(page: Page, email: string) {
  const cardButton = page.locator('[data-testid="card-accordion-item-button"]')
  if (await cardButton.isVisible({ timeout: 10_000 }).catch(() => false)) await cardButton.click()
  const emailField = page.locator('#email')
  if (await emailField.isEditable({ timeout: 5_000 }).catch(() => false)) await emailField.fill(email)
  await page.locator('#cardNumber').fill('4242424242424242')
  await page.locator('#cardExpiry').fill('12 / 34')
  await page.locator('#cardCvc').fill('123')
  await page.locator('#billingName').fill('Release Test')
  const postal = page.locator('#billingPostalCode')
  if (await postal.isVisible().catch(() => false)) await postal.fill('123456')
  await page.locator('[data-testid="hosted-payment-submit-button"]').click()
}

async function signIn(page: Page, clerkUserId: string) {
  const response = await clerkApi('/sign_in_tokens', { method: 'POST', body: JSON.stringify({ user_id: clerkUserId, expires_in_seconds: 300 }) })
  const { token } = (await response.json()) as { token?: string }
  expect(token, `Clerk sign-in token (HTTP ${response.status})`).toBeTruthy()
  await page.goto('/sign-in', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean((window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded), undefined, { timeout: 60_000 })
  const status = await page.evaluate(async (ticket) => {
    const { Clerk } = window as unknown as {
      Clerk: {
        client: { signIn: { create(p: { strategy: 'ticket'; ticket: string }): Promise<{ status: string; createdSessionId: string }> } }
        setActive(p: { session: string }): Promise<void>
      }
    }
    const attempt = await Clerk.client.signIn.create({ strategy: 'ticket', ticket })
    if (attempt.status !== 'complete') return attempt.status
    await Clerk.setActive({ session: attempt.createdSessionId })
    return 'complete'
  }, token!)
  expect(status).toBe('complete')
}

async function createClerkUser(email: string): Promise<string> {
  const response = await clerkApi('/users', {
    method: 'POST',
    body: JSON.stringify({ email_address: [email], skip_password_requirement: true }),
  })
  const body = (await response.json()) as { id?: string }
  expect(body.id, `Clerk test user (HTTP ${response.status})`).toMatch(/^user_/)
  return body.id!
}

async function deleteClerkUser(clerkUserId: string) {
  const response = await clerkApi(`/users/${clerkUserId}`, { method: 'DELETE' })
  if (!response.ok) console.warn(`Clerk test user ${clerkUserId} was not deleted (HTTP ${response.status}).`)
}

function clerkApi(path: string, init: RequestInit) {
  return fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${clerkSecretKey}`, 'Content-Type': 'application/json' },
  })
}

// A one-page synthetic statement, built here so no document file is committed.
function syntheticStatementPdf(): Buffer {
  const text = [
    'Synthetic Bank - Statement of account (synthetic test document)',
    'Account: Savings ending 0000',
    '03 Oct 2026  Transfer to unknown payee   S$2,400.00 debit',
    'Closing balance S$1,000.00',
  ]
  const stream = `BT /F1 11 Tf 50 760 Td 14 TL ${text.map((line) => `(${line}) '`).join(' ')} ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
