import type { Page } from '@playwright/test'
import { expect, expectNoProductionTraffic, guardContextAgainstProduction, test } from '../fixtures/harbor-test'
import { requireEnvironment, resolveAuthStatePath } from '../evidence/run-context'
import {
  expectedStateText,
  parseStateCaseFixtures,
  type StateCases,
  type StateFixture,
} from '../helpers/state-case-fixtures'
import { expectNamedInteractiveControls, expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

const fixtures = parseStateCaseFixtures(requireEnvironment('HARBOR_STATE_CASES_JSON'))

// The dashboard polls while work runs, so "network idle" is not a reliable signal (768-px timeouts, 5 Nov). Wait for
// the dashboard's own ready signal: the queries that decide the state have settled.
async function openDashboard(page: Page, path: string, mode: 'goto' | 'reload' = 'goto') {
  if (mode === 'reload') await page.reload({ waitUntil: 'domcontentloaded' })
  else await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('main[data-harbor-ready="true"]')).toBeVisible()
}

for (const [family, fixture] of Object.entries(fixtures) as Array<[keyof StateCases, StateFixture]>) {
  test(`${family} fixture renders its contract state`, async ({ page }) => {
    const errors = monitorClientErrors(page)
    await openDashboard(page, `/app/case/${fixture.caseId}/dashboard`)

    await expect(page).not.toHaveURL(/\/sign-in(?:[/?]|$)/)
    await expect(page.getByText(expectedStateText[family], { exact: false }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await expectNamedInteractiveControls(page)
    errors.assertNone()
  })
}

test('completed intake remains at evidence after refresh and a fresh authenticated context', async ({ browser, page }) => {
  const dashboardPath = `/app/case/${fixtures.layer1Evidence.caseId}/dashboard`
  await openDashboard(page, dashboardPath)
  await expect(page.getByText(expectedStateText.layer1Evidence, { exact: false }).first()).toBeVisible()

  await openDashboard(page, dashboardPath, 'reload')
  await expect(page.getByText(expectedStateText.layer1Evidence, { exact: false }).first()).toBeVisible()

  const context = await browser.newContext({
    baseURL: process.env.HARBOR_PREVIEW_BASE_URL,
    storageState: resolveAuthStatePath(process.cwd(), 'userA'),
  })
  await guardContextAgainstProduction(context)
  try {
    const freshPage = await context.newPage()
    await openDashboard(freshPage, dashboardPath)
    await expect(freshPage).not.toHaveURL(/\/sign-in(?:[/?]|$)/)
    await expect(freshPage.getByText(expectedStateText.layer1Evidence, { exact: false }).first()).toBeVisible()
  } finally {
    try {
      expectNoProductionTraffic(context)
    } finally {
      await context.close()
    }
  }
})
