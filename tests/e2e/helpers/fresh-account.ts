import type { Locator, Page } from '@playwright/test'
import { expect } from '../fixtures/harbor-test'
import { createServiceClientFromEnvironment } from './disposable-records'

// The fresh-account journey shared by fresh-account-purchase.spec.ts and free-evaluation-edge-cases.spec.ts: a Clerk
// test user on the default free plan, the onboarding story, journey, intake, follow-ups, a synthetic statement and
// the confirm screen. Synthetic content only.

export const clerkSecretKey = process.env.HARBOR_CLERK_DEV_SECRET_KEY?.trim() ?? ''
export const stepTimeoutMs = 8 * 60_000

export type ServiceClient = ReturnType<typeof createServiceClientFromEnvironment>

// Creates the Clerk test user, waits for its free profile, signs in and turns the story into a case.
export async function startFreshCase(page: Page, supabase: ServiceClient, narrative: string) {
  expect(clerkSecretKey.startsWith('sk_test_'), 'HARBOR_CLERK_DEV_SECRET_KEY must be the Clerk Development key').toBe(true)
  // A random part too: concurrent journeys (load test) start in the same millisecond.
  const email = `harbor.release.fresh.${Date.now()}.${Math.random().toString(36).slice(2, 8)}+clerk_test@example.com`
  const clerkUserId = await createClerkUser(email)

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
  await page.evaluate((story) => sessionStorage.setItem('gb_pending_narrative', JSON.stringify({ narrative: story })), narrative)
  await page.goto('/onboarding')
  await page.waitForURL(/\/app\/case\/[0-9a-f-]{36}\/dashboard$/, { timeout: 120_000 })
  return { clerkUserId, email, caseId: new URL(page.url()).pathname.split('/')[3] }
}

// Journey questions, intake, follow-ups and evidence, then the confirm step in the dashboard and the free evaluation.
export async function completeFreeEvaluation(page: Page, caseId: string, narrative: string) {
  await answerJourney(page)
  await fillIntake(page, narrative)
  await reachEvidenceUpload(page)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'synthetic-bank-statement.pdf',
    mimeType: 'application/pdf',
    buffer: syntheticStatementPdf(),
  })

  // Nothing is generated until the facts are confirmed (C3).
  const confirmHeading = page.getByRole('heading', { name: 'Confirm your facts', exact: true })
  await answerFollowUpsUntil(page, confirmHeading, stepTimeoutMs)
  await confirmFactsInDashboard(page, caseId)
  await expectFreeEvaluation(page)
}

export async function expectFreeEvaluation(page: Page) {
  await expect(page.getByRole('heading', { name: 'Your free evaluation', exact: true })).toBeVisible({ timeout: 180_000 })
  // Exact: the server-written SRF section also says "based only on the facts you confirmed".
  await expect(page.getByText('Facts you confirmed', { exact: true })).toBeVisible()
}

// The confirm button names the stage (confirm-facts-panel.tsx STAGE_NAMES).
const CONFIRM_BUTTON = {
  free: 'Confirm and continue to your free evaluation',
  bank: 'Confirm and continue to your bank dispute pack',
  fidrec: 'Confirm and continue to your FIDReC escalation pack',
} as const

// One press, as a person would. A document added just before shows "still being read" and the facts reload with any new
// question (use-upload-evidence.ts, use-case-documents-realtime.ts); resolveOpenFindings waits for that. A press that
// does not confirm is a failure, not something to retry (24 Nov 2026 gate run and review). The server's answer to the
// press is the proof: the button also disappears while the facts reload after a refusal, which hid two refusals.
export async function confirmFactsInDashboard(page: Page, caseId: string, stage: keyof typeof CONFIRM_BUTTON = 'free') {
  const confirm = page.getByRole('button', { name: CONFIRM_BUTTON[stage] })
  await resolveOpenFindings(page, caseId, { stage })
  const answer = page.waitForResponse(
    (r) => r.url().includes(`/api/cases/${caseId}/facts/snapshot`) && r.request().method() === 'POST',
    { timeout: 120_000 },
  )
  await confirm.click()
  const response = await answer
  if (response.ok()) return
  const body = (await response.json().catch(() => null)) as { reason?: string } | null
  const shown = await page.locator('[role="alert"]').allInnerTexts().catch(() => [])
  throw new Error(
    `The ${stage} facts were not confirmed by one press: HTTP ${response.status()} ${body?.reason ?? ''}. The screen shows: ${shown.join(' | ') || 'no message'}`,
  )
}

