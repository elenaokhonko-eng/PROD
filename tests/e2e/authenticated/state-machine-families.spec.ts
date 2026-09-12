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

for (const [family, fixture] of Object.entries(fixtures) as Array<[keyof StateCases, StateFixture]>) {
  test(`${family} fixture renders its contract state`, async ({ page }) => {
    const errors = monitorClientErrors(page)
    await page.goto(`/app/case/${fixture.caseId}/dashboard`, { waitUntil: 'networkidle' })

    await expect(page).not.toHaveURL(/\/sign-in(?:[/?]|$)/)
    await expect(page.getByText(expectedStateText[family], { exact: false }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await expectNamedInteractiveControls(page)
    errors.assertNone()
  })
}

test('completed intake remains at evidence after refresh and a fresh authenticated context', async ({ browser, page }) => {
  const dashboardPath = `/app/case/${fixtures.layer1Evidence.caseId}/dashboard`
  await page.goto(dashboardPath, { waitUntil: 'networkidle' })
  await expect(page.getByText(expectedStateText.layer1Evidence, { exact: false }).first()).toBeVisible()

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByText(expectedStateText.layer1Evidence, { exact: false }).first()).toBeVisible()

  const context = await browser.newContext({
    baseURL: process.env.HARBOR_PREVIEW_BASE_URL,
    storageState: resolveAuthStatePath(process.cwd(), 'userA'),
  })
  await guardContextAgainstProduction(context)
  try {
    const freshPage = await context.newPage()
    await freshPage.goto(dashboardPath, { waitUntil: 'networkidle' })
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
