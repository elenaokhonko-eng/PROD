import type { CasePackTheme } from "@/lib/types/fidrec-case-pack"
import type { FidrecEvidenceType } from "@/lib/types/fidrec-evidence-labels"
import { EXCLUDED_COVERAGE_EVIDENCE_TYPES } from "@/lib/types/fidrec-evidence-labels"
import type {
  EvidenceRelationshipStrength,
  EvidenceThemeOwnership,
  EvidenceThemeRelationship,
} from "@/lib/types/fidrec-evidence-review"

export const THEME_INHERITANCE_CONFIDENCE_THRESHOLD = 0.5

export type ThemeLinkSource = "inheritance" | "keyword" | "type" | "overlap"

export type ThemeLinkCandidate = {
  theme_id: string
  confidence: number
  source: ThemeLinkSource
  reason: string
}

const EXCLUDED_TYPE_PATTERNS: Array<{ pattern: RegExp; type: FidrecEvidenceType }> = [
  { pattern: /\b(flight\s*itinerary|travel\s*itinerary|boarding\s*pass)\b/i, type: "flight_itinerary" },
  { pattern: /\b(travel\s*document|passport|visa)\b/i, type: "travel_document" },
  { pattern: /\b(identity\s*document|nric|passport|driving\s*licen[cs]e)\b/i, type: "identity_document" },
  { pattern: /\b(news\s*article|news\s*clip|newspaper)\b/i, type: "news_article" },
]

const DIRECT_THEME_REASONS = new Set(["authentication", "reporting", "fraud monitoring", "hotline", "token"])

export function detectExcludedEvidenceType(corpus: string): FidrecEvidenceType | null {
  for (const entry of EXCLUDED_TYPE_PATTERNS) {
    if (entry.pattern.test(corpus)) {
      return entry.type
    }
  }
  return null
}

export function isExcludedFromCoverage(
  evidenceType: FidrecEvidenceType,
  manualCoverageOverride?: boolean,
): boolean {
  if (manualCoverageOverride) {
    return false
  }
  return EXCLUDED_COVERAGE_EVIDENCE_TYPES.has(evidenceType)
}

export function countIndependentReasonCategories(candidates: ThemeLinkCandidate[]): number {
  return new Set(candidates.map((candidate) => candidate.source)).size
}

export function passesThemeInheritanceThreshold(candidates: ThemeLinkCandidate[]): boolean {
  const inheritanceCandidates = candidates.filter((candidate) => candidate.source === "inheritance")
  if (!inheritanceCandidates.length) {
    return false
  }

  const maxConfidence = Math.max(...inheritanceCandidates.map((candidate) => candidate.confidence))
  const independentReasonCount = countIndependentReasonCategories(inheritanceCandidates)

  return (
    maxConfidence >= THEME_INHERITANCE_CONFIDENCE_THRESHOLD ||
    independentReasonCount >= 2
  )
}

export function resolveRelationshipStrength(input: {
  evidenceType: FidrecEvidenceType
  theme: CasePackTheme
  sources: ThemeLinkSource[]
  keywordReason: string | null
}): EvidenceRelationshipStrength {
  if (EXCLUDED_COVERAGE_EVIDENCE_TYPES.has(input.evidenceType)) {
    return "contextual"
  }

  if (input.sources.length === 1 && input.sources[0] === "overlap") {
    return "contextual"
  }

  if (input.evidenceType === "screenshot" && !input.keywordReason) {
    return "contextual"
  }

  if (
    input.keywordReason &&
    DIRECT_THEME_REASONS.has(input.keywordReason) &&
    input.sources.includes("keyword")
  ) {
    const themeCorpus = [input.theme.theme_title, input.theme.theme_summary, input.theme.theme_type]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

    if (input.keywordReason === "authentication" && /authenticat|token|wallet/i.test(themeCorpus)) {
      return "direct"
    }
    if (input.keywordReason === "reporting" && /report|notification|hotline|timeline/i.test(themeCorpus)) {
      return "direct"
    }
    if (input.keywordReason === "fraud monitoring" && /monitor|anomal|transaction|fraud/i.test(themeCorpus)) {
      return "direct"
    }
    if (input.keywordReason === "hotline" || input.keywordReason === "token") {
      return "direct"
    }
  }

  if (
    input.evidenceType === "bank_final_response" ||
    input.evidenceType === "bank_email_or_letter" ||
    input.evidenceType === "bank_investigation_report"
  ) {
    return "supporting"
  }

  if (input.sources.includes("keyword") || input.sources.includes("type")) {
    return input.sources.includes("keyword") ? "direct" : "supporting"
  }

  if (input.sources.includes("inheritance")) {
    return "supporting"
  }

  return "contextual"
}

