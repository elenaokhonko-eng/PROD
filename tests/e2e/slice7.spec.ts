import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

const authStatePath = resolve(process.env.SLICE5_AUTH_STORAGE_STATE ?? 'tests/e2e/.auth/slice5.json')
const hasAuthState = existsSync(authStatePath)
const layer3CaseId =
  process.env.SLICE7_LAYER3_CASE_ID ?? '01eb9245-0bb2-4b08-9469-412850d656a0'

test.describe('Slice 7 Layer 3 contact request QA', () => {
  test.skip(
    !hasAuthState,
    `Missing authenticated Clerk storage state. Run "pnpm.cmd run test:e2e:auth", sign in as the test case owner, then save ${authStatePath}.`,
  )

  test('rejects server-owned fields and upserts one contact request row', async ({ page }) => {
    const runId = Date.now()
    const contactEmail = `elena.okhonko+slice7-${runId}@gmail.com`
    const message = `Slice 7 E2E contact request ${runId}`

    await page.goto(`/app/case/${layer3CaseId}/dashboard`)

    await expect(page.getByText('GuideBuoy Scam and Fraud Specialist')).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByText('Request specialist support')).toBeVisible()
    await expect(page.getByText('Case reference')).toBeVisible()
    await expect(page.getByText(layer3CaseId)).toBeVisible()
    await expect(page.getByText(/Financial institution:/)).toBeVisible()
    await expect(page.getByText(/Reported loss: SGD/)).toBeVisible()
    await expect(page.getByRole('link', { name: /Message on WhatsApp/ }).first()).toHaveAttribute(
      'href',
      /https:\/\/wa\.me\/6590727915/,
    )

    const forbiddenResult = await page.evaluate(async (caseId) => {
      const response = await fetch('/api/contact-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: caseId,
          first_name: 'Forbidden',
          last_name: 'Fields',
          email: 'elena.okhonko+slice7-forbidden@gmail.com',
          phone: '+65 9123 4567',
          age: 45,
          employment_status: 'professional',
          thirty_days_since_last_fi_reply: true,
          fi_issued_final_response: false,
          user_id: '31daa072-e0f4-40cb-927b-8724e781843d',
          amount_lost_sgd: 1,
          financial_institution: 'Client supplied bank',
        }),
      })
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      }
    }, layer3CaseId)

    expect(forbiddenResult.status).toBe(400)
    expect(forbiddenResult.body?.error).toBe('forbidden_client_fields')
    expect(forbiddenResult.body?.details?.fields).toEqual([
      'user_id',
      'amount_lost_sgd',
      'financial_institution',
    ])

    await page.getByLabel('First name').fill('Slice')
    await page.getByLabel('Last name').fill('Seven')
    await page.getByLabel('Email').fill(contactEmail)
    await page.getByLabel('Phone').fill('+65 9123 4567')
    await page.getByLabel('Age').fill('45')
    await page.getByLabel('Employment status').selectOption('professional')
    await page.getByRole('switch', { name: /30 days since the FI's last reply/ }).click()
    await page.getByRole('switch', { name: /FI issued a final response/ }).click()
    await page.getByLabel('Anything else we should know? (optional)').fill(message)

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/contact-requests') &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Submit request' }).click()

    const response = await responsePromise
    const body = (await response.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string } | null
    expect(response.status(), JSON.stringify(body)).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.id).toBeTruthy()

    await expect(page.getByText('Request received')).toBeVisible()
    await expect(page.getByText(/within 1-2 business days/)).toBeVisible()

    await assertSingleContactRequestRow({
      id: body.id!,
      caseId: layer3CaseId,
      email: contactEmail,
      message,
    })
  })
})

async function assertSingleContactRequestRow({
  id,
  caseId,
  email,
  message,
}: {
  id: string
  caseId: string
  email: string
  message: string
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  expect(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL must be set for Slice 7 DB verification').toBeTruthy()
  expect(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY must be set for Slice 7 DB verification').toBeTruthy()

  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: row, error } = await supabase
    .from('escalation_waitlist')
    .select('*')
    .eq('id', id)
    .single()

  expect(error).toBeNull()
  expect(row).toMatchObject({
    case_id: caseId,
    user_id: '31daa072-e0f4-40cb-927b-8724e781843d',
    first_name: 'Slice',
    last_name: 'Seven',
    email,
    phone: '+65 9123 4567',
    age: 45,
    employment_status: 'professional',
    thirty_days_since_last_fi_reply: true,
    fi_issued_final_response: true,
    message,
  })
  expect(row?.amount_lost_sgd).not.toBe(1)
  expect(row?.amount_lost_sgd).not.toBeNull()
  expect(row?.financial_institution).not.toBe('Client supplied bank')
  expect(row?.financial_institution).toBeTruthy()

  const { count, error: countError } = await supabase
    .from('escalation_waitlist')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .eq('user_id', '31daa072-e0f4-40cb-927b-8724e781843d')

  expect(countError).toBeNull()
  expect(count).toBe(1)
}
