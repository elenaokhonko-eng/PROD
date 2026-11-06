export type StateFixture = { caseId: string }

import { paidStagesEnabled } from './paid-stages'

export const expectedStateText = {
  layer1Journey: 'Where are you with your bank?',
  layer1Intake: 'Tell us about your complaint',
  layer1Gap: 'A few more details',
  layer1Evidence: 'Upload supporting evidence',
  layer1DraftPending: 'GuideBuoy can only point you to the right resolution path',
  layer1FreeDraft: 'Your free triage draft',
  // Stage 1 (paid stages off): the evaluation is followed by the next steps instead of a buy button.
  transitionBuyReport: paidStagesEnabled ? 'Get your Bank Pack' : 'Your next steps',
  layer2Running: 'Checking your case information',
  layer2Drafting: 'Preparing your automated report',
  layer2Ready: 'Your complaint report',
  layer2Failed: 'We hit a snag generating your report',
  layer3Unavailable: 'Human consultation is not currently available.',
  layer3Tier2: /FIDReC Tier 2 pack/i,
} as const

export type StateCases = Record<keyof typeof expectedStateText, StateFixture>

export function parseStateCaseFixtures(raw: string): StateCases {
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
  const unexpected = Object.keys(record).filter((key) => !required.includes(key as keyof StateCases))
  if (unexpected.length) {
    throw new Error(`HARBOR_STATE_CASES_JSON contains unreachable or unrecognized states: ${unexpected.join(', ')}`)
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const missing = required.filter((key) => !uuidPattern.test(record[key]?.caseId ?? ''))
  if (missing.length) {
    throw new Error(`HARBOR_STATE_CASES_JSON is missing valid case UUIDs: ${missing.join(', ')}`)
  }

  return Object.fromEntries(required.map((key) => [key, record[key]])) as StateCases
}
