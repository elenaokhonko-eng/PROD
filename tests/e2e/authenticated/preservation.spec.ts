import { expect, test } from '../fixtures/harbor-test'
import { readReleaseFixtures } from '../../release/release-fixtures'

const fixtures = readReleaseFixtures()
const syntheticEvidence = { annotation: { type: 'evidence-class', description: 'synthetic-provider' } }

test('anonymous narrative is handed to the signed-in bootstrap exactly once', syntheticEvidence, async ({ page }) => {
  const handoffNarrative = fixtures.onboarding.anonymousNarrative
  await page.addInitScript((narrative) => {
    sessionStorage.setItem('gb_pending_narrative', JSON.stringify({ narrative }))
  }, handoffNarrative)

  let bootstrapCount = 0
  const bootstrapIdempotencyKeys: string[] = []
  await page.route('**/api/cases/bootstrap', async (route) => {
    bootstrapCount += 1
    const idempotencyKey = route.request().headerValue('idempotency-key')
    expect(idempotencyKey, 'Bootstrap must always send Idempotency-Key').toBeTruthy()
    bootstrapIdempotencyKeys.push(idempotencyKey!)
    expect(route.request().postDataJSON()).toEqual({ narrative: handoffNarrative })
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ case_id: 'handoff-case' }) })
  })
  await page.route('**/app/case/handoff-case/dashboard', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Handoff complete</h1>' }),
  )

  await page.goto('/')
  await expect(page).toHaveURL(/\/app\/case\/handoff-case\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Handoff complete' })).toBeVisible()
  expect(bootstrapCount).toBe(1)
  expect(bootstrapIdempotencyKeys).toHaveLength(1)
  expect(bootstrapIdempotencyKeys[0]).toMatch(/[A-Za-z0-9._:-]{8,}/)
  expect(await page.evaluate(() => sessionStorage.getItem('gb_pending_narrative'))).toBeNull()
})

test('settings export and deletion request preserve their request and response contracts', syntheticEvidence, async ({ page }) => {
  await page.route('**/api/privacy/export', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ profile: { id: 'harbor-user' }, cases: [] }),
    }),
  )
  await page.route('**/api/privacy/delete-request', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, anonymized_case_ids: [] }),
    }),
  )
  await page.goto('/app/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export My Data' }).click()
  await expect((await download).suggestedFilename()).toMatch(/^guidebuoy-data-export-.*\.json$/)

  await page.getByRole('button', { name: 'Delete Account' }).click()
  await expect(page.getByRole('button', { name: 'Confirm Delete Account' })).toBeVisible()
  const confirmation = page.waitForEvent('dialog')
  await page.getByRole('button', { name: 'Confirm Delete Account' }).click()
  const dialog = await confirmation
  expect(dialog.message()).toContain('anonymized')
  await dialog.accept()
})

test('invalid invitation is reported without navigating to another case', syntheticEvidence, async ({ page }) => {
  await page.route('**/api/invitations/accept', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid or expired invitation' }) }),
  )

  await page.goto('/invite/harbor-invalid-token')

  await expect(page.getByText('Invalid or expired invitation')).toBeVisible()
  await expect(page).toHaveURL(/\/invite\/harbor-invalid-token$/)
})

test('cross-user case URL reveals no case data or redirect target', async ({ page }) => {
  const crossUserCaseId = fixtures.users.userB.ownedCaseId
  const response = await page.goto(`/app/case/${crossUserCaseId}/dashboard`)
  expect(response?.status()).toBeLessThan(500)
  await expect(page.getByText(/case was not found/i)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/app/case/${crossUserCaseId}/dashboard$`))
})
