import { expect, test } from '../fixtures/harbor-test'
import { requireEnvironment } from '../evidence/run-context'
import { expectNamedInteractiveControls, expectNoHorizontalOverflow, monitorClientErrors } from '../helpers/page-quality'

type StateFixture = { caseId: string }

const expectedStateText = {
  layer1Intake: 'Tell us about your complaint',
  layer1Gap: 'A few more details',
  layer1Evidence: 'Upload supporting evidence',
  layer1DraftPending: 'Preparing your free draft',
  layer1FreeDraft: 'Your free triage draft',
  transitionBuyReport: 'Buy the full report',
  transitionPaymentSuccess: 'Payment received',
  layer2Running: 'Analysing your case',
  layer2Drafting: 'Drafting your complaint report',
  layer2Ready: 'Your complaint report',
  layer2Failed: 'We hit a snag generating your report',
  layer3Form: 'Request specialist support',
  layer3Tier2: /FIDReC Tier 2 pack/i,
  layer3Confirmed: 'Request received',
} as const

type StateCases = Record<keyof typeof expectedStateText, StateFixture>

const fixtures = readFixtures()

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

function readFixtures(): StateCases {
  const raw = requireEnvironment('HARBOR_STATE_CASES_JSON')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`HARBOR_STATE_CASES_JSON is not valid JSON: ${String(error)}`)
  }

  const required = Object.keys(expectedStateText) as Array<keyof StateCases>
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('HARBOR_STATE_CASES_JSON must contain a fixture object.')
  }
  const record = parsed as Record<string, Partial<StateFixture>>
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const missing = required.filter((key) => !uuidPattern.test(record[key]?.caseId ?? ''))
  if (missing.length) {
    throw new Error(`HARBOR_STATE_CASES_JSON is missing valid case UUIDs: ${missing.join(', ')}`)
  }

  return Object.fromEntries(required.map((key) => [key, record[key]])) as StateCases
}
