// The FIDReC update's facts in a data export (brief v5, 3e): the institution's records of logins, devices and card
// authentication, the complainant's answers about each device, and the other new facts. They are already in the raw
// fact tables of the export; this section gives the current value of each, per case, so a person can read them.
// Values are copied as stored; nothing here is logged.

import { PAID_STAGE_ONLY_FACT_KEYS, type FactKey } from "@/lib/facts"

export interface FindingRow {
  case_id?: unknown
  fact_key?: unknown
  values?: unknown
  resolution?: unknown
  status?: unknown
  invalidated_at?: unknown
  created_at?: unknown
}

export interface TechnicalRecordExport {
  case_id: string
  fact_key: FactKey
  status: string | null
  /** The values the sources gave, without their quotes or file names. */
  values: unknown[]
  /** The complainant's answer or choice, as stored. */
  resolution: unknown
}

export function technicalRecordsExport(findings: readonly FindingRow[]): TechnicalRecordExport[] {
  return findings
    .filter((f) => !f.invalidated_at && typeof f.case_id === "string" && PAID_STAGE_ONLY_FACT_KEYS.has(f.fact_key as FactKey))
    .map((f) => ({
      case_id: f.case_id as string,
      fact_key: f.fact_key as FactKey,
      status: typeof f.status === "string" ? f.status : null,
      values: Array.isArray(f.values) ? (f.values as Array<{ value?: unknown }>).map((v) => v?.value ?? null) : [],
      resolution: f.resolution ?? null,
    }))
    .sort((a, b) => (a.case_id === b.case_id ? a.fact_key.localeCompare(b.fact_key) : a.case_id.localeCompare(b.case_id)))
}