// Synthetic journey: told the bank by phone, no written complaint yet, no reply, police report made, no FIDReC.
export async function answerJourney(page: Page) {
  await expect(page.getByText('Where are you with your bank?')).toBeVisible({ timeout: 120_000 })
  await page.locator('#journey-bank-yes').check()
  await page.locator('#journey-complaint-no').check()
  await page.locator('#journey-reply-none').check()
  await page.locator('#journey-police-yes').check()
  await page.locator('#journey-fidrec-no').check()
  await page.getByRole('button', { name: 'Continue' }).click()
}

// SMS phishing, the stage 1 demo recipe: the story says the bank was called, the intake answer says it was not.
export const smsPhishingNarrative =
  'On 3 October 2026 I got an SMS from Synthetic Bank and entered my login and OTP on the website. S$2,400 was ' +
  'transferred out. I called Synthetic Bank on 3 October and filed a police report on 4 October.'

export const syntheticNarrative =
  'On 3 October 2026 I received a call from someone claiming to be from Synthetic Bank fraud team. They told me my ' +
  'account was compromised and asked me to approve a transfer of S$2,400 to a "safe account". I approved it in the ' +
  'bank app. The next day I realised it was a scam and reported it to the bank and the police. The bank refused to ' +
  'refund me, saying I authorised the payment. I want the bank to refund the S$2,400.'

export const intakeAnswers: Record<string, string> = {
  institution_name: 'Synthetic Bank',
  account_details: 'Savings account ending 0000 (synthetic)',
  incident_summary: syntheticNarrative,
  financial_impact: 'I lost S$2,400 in one transfer on 3 October 2026.',
  desired_outcome: 'A full refund of S$2,400 and a written explanation.',
}

// "What happened" repeats the story told at onboarding, so the only deliberate conflict is "previous contact: No".
export async function fillIntake(page: Page, narrative: string) {
  await expect(page.getByText('Tell us about your complaint')).toBeVisible({ timeout: 120_000 })
  for (const [key, value] of Object.entries({ ...intakeAnswers, incident_summary: narrative })) {
    await page.locator(`#intake-${key}`).fill(value)
  }
  await page.locator('#intake-previous_contact-No').check()
  await page.getByRole('button', { name: 'Continue' }).click()
}

export async function reachEvidenceUpload(page: Page) {
  await answerFollowUpsUntil(page, page.getByText('Upload supporting evidence'), stepTimeoutMs)
}

