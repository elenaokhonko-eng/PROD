export type EvidenceStrength = "high" | "medium" | "low" | "unknown"

export type EvidenceReviewStatus = "available" | "requested" | "missing"

export type EvidenceCoverageStatus = "strong" | "partial" | "weak"

export type EvidenceRelationshipStrength = "direct" | "supporting" | "contextual"

export type EvidenceThemeOwnership = "primary" | "secondary"

export interface EvidenceThemeRelationship {
  theme_id: string
  theme_title: string
  relationship_strength: EvidenceRelationshipStrength
  ownership: EvidenceThemeOwnership
  supports_coverage: boolean
  link_reasons: string[]
}

export interface EvidenceReviewItem {
  evidence_label: string
  title: string
  evidence_type: string
  description: string
  source_confidence: string
  supports_themes: string[]
  theme_relationships: EvidenceThemeRelationship[]
  supports_coverage: boolean
  related_findings: string[]
  related_assertions: string[]
  related_questions: string[]
  related_evidence_requests: string[]
  reviewer_notes: string[]
  evidence_strength: EvidenceStrength
  evidence_status: EvidenceReviewStatus
}

export interface EvidenceLinkDiagnostic {
  evidence_label: string
  title: string
  linked_finding_count: number
  linked_theme_count: number
  link_reasons: string[]
}

export interface EvidenceReviewModel {
  evidence_items: EvidenceReviewItem[]
  link_diagnostics: EvidenceLinkDiagnostic[]
}

export interface EvidenceCoverageMatrixRow {
  theme_id: string
  theme_title: string
  available_evidence_count: number
  requested_evidence_count: number
  missing_evidence_count: number
  weighted_evidence_score: number
  coverage_score: number
  coverage_status: EvidenceCoverageStatus
}

export interface EvidenceCoverageMatrix {
  themes: EvidenceCoverageMatrixRow[]
}

export const EVIDENCE_RELATIONSHIP_WEIGHTS: Record<EvidenceRelationshipStrength, number> = {
  direct: 1.0,
  supporting: 0.5,
  contextual: 0,
}
