export const REQUIRED_INTAKE_RESPONSE_KEYS = [
  'institution_name',
  'account_details',
  'incident_summary',
  'financial_impact',
  'desired_outcome',
  'previous_contact',
] as const

export type IntakeResponseSnapshot = {
  question_key: string
  response_value: string | null
}

export function hasCompletedIntakeResponses(
  responses: readonly IntakeResponseSnapshot[] | null | undefined,
): boolean {
  if (!responses) return false

  const answeredKeys = new Set(
    responses
      .filter((response) => response.response_value?.trim())
      .map((response) => response.question_key),
  )

  return REQUIRED_INTAKE_RESPONSE_KEYS.every((key) => answeredKeys.has(key))
}