// Follow-up questions depend on what the extract finds, so answer whatever appears until the target shows.
export async function answerFollowUpsUntil(page: Page, target: Locator, timeoutMs: number) {
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

export async function answerFollowUps(form: Locator) {
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

// Answers every open item on the confirm screen in the dashboard: the first value for a conflict, "Keep it" for a
// claim without a document, "I'm not sure" for a missing fact (findings A1-A8: each fact is one card, the values are
// boxes and choosing a box is the answer). Confirming then generates the free evaluation.
// `rounds` limits how many open items are answered (the edge-case spec answers one, then lets the session expire).
export async function resolveOpenFindings(
  page: Page,
  caseId: string,
  { rounds = 20, stage = 'free' }: { rounds?: number; stage?: 'free' | 'bank' | 'fidrec' } = {},
) {
  // A document that finishes being read re-runs the check (Q2) and the cards are replaced by "Checking your story…"
  // until it ends; answer only once the panel has settled, as a person would. 6 minutes covers the slowest check
  // seen on staging (310 s).
  const settled = async () => {
    await expect(page.getByText(/still being\s+read/)).toHaveCount(0, { timeout: 360_000 })
    await expect(page.getByText(/left to check|Everything is confirmed/)).toBeVisible({ timeout: 360_000 })
  }

  for (let round = 0; round < rounds; round++) {
    await settled()
    const open = page.locator('[data-finding]').filter({ has: page.getByText('To check', { exact: true }) }).first()
    if (!(await open.count())) break
    const boxes = open.locator('label:has(input.sr-only)')
    if (/We need this for your/.test(await open.innerText())) {
      await open.getByText('I’m not sure', { exact: true }).click()
    } else {
      // The recipe's one deliberate conflict is "told the bank": the story and journey say yes.
      const yes = boxes.filter({ hasText: /^Yes/ })
      if (await yes.count()) await yes.first().click()
      else if (!(await open.locator('input.sr-only:checked').count())) await boxes.first().click()
    }
    const saved = page.waitForResponse((r) => r.url().includes(`/api/cases/${caseId}/facts?stage=${stage}`) && r.request().method() === 'GET', { timeout: 120_000 })
    await open.getByRole('button', { name: 'Save answer' }).click()
    await saved
  }
  await settled()
  if (rounds < 20) return
  await expect(page.getByText('Everything is confirmed.')).toBeVisible()
}

export async function payWithTestCard(page: Page, email: string) {
  const cardButton = page.locator('[data-testid="card-accordion-item-button"]')
  if (await cardButton.isVisible({ timeout: 10_000 }).catch(() => false)) await cardButton.click()
  const emailField = await stripeField(page, '#email', 'you@example.com', 5_000)
  if (emailField && (await emailField.isEditable().catch(() => false))) await emailField.fill(email)
  // Stripe Checkout's layout changes (20 Nov 2026: the card fields lost their ids), so each field is found by its id
  // or, failing that, by its placeholder, on the page or inside Stripe's frames.
  for (const [id, placeholder, value] of [
    ['#cardNumber', 'Card number', '4242424242424242'],
    ['#cardExpiry', 'MM / YY', '12 / 34'],
    ['#cardCvc', 'Security code', '123'],
    ['#billingName', 'First and last name', 'Release Test'],
  ] as const) {
    const field = await stripeField(page, id, placeholder, 30_000)
    if (!field) throw new Error(`Stripe Checkout field not found: ${placeholder}`)
    await field.fill(value)
  }
  // GitHub's runners are in the US, where Stripe asks for a country and a ZIP code (it shows neither in Singapore). The
  // release tests pay as a Singapore customer; the postcode always fits the country Stripe ends up with, since a
  // 6-digit postcode under "United States" leaves the form invalid and Pay does nothing (23 Nov 2026 gate run).
  // 24 Nov 2026 run: no country picker was found by id, the ZIP stayed empty, and Stripe also asked for a phone number
  // (Link's "save my information", ticked by default in the US). Fields are found by id or by their label.
  // 24 Nov 2026 second run: Stripe showed its newer card form, where the fields are named country, postalCode and
  // linkOptIn, labelled "Country" and "ZIP code".
  const country = await visibleIn(page, '#billingCountry, select[name="country"]', /^Country( or region)?$/i)
  if (country) await country.selectOption('SG').catch(() => undefined)
  const selected = country ? await country.inputValue().catch(() => null) : null
  const postal = await visibleIn(page, '#billingPostalCode, input[name="postalCode"]', /^(ZIP|Postal)( code)?$/i)
  if (postal) await postal.fill(selected === 'SG' ? '123456' : '10001')
  const saveInfo = await visibleIn(page, '#enableStripePass, input[name="linkOptIn"]', /Save my information/i)
  if (saveInfo && (await saveInfo.isChecked().catch(() => false))) await saveInfo.uncheck().catch(() => undefined)
  const phone = await visibleIn(page, '#phoneNumber', /^Phone( number)?$/i)
  if (phone && (await phone.inputValue().catch(() => '')) === '') await phone.fill('2015550123')
  // The Pay button can sit inside Stripe's frame too.
  let submitted = false
  for (const scope of [page, ...page.frames().slice(1)]) {
    for (const submit of [scope.locator('[data-testid="hosted-payment-submit-button"]'), scope.getByRole('button', { name: 'Pay', exact: true })]) {
      if (!submitted && (await submit.first().isVisible().catch(() => false))) {
        await submit.first().click()
        submitted = true
      }
    }
  }
  if (!submitted) throw new Error('Stripe Checkout Pay button not found')
  // Still on Stripe a minute later means it refused the form: fail now with its own words, not after the return timeout.
  const left = await page.waitForURL((url) => url.hostname !== 'checkout.stripe.com', { timeout: 60_000 }).then(() => true, () => false)
  if (!left) {
    const messages: string[] = []
    const fields: string[] = []
    for (const scope of [page, ...page.frames().slice(1)]) {
      messages.push(...(await scope.locator('[role="alert"], .FieldError').allInnerTexts().catch(() => [])))
      // The visible form fields by their attributes only (never their values), so the next failure names the field.
      fields.push(
        ...(await scope
          .locator('input, select')
          .evaluateAll((elements) =>
            elements
              .filter((e) => (e as HTMLElement).offsetParent !== null)
              .map((e) => ['id', 'name', 'autocomplete', 'placeholder', 'aria-label'].map((a) => e.getAttribute(a) ?? '').join('/')),
          )
          .catch(() => [])),
      )
    }
    throw new Error(
      `Stripe Checkout did not accept the payment (country ${selected ?? 'not asked'}): ${messages.filter(Boolean).join(' | ') || 'no message shown'}. Fields shown: ${fields.join('; ')}`,
    )
  }
}

async function visibleIn(page: Page, selector: string, label?: RegExp): Promise<Locator | null> {
  for (const scope of [page, ...page.frames().slice(1)]) {
    for (const candidate of [scope.locator(selector).first(), ...(label ? [scope.getByLabel(label).first()] : [])]) {
      if (await candidate.isVisible().catch(() => false)) return candidate
    }
  }
  return null
}

async function stripeField(page: Page, id: string, placeholder: string, timeoutMs: number): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const scope of [page, ...page.frames().slice(1)]) {
      for (const candidate of [scope.locator(id), scope.getByPlaceholder(placeholder, { exact: true })]) {
        if (await candidate.first().isVisible().catch(() => false)) return candidate.first()
      }
    }
    await page.waitForTimeout(500)
  }
  return null
}

