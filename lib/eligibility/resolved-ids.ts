/**
 * Normalizes UUIDs from `get_case_eligibility().resolved_ids` where Postgres
 * jsonb may encode null as jsonb null, the string "null", or a quoted UUID string.
 */

export function parseResolvedUuid(value: unknown): string | null {
  if (value == null) return null
  if (value === false) return null
  const s = String(value).trim()
  if (!s || s === 'null') return null
  return s
}

/** Prefer RPC keys (`latest_*`); fall back to legacy frontend key names. */
export function getLatestValidationRunId(resolved: Record<string, unknown> | null | undefined): string | null {
  if (!resolved) return null
  return (
    parseResolvedUuid(resolved.latest_validation_run_id) ??
    parseResolvedUuid(resolved.validation_run_id) ??
    null
  )
}

export function getLatestExtractRunId(resolved: Record<string, unknown> | null | undefined): string | null {
  if (!resolved) return null
  return (
    parseResolvedUuid(resolved.latest_extract_run_id) ??
    parseResolvedUuid(resolved.extract_run_id) ??
    null
  )
}

export function getLatestDecisionRunId(resolved: Record<string, unknown> | null | undefined): string | null {
  if (!resolved) return null
  return (
    parseResolvedUuid(resolved.latest_decision_run_id) ??
    parseResolvedUuid(resolved.decision_run_id) ??
    null
  )
}
