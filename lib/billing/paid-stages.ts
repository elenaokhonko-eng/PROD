// Staged go-live (approved 2026-11-05): stage 1 launches the free evaluation only. Both paid products (bank pack
// S$18, FIDReC pack S$188) stay off until stage 2 and are shown as "available from" a date. Unset means off, so a
// missing setting can never take payments.

const DEFAULT_AVAILABLE_FROM = "2026-12-01"

export function paidStagesEnabled(): boolean {
  return process.env.PAID_STAGES_ENABLED?.trim().toLowerCase() === "true"
}

export function paidStagesAvailableFrom(): string {
  const value = process.env.PAID_STAGES_AVAILABLE_FROM?.trim()
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : DEFAULT_AVAILABLE_FROM
}

export interface PaidStagesState {
  enabled: boolean
  availableFrom: string
}

export function paidStagesState(): PaidStagesState {
  return { enabled: paidStagesEnabled(), availableFrom: paidStagesAvailableFrom() }
}
