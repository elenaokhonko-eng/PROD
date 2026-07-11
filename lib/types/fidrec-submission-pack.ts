import type { ChronologyEvent } from "@/lib/types/fidrec-chronology"

export type FidrecSubmissionPackVersion = "fidrec_submission_pack_v1"

export type SubmissionEvidenceImportance = "high" | "medium" | "low"

export type ChronologyEventSource = "finding" | "document_metadata" | "evidence_label"

export type ChronologyEventConfidence = "high" | "medium" | "low"

export interface SubmissionExecutiveSummary {
  narrative: string
}

export type ExecutiveSummaryFactConfidence = "high" | "medium" | "low"

export type FactValue<T> = {
  value: T | null
  source: string | null
  confidence: ExecutiveSummaryFactConfidence
}

export type ExecutiveSummaryCustomerNotificationEvent = {
  channel: "fraud_hotline" | "email" | "branch" | "unknown"
  date_time_display: string | null
}

export type ExecutiveSummaryBankDecisionEvent = {
  decision: "declined" | "rejected_restitution" | "unknown"
  date_display: string | null
}

export type ExecutiveSummaryDisputedAmount = {
  amount: number
  currency: string
}

export type ExecutiveSummaryFacts = {
  customer_name: FactValue<string>
  institution_name: FactValue<string>
  product_description: FactValue<string>
  masked_account_or_card: FactValue<string>
  transaction_count: FactValue<number>
  disputed_amount: FactValue<ExecutiveSummaryDisputedAmount>
  transaction_date_phrase: FactValue<string>
  merchants: FactValue<string[]>
  token_registration_event: FactValue<boolean>
  customer_notification_event: FactValue<ExecutiveSummaryCustomerNotificationEvent>
  bank_decision_event: FactValue<ExecutiveSummaryBankDecisionEvent>
  bank_authentication_basis: FactValue<string[]>
  principal_issues: FactValue<string[]>
}

export type ExecutiveSummaryBuildDiagnostics = ExecutiveSummaryFacts

export type ExecutiveSummaryCriticalFactDiagnostics = {
  customer_name_candidates: string[]
  selected_customer_name: string | null
  selected_customer_name_reason: string | null
  loss_amount_candidates: string[]
  selected_loss_amount: string | null
  selected_loss_amount_reason: string | null
  account_card_candidates: string[]
  selected_account_or_card: string | null
  selected_account_or_card_reason: string | null
}

export type ExecutiveSummaryCaseOverviewDiagnostics = {
  claimant_name_candidates: string[]
  selected_claimant_name: string | null
  selected_claimant_name_reason: string | null
  loss_amount_candidates: string[]
  selected_loss_amount: string | null
  selected_loss_amount_reason: string | null
  loss_breakdown: string[]
  products: string[]
  bank_rejection_basis: string[]
}

export type { ChronologyEvent, ChronologyEventType, ChronologyEventStatus } from "@/lib/types/fidrec-chronology"

export interface SubmissionChronologyEvent {
  event_date: string | null
  event_time: string | null
  date_display: string
  event_text: string
  evidence_refs: string[]
  source: ChronologyEventSource
  confidence: ChronologyEventConfidence
  sort_order: number
}

export interface SubmissionPositionPoint {
  statement: string
  evidence_labels: string[]
}

export interface SubmissionCustomerPosition {
  narrative: string
  points: SubmissionPositionPoint[]
}

export interface SubmissionBankPosition {
  narrative: string
  stated_grounds: string[]
  evidence_refs: string[]
}

export interface BankPositionBuildDiagnostics {
  raw_bank_assertions: number
  grouped_assertions: {
    authentication: number
    rejection: number
    customer_responsibility: number
  }
  evidence_refs_used: string[]
  duplicate_assertions_merged: number
}

export interface SubmissionIssueInDispute {
  issue_title: string
  explanation: string
  customer_position: string
  bank_position: string
  evidence_available: string[]
  evidence_required: string[]
}

export interface SubmissionEvidenceBundleItem {
  evidence_label: string
  title: string
  summary: string
  why_it_matters: string
  supports_issues: string[]
  importance: SubmissionEvidenceImportance
}

export interface SubmissionOutstandingEvidence {
  requested_from_bank: string[]
  requested_from_customer: string[]
}

export interface SubmissionRegulatoryProvision {
  document_name: string
  clause_reference: string
  clause_title: string
}

export interface SubmissionRegulatoryFramework {
  introductory_text: string
  provisions: SubmissionRegulatoryProvision[]
}

export interface SubmissionAnnexure {
  annexure_label: string
  evidence_label: string
  title: string
}

export interface ChronologyBuildDiagnostics {
  raw_chronology_candidates: number
  merged_chronology_events: number
  dropped_document_only_rows: number
  duplicate_events_merged: number
  undated_events: number
  confirmed_events: number
  inferred_events: number
  requires_confirmation_events: number
}

export interface FidrecSubmissionPack {
  case_id: string
  generated_at: string
  pack_version: FidrecSubmissionPackVersion
  executive_summary: SubmissionExecutiveSummary
  chronology_of_events: ChronologyEvent[]
  customer_position: SubmissionCustomerPosition
  bank_position: SubmissionBankPosition
  issues_in_dispute: SubmissionIssueInDispute[]
  evidence_bundle: SubmissionEvidenceBundleItem[]
  outstanding_evidence: SubmissionOutstandingEvidence
  applicable_regulatory_framework: SubmissionRegulatoryFramework
  annexures: SubmissionAnnexure[]
}
