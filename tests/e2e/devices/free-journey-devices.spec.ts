import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/harbor-test'
import { createServiceClientFromEnvironment } from '../helpers/disposable-records'
import {
  answerFollowUpsUntil,
  answerJourney,
  deleteClerkUser,
  expectFreeEvaluation,
  fillIntake,
  reachEvidenceUpload,
  resolveOpenFindings,
  smsPhishingNarrative,
  startFreshCase,
  stepTimeoutMs,
  syntheticStatementPdf,
} from '../helpers/fresh-account'

// Cutover gate 8 (8 Nov): the whole free journey, including the file upload, on each device project of
// playwright.devices.config.ts. On "desktop-keyboard" the confirm screen (whose card interaction is custom) is answered
// with the keyboard only, and its accessible structure is checked the way a screen reader reads it. Synthetic content;
// the Clerk test user is deleted afterwards.

test.use({ storageState: { cookies: [], origins: [] } })

test('the free journey works on this device', async ({ page }, testInfo) => {
  test.setTimeout(30 * 60_000)
  const keyboardOnly = testInfo.project.name === 'desktop-keyboard'
  const supabase = createServiceClientFromEnvironment()
  const { clerkUserId, caseId } = await startFreshCase(page, supabase, smsPhishingNarrative)
  try {
    await answerJourney(page)
    await fillIntake(page, smsPhishingNarrative)
    await reachEvidenceUpload(page)
    await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic-bank-statement.pdf', mimeType: 'application/pdf', buffer: syntheticStatementPdf() })
    const confirmHeading = page.getByRole('heading', { name: 'Confirm your facts', exact: true })
    await answerFollowUpsUntil(page, confirmHeading, stepTimeoutMs)

    if (keyboardOnly) {
      await expectConfirmScreenStructure(page)
      await resolveWithKeyboard(page, caseId)
      await tabTo(page, page.getByRole('button', { name: 'Confirm and continue to your free evaluation' }))
      await page.keyboard.press('Enter')
    } else {
      await resolveOpenFindings(page, caseId)
      await page.getByRole('button', { name: 'Confirm and continue to your free evaluation' }).click()
    }
    await expectFreeEvaluation(page)
    // Nothing on a phone screen is wider than the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'no horizontal scrolling').toBeLessThanOrEqual(1)
  } finally {
    await deleteClerkUser(clerkUserId)
  }
})

// What a screen reader announces: the progress, each fact as a named group, every answer box as a named radio or
// checkbox, and named buttons.
async function expectConfirmScreenStructure(page: Page) {
  await expect(page.getByText(/left to check|Everything is confirmed/)).toBeVisible({ timeout: 360_000 })
  await expect(page.getByRole('progressbar', { name: 'Facts checked' })).toBeVisible()
  const open = page.locator('[data-finding]').filter({ has: page.getByText('To check', { exact: true }) })
  const count = await open.count()
  for (let i = 0; i < count; i++) {
    const card = open.nth(i)
    await expect(card.getByRole('group')).toHaveAccessibleName(/\S/)
    const choices = card.getByRole('radio').or(card.getByRole('checkbox'))
    for (let j = 0; j < (await choices.count()); j++) await expect(choices.nth(j)).toHaveAccessibleName(/\S/)
    await expect(card.getByRole('button', { name: 'Save answer' })).toBeVisible()
  }
}

// Tab until the target has focus (as a keyboard user would), failing if it is never reached.
async function tabTo(page: Page, target: Locator, maxTabs = 300) {
  for (let i = 0; i < maxTabs; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('not reachable with Tab')
}

async function resolveWithKeyboard(page: Page, caseId: string) {
  for (let round = 0; round < 20; round++) {
    await expect(page.getByText(/still being\s+read/)).toHaveCount(0, { timeout: 360_000 })
    await expect(page.getByText(/left to check|Everything is confirmed/)).toBeVisible({ timeout: 360_000 })
    const open = page.locator('[data-finding]').filter({ has: page.getByText('To check', { exact: true }) }).first()
    if (!(await open.count())) break
    const unsure = /We need this for your/.test(await open.innerText())
    const choice = unsure
      ? open.getByRole('radio', { name: 'I’m not sure' })
      : open.getByRole('radio').or(open.getByRole('checkbox')).first()
    await tabTo(page, choice)
    // The focused box shows a visible focus ring.
    if (!unsure) {
      const ring = await choice.evaluate((el) => getComputedStyle(el.closest('label')!).boxShadow)
      expect(ring, 'focus is visible on the answer box').not.toBe('none')
    }
    if (!(await choice.isChecked())) await page.keyboard.press('Space')
    await expect(choice).toBeChecked()
    const saved = page.waitForResponse((r) => r.url().includes(`/api/cases/${caseId}/facts?stage=free`) && r.request().method() === 'GET', { timeout: 120_000 })
    await tabTo(page, open.getByRole('button', { name: 'Save answer' }))
    await page.keyboard.press('Enter')
    await saved
  }
  await expect(page.getByText('Everything is confirmed.')).toBeVisible({ timeout: 360_000 })
}