export async function signIn(page: Page, clerkUserId: string) {
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

export async function createClerkUser(email: string): Promise<string> {
  const response = await clerkApi('/users', {
    method: 'POST',
    // With legal consent on in Clerk (9 Nov), a user created through the API must record that the terms were accepted,
    // as ticking the sign-up box does.
    body: JSON.stringify({ email_address: [email], skip_password_requirement: true, legal_accepted_at: new Date().toISOString() }),
  })
  const body = (await response.json()) as { id?: string }
  expect(body.id, `Clerk test user (HTTP ${response.status})`).toMatch(/^user_/)
  return body.id!
}

export async function deleteClerkUser(clerkUserId: string) {
  const response = await clerkApi(`/users/${clerkUserId}`, { method: 'DELETE' })
  if (!response.ok) console.warn(`Clerk test user ${clerkUserId} was not deleted (HTTP ${response.status}).`)
}

export function clerkApi(path: string, init: RequestInit) {
  return fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${clerkSecretKey}`, 'Content-Type': 'application/json' },
  })
}

// Evidence minimums (#35): a paid pack is generated only once its documents are in. The release tests add synthetic
// documents through the checklist, as a customer would; one the pipeline does not read as that item is marked by hand
// ("This is my police report"), which exercises the self-confirm path too.
const PACK_EVIDENCE = {
  bank: [
    { item: 'payment_proof', name: 'synthetic-bank-statement.pdf' },
    { item: 'police_report', name: 'synthetic-police-report.pdf' },
  ],
  fidrec: [
    { item: 'payment_proof', name: 'synthetic-bank-statement.pdf' },
    { item: 'police_report', name: 'synthetic-police-report.pdf' },
    { item: 'bank_reply_or_complaint', name: 'synthetic-bank-final-reply.pdf' },
  ],
} as const

function syntheticEvidencePdf(item: string): Buffer {
  if (item === 'police_report') {
    return syntheticPdf([
      'Police report (synthetic test document)',
      'Report number: TEST-0000-2026',
      'Reported on 04 Oct 2026: scam call impersonating Synthetic Bank; transfer of S$2,400.00 on 03 Oct 2026',
    ])
  }
  if (item === 'bank_reply_or_complaint') {
    return syntheticPdf([
      'Synthetic Bank - Final reply to your complaint (synthetic test document)',
      'Our reference: TEST-REF-0000',
      'We have reviewed your dispute of the transfer of S$2,400.00 on 03 Oct 2026 and will not refund it.',
    ])
  }
  return syntheticStatementPdf()
}

export async function addPackEvidence(page: Page, product: keyof typeof PACK_EVIDENCE) {
  const checklist = page.locator(`[data-pack-evidence="${product}"]`)
  await expect(checklist, 'the evidence checklist after payment').toBeVisible({ timeout: 120_000 })
  for (const document of PACK_EVIDENCE[product]) {
    const row = checklist.locator(`[data-evidence-item="${document.item}"]`)
    if ((await row.getAttribute('data-added')) === 'true') continue
    await row.locator('input[type="file"]').setInputFiles({
      name: document.name,
      mimeType: 'application/pdf',
      buffer: syntheticEvidencePdf(document.item),
    })
    // Read by the pipeline as this item, or ready and offered to be marked by hand.
    const option = row.locator('select option', { hasText: document.name })
    await expect
      .poll(async () => (await row.getAttribute('data-added')) === 'true' || (await option.count()) > 0, {
        timeout: 5 * 60_000,
        message: `${document.item}: the uploaded document is read`,
      })
      .toBe(true)
    if ((await row.getAttribute('data-added')) !== 'true') {
      await row.locator('select').selectOption({ label: document.name })
      await row.getByRole('button', { name: /^This is / }).click()
    }
    await expect(row).toHaveAttribute('data-added', 'true', { timeout: 60_000 })
  }
}

// A one-page synthetic statement, built here so no document file is committed.
export function syntheticStatementPdf(): Buffer {
  return syntheticPdf([
    'Synthetic Bank - Statement of account (synthetic test document)',
    'Account: Savings ending 0000',
    '03 Oct 2026  Transfer to unknown payee   S$2,400.00 debit',
    'Closing balance S$1,000.00',
  ])
}

export function syntheticPdf(text: string[]): Buffer {
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
