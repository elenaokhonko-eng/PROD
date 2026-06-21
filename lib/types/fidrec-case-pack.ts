import type { CasePackAnnexurePlaceholder, EvidenceLabel } from "@/lib/types/fidrec-evidence-labels"
import type { EvidenceCoverageMatrix, EvidenceReviewModel } from "@/lib/types/fidrec-evidence-review"
import type {
  BankPositionBuildDiagnostics,
  ChronologyBuildDiagnostics,
  ExecutiveSummaryBuildDiagnostics,
  ExecutiveSummaryCaseOverviewDiagnostics,
  ExecutiveSummaryCriticalFactDiagnostics,
} from "@/lib/types/fidrec-submission-pack"
import type { FidrecSubmissionPack } from "@/lib/types/fidrec-submission-pack"

export type { CasePackAnnexurePlaceholder, EvidenceLabel } from "@/lib/types/fidrec-evidence-labels"
export type { EvidenceCoverageMatrix, EvidenceReviewModel } from "@/lib/types/fidrec-evidence-review"
export type { FidrecSubmissionPack } from "@/lib/types/fidrec-submission-pack"

export type FidrecCasePackVersion = "fidrec_case_pack_v1"

export interface CasePackExecutiveSummary {
  text: string
}

export interface CasePackInvestigationQuestion {
  id: string
  question_text: string
  priority: string
}

export interface CasePackThemeEvidenceRequest {
  id: string
  request_text: string
  evidence_category: string
  requested_from: string
  priority: string
  status: string
}

export interface CasePackRegulatoryReference {
  clause_id: string
  document_name: string
  clause_number: string
  clause_title: string
  clause_summary: string
  similarity_score: number | null
}

export interface CasePackTheme {
  theme_id: string
  theme_title: string
  theme_type: string
  priority: string
  theme_summary: string | null
  issue: string | null
  investigation_question: CasePackInvestigationQuestion | null
  evidence_requests: CasePackThemeEvidenceRequest[]
  regulatory_references: CasePackRegulatoryReference[]
}

export interface CasePackMaterialFinding {
  finding_id: string
  finding_text: string
  finding_type: string
  relationship: string
  confidence: string
  explanation: string
}

export interface CasePackAssertionSection {
  assertion_id: string
  assertion_text: string
  assertion_type: string
  bank_conclusion_supported: string | null
  material_findings: CasePackMaterialFinding[]
}

export interface CasePackOutstandingEvidenceRequest {
  id: string
  request_text: string
  request_reason: string | null
  evidence_category: string
  requested_from: string
  priority: string
  status: string
  suggested_file_types: string[]
  example_documents: string[]
}

export interface CasePackEvidenceRequestGroup {
  theme_id: string | null
  theme_title: string
  requests: CasePackOutstandingEvidenceRequest[]
}

export interface CasePackRegulatoryReferenceGroup {
  theme_id: string
  theme_title: string
  references: CasePackRegulatoryReference[]
}

export type CasePackAnnexureSource = "customer" | "bank" | "third_party" | "unknown"

/** Internal pipeline artefacts retained for dev diagnostics only. */
export interface FidrecCasePackInternalDebug {
  pack_version: FidrecCasePackVersion
  key_themes: CasePackTheme[]
  bank_assertions_and_material_findings: CasePackAssertionSection[]
  outstanding_evidence_requests: CasePackEvidenceRequestGroup[]
  relevant_regulatory_references: CasePackRegulatoryReferenceGroup[]
  evidence_labels: EvidenceLabel[]
  evidence_review_model: EvidenceReviewModel
  evidence_coverage_matrix: EvidenceCoverageMatrix
  annexure_placeholders: CasePackAnnexurePlaceholder[]
  chronology_diagnostics: ChronologyBuildDiagnostics
  bank_position_diagnostics: BankPositionBuildDiagnostics
  executive_summary_diagnostics: ExecutiveSummaryBuildDiagnostics
  executive_summary_critical_fact_diagnostics: ExecutiveSummaryCriticalFactDiagnostics
  executive_summary_case_overview_diagnostics: ExecutiveSummaryCaseOverviewDiagnostics
}

export interface FidrecCasePackGenerationResult {
  submission_pack: FidrecSubmissionPack
  internal_debug: FidrecCasePackInternalDebug
}

/** @deprecated Use FidrecCasePackGenerationResult.submission_pack for customer-facing output. */
export interface FidrecCasePackJson extends FidrecCasePackInternalDebug {
  case_id: string
  generated_at: string
  executive_summary: CasePackExecutiveSummary
}

export type GenerateCasePackJsonInput = {
  caseId: string
}
