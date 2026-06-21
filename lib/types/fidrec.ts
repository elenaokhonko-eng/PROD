export type BankAssertionType = 'factual' | 'technical' | 'procedural' | 'liability'

export type FindingType =
  | 'core_claim'
  | 'chronology'
  | 'authentication'
  | 'transaction_pattern'
  | 'notification'
  | 'customer_behaviour'
  | 'fi_behaviour'
  | 'containment'

export type FindingConfidence = 'low' | 'medium' | 'high'

export type AssertionFindingRelationship =
  | 'supports_bank_assertion'
  | 'rebuts_bank_assertion'
  | 'partially_rebuts'
  | 'requires_particulars'
  | 'irrelevant'

export type InvestigationQuestionType =
  | 'particulars'
  | 'evidence_request'
  | 'chronology_gap'
  | 'authentication_gap'
  | 'containment_gap'
  | 'contradiction'
  | 'human_review'

export type InvestigationQuestionPriority = 'low' | 'medium' | 'high' | 'critical'

export type InvestigationQuestionStatus = 'open' | 'answered' | 'dismissed'

export interface CaseBankAssertionRow {
  id: string
  case_id: string
  source_document_id: string | null
  assertion_text: string
  assertion_type: BankAssertionType
  bank_conclusion_supported: string | null
  particulars_needed: unknown[]
  evidence_needed: unknown[]
  raw_model_output: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface CaseFindingRow {
  id: string
  case_id: string
  finding_text: string
  finding_type: FindingType
  supporting_evidence: unknown[]
  confidence: FindingConfidence
  missing_information: unknown[]
  human_review_required: boolean
  raw_model_output: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface CaseAssertionFindingLinkRow {
  id: string
  case_id: string
  bank_assertion_id: string
  finding_id: string
  relationship: AssertionFindingRelationship
  explanation: string | null
  confidence: FindingConfidence
  next_question: string | null
  created_at: string
  updated_at: string
}

export interface CaseInvestigationQuestionRow {
  id: string
  case_id: string
  source_assertion_id: string | null
  source_finding_id: string | null
  source_link_id: string | null
  question_text: string
  question_type: InvestigationQuestionType
  priority: InvestigationQuestionPriority
  status: InvestigationQuestionStatus
  evidence_requested: unknown[]
  answer: string | null
  raw_model_output: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type EvidenceRequestCategory =
  | 'bank_communication'
  | 'hotline_record'
  | 'transaction_record'
  | 'notification_record'
  | 'authentication_record'
  | 'device_or_ip_record'
  | 'police_or_statutory'
  | 'customer_context'
  | 'bank_particulars'
  | 'other'

export type EvidenceRequestRequestedFrom = 'customer' | 'bank' | 'third_party' | 'unknown'

export type EvidenceRequestPriority = 'low' | 'medium' | 'high' | 'critical'

export type EvidenceRequestStatus = 'open' | 'provided' | 'unavailable' | 'dismissed'

export interface CaseEvidenceRequestRow {
  id: string
  case_id: string
  source_question_id: string | null
  source_assertion_id: string | null
  source_finding_id: string | null
  source_link_id: string | null
  request_text: string
  request_reason: string | null
  evidence_category: EvidenceRequestCategory
  requested_from: EvidenceRequestRequestedFrom
  priority: EvidenceRequestPriority
  status: EvidenceRequestStatus
  suggested_file_types: unknown[]
  example_documents: unknown[]
  raw_model_output: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type ThemeType =
  | 'authentication'
  | 'token_registration'
  | 'transaction_pattern'
  | 'fraud_detection'
  | 'containment'
  | 'customer_reporting'
  | 'bank_investigation_quality'
  | 'evidence_disclosure'
  | 'customer_negligence'
  | 'other'

export type ThemePriority = 'low' | 'medium' | 'high' | 'critical'

export type ThemeStatus = 'open' | 'reviewed' | 'dismissed'

export interface CaseThemeRow {
  id: string
  case_id: string
  theme_type: ThemeType
  theme_title: string
  theme_summary: string | null
  priority: ThemePriority
  status: ThemeStatus
  raw_model_output: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface CaseThemeLinkRow {
  id: string
  case_id: string
  theme_id: string
  bank_assertion_id: string | null
  finding_id: string | null
  assertion_finding_link_id: string | null
  investigation_question_id: string | null
  evidence_request_id: string | null
  link_reason: string | null
  created_at: string
}
