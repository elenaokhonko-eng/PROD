import { expect, test } from '../fixtures/harbor-test'
import { createServiceClientFromEnvironment } from '../helpers/disposable-records'
import {
  answerFollowUpsUntil,
  answerJourney,
  deleteClerkUser,
  fillIntake,
  reachEvidenceUpload,
  resolveOpenFindings,
  smsPhishingNarrative,
  startFreshCase,
  syntheticPdf,
  syntheticStatementPdf,
} from '../helpers/fresh-account'

// G3b re-check, 11 Nov (R-05): on the confirm step, an empty page that finished being read switched the screen to
// "A few more details" with an internal label under the question, so the first Remove never happened; removing it later
// reopened four confirmed facts. Remove must work the first time, stay on the confirm step and reopen nothing.
// Synthetic content only; the Clerk test user is deleted afterwards.

test.use({ storageState: { cookies: [], origins: [] } })

test('removing an empty page on the confirm step keeps the person there and reopens no fact', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1440', 'Creates a Clerk user once per release SHA.')
  test.setTimeout(30 * 60_000)
  const supabase = createServiceClientFromEnvironment()
  const { clerkUserId, caseId } = await startFreshCase(page, supabase, smsPhishingNarrative)

  try {
    await answerJourney(page)
    await fillIntake(page, smsPhishingNarrative)
    await reachEvidenceUpload(page)
    await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic-bank-statement.pdf', mimeType: 'application/pdf', buffer: syntheticStatementPdf() })
    const confirmHeading = page.getByRole('heading', { name: 'Confirm your facts', exact: true })
    await answerFollowUpsUntil(page, confirmHeading, 10 * 60_000)
    await resolveOpenFindings(page, caseId)

    await page.locator('input[type="file"]').setInputFiles({ name: 'spare-page.pdf', mimeType: 'application/pdf', buffer: syntheticPdf(['Spare page']) })
    const spare = page.locator('div').filter({ has: page.getByText('spare-page.pdf', { exact: true }) }).last()
    await expect(spare.getByText('✓ Ready')).toBeVisible({ timeout: 6 * 60_000 })
    // The check that runs once the page is read must not take the person off the confirm step.
    await resolveOpenFindings(page, caseId)
    await expect(confirmHeading).toBeVisible()

    const remove = page.getByRole('button', { name: 'Remove spare-page.pdf' })
    await remove.click()
    await page.getByRole('button', { name: 'Keep', exact: true }).click()
    await expect(page.getByText('spare-page.pdf', { exact: true })).toBeVisible()
    await remove.click()
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByText('spare-page.pdf', { exact: true })).toHaveCount(0, { timeout: 60_000 })

    await expect(confirmHeading).toBeVisible()
    await expect(page.getByText('A few more details', { exact: false })).toHaveCount(0)
    await expect(page.getByText('Not found in extracted fields')).toHaveCount(0)
    // Nothing reopened: every fact is still confirmed after the check that follows the removal.
    await expect(page.getByText(/still being\s+read/)).toHaveCount(0, { timeout: 360_000 })
    await expect(page.getByText('Everything is confirmed.')).toBeVisible({ timeout: 360_000 })
  } finally {
    await deleteClerkUser(clerkUserId)
  }
})
