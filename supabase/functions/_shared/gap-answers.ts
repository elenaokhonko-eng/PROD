// Follow-up answers to the three required fields (the question key is the field path). An answer is the claimant's
// own statement of the fact, so it fills the field when the story and documents gave nothing; otherwise the same
// question was asked again after every save (demo 7 Nov).

export const REQUIRED_GAP_FIELDS = ["incident_date", "reported_loss.amount", "case_meta.institution_name"] as const

type Extract = {
  incident_date?: string | null
  reported_loss?: { amount?: number | null; currency?: string | null } | null
  case_meta?: { institution_name?: string | null } | null
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function amount(value: unknown): number | null {
  const cleaned = text(value).replace(/[^0-9.]/g, "")
  const n = cleaned ? Number(cleaned) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

export function applyGapAnswers<T extends Extract>(ej: T, answers: Record<string, unknown>): T {
  const loss = amount(answers["reported_loss.amount"])
  if (loss !== null && (ej.reported_loss?.amount === null || ej.reported_loss?.amount === undefined)) {
    ej.reported_loss = { currency: null, ...(ej.reported_loss ?? {}), amount: loss }
  }
  const institution = text(answers["case_meta.institution_name"])
  if (institution && !ej.case_meta?.institution_name) ej.case_meta = { ...(ej.case_meta ?? {}), institution_name: institution }
  const date = text(answers["incident_date"])
  if (/^\d{4}-\d{2}-\d{2}/.test(date) && !ej.incident_date) ej.incident_date = date.slice(0, 10)
  return ej
}
