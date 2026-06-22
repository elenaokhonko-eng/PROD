export type ChronologyEventType =
  | "phishing_email"
  | "token_registration"
  | "limit_change"
  | "fraud_transactions"
  | "fraud_discovery"
  | "hotline_call"
  | "police_report"
  | "dispute_submission"
  | "bank_rejection"
  | "technical_access_request"

export type ChronologyEventStatus = "confirmed" | "inferred" | "requires_confirmation"

/**
 * Canonical chronology event for FIDReC submission packs.
 *
 * Chronology answers: what happened, when (to the extent supported), what evidence
 * supports it, and what facts remain unverified. It must not assign liability,
 * breach, control failure, or negligence — those belong in other sections.
 */
export type ChronologyEvent = {
  event_id: string
  event_type: ChronologyEventType
  event_datetime: string | null
  event_text: string
  status: ChronologyEventStatus
  supporting_evidence: string[]
  claimant_questions: string[]
}

export type ChronologyEventsBuildDiagnostics = {
  raw_candidates: number
  merged_events: number
  confirmed_events: number
  inferred_events: number
  requires_confirmation_events: number
  dropped_document_only_rows: number
}
