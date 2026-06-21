export type EvidenceLabelSourceConfidence = "high" | "medium" | "low"

export type FidrecEvidenceType =
  | "bank_final_response"
  | "bank_investigation_report"
  | "bank_email_or_letter"
  | "transaction_history"
  | "police_report"
  | "statutory_declaration"
  | "hotline_call_record"
  | "sms_or_email_alert"
  | "token_registration_record"
  | "authentication_record"
  | "device_or_ip_record"
  | "fraud_monitoring_record"
  | "containment_record"
  | "customer_narrative"
  | "merchant_record"
  | "screenshot"
  | "flight_itinerary"
  | "travel_document"
  | "identity_document"
  | "news_article"
  | "other"

export const EXCLUDED_COVERAGE_EVIDENCE_TYPES = new Set<FidrecEvidenceType>([
  "flight_itinerary",
  "travel_document",
  "identity_document",
  "news_article",
])

export interface EvidenceLabel {
  evidence_id: string
  case_document_id: string
  label: string
  label_number: number
  title: string
  evidence_type: FidrecEvidenceType
  original_filename: string | null
  document_date: string | null
  uploaded_at: string | null
  short_description: string
  source_confidence: EvidenceLabelSourceConfidence
  linked_finding_ids: string[]
  linked_theme_ids: string[]
  linked_evidence_request_ids: string[]
}

export interface GenerateEvidenceLabelsInput {
  caseId: string
}

export interface GenerateEvidenceLabelsResult {
  evidence_labels: EvidenceLabel[]
}

export type CasePackAnnexureStatus = "available" | "requested" | "placeholder"

export interface CasePackAnnexurePlaceholder {
  annexure_label: string
  evidence_label: string | null
  title: string
  source: "customer" | "bank" | "third_party" | "unknown"
  related_theme_id: string | null
  related_evidence_request_id: string | null
  related_case_document_id: string | null
  status: CasePackAnnexureStatus
}