export function relationshipSupportsCoverage(strength: EvidenceRelationshipStrength): boolean {
  return strength === "direct" || strength === "supporting"
}

const SOURCE_PRIORITY_SCORE: Record<ThemeLinkSource, number> = {
  keyword: 40,
  type: 25,
  inheritance: 15,
  overlap: 5,
}

const STRENGTH_PRIORITY_SCORE: Record<EvidenceRelationshipStrength, number> = {
  direct: 100,
  supporting: 50,
  contextual: 0,
}

function extractKeywordReason(reason: string): string | null {
  const match = reason.match(/theme keyword match:\s*(.+)/i)
  return match?.[1]?.trim() ?? null
}

function keywordThemeAlignmentBonus(keywordReason: string, themeCorpus: string): number {
  if (
    (keywordReason === "hotline" || keywordReason === "reporting") &&
    /report|notification|hotline|contact|timeline/i.test(themeCorpus)
  ) {
    return 30
  }
  if (
    (keywordReason === "authentication" || keywordReason === "token") &&
    /authenticat|token|wallet|device|verification/i.test(themeCorpus)
  ) {
    return 30
  }
  if (
    keywordReason === "fraud monitoring" &&
    /monitor|anomal|transaction|fraud|detection/i.test(themeCorpus)
  ) {
    return 30
  }
  return 0
}

function corpusAlignmentBonus(evidenceCorpus: string, themeCorpus: string): number {
  let bonus = 0

  if (
    /\bhotline\b|\bcall\s*log\b|\bfraud\s*hotline\b/i.test(evidenceCorpus) &&
    /report|notification|hotline|contact/i.test(themeCorpus)
  ) {
    bonus += 50
  }

  if (
    /\bcyber\s*security\b|\bcybersecurity\b|\bexpert\s*report\b/i.test(evidenceCorpus) &&
    /authenticat|token|security|wallet/i.test(themeCorpus)
  ) {
    bonus += 50
  }

  return bonus
}

function scorePrimaryThemeOwnership(input: {
  relationship: Pick<EvidenceThemeRelationship, "theme_id" | "theme_title" | "relationship_strength">
  candidates: ThemeLinkCandidate[]
  evidenceCorpus: string
}): number {
  const strengthScore = STRENGTH_PRIORITY_SCORE[input.relationship.relationship_strength]
  if (strengthScore <= 0) {
    return 0
  }

  const themeCandidates = input.candidates.filter(
    (candidate) => candidate.theme_id === input.relationship.theme_id,
  )
  const themeCorpus = input.relationship.theme_title.toLowerCase()

  let sourceScore = 0
  for (const candidate of themeCandidates) {
    sourceScore = Math.max(
      sourceScore,
      SOURCE_PRIORITY_SCORE[candidate.source] + candidate.confidence * 20,
    )
  }

  const keywordReasons = themeCandidates
    .map((candidate) => extractKeywordReason(candidate.reason))
    .filter((reason): reason is string => Boolean(reason))

  const alignmentBonus = Math.max(
    ...keywordReasons.map((reason) => keywordThemeAlignmentBonus(reason, themeCorpus)),
    0,
  ) + corpusAlignmentBonus(input.evidenceCorpus, themeCorpus)

  return strengthScore + sourceScore + alignmentBonus
}

export function assignThemeOwnership(input: {
  relationships: Array<
    Omit<EvidenceThemeRelationship, "ownership" | "supports_coverage"> & {
      supports_coverage?: boolean
    }
  >
  candidates: ThemeLinkCandidate[]
  evidenceCorpus: string
  itemSupportsCoverage: boolean
}): EvidenceThemeRelationship[] {
  const scored = input.relationships.map((relationship) => ({
    relationship,
    score: scorePrimaryThemeOwnership({
      relationship,
      candidates: input.candidates,
      evidenceCorpus: input.evidenceCorpus,
    }),
  }))

  const coverable = scored.filter((entry) => entry.score > 0)
  const primaryThemeId =
    coverable.length > 0
      ? coverable.reduce((best, entry) => (entry.score > best.score ? entry : best)).relationship
          .theme_id
      : null

  return input.relationships.map((relationship) => {
    const ownership: EvidenceThemeOwnership =
      primaryThemeId && relationship.theme_id === primaryThemeId ? "primary" : "secondary"
    const supports_coverage =
      input.itemSupportsCoverage &&
      ownership === "primary" &&
      relationshipSupportsCoverage(relationship.relationship_strength)

    return {
      ...relationship,
      ownership,
      supports_coverage,
    }
  })
}
