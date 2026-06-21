import {
  assignThemeOwnership,
  detectExcludedEvidenceType,
  isExcludedFromCoverage,
  passesThemeInheritanceThreshold,
  resolveRelationshipStrength,
  type ThemeLinkCandidate,
} from "@/lib/server/fidrec/evidence-relevance"
import type { CasePackTheme } from "@/lib/types/fidrec-case-pack"
import type { FidrecEvidenceType } from "@/lib/types/fidrec-evidence-labels"
import type { EvidenceThemeRelationship } from "@/lib/types/fidrec-evidence-review"
import type {
  CaseBankAssertionRow,
  CaseFindingRow,
  CaseThemeLinkRow,
} from "@/lib/types/fidrec"

export type EvidenceLinkResult = {
  linked_theme_ids: string[]
  linked_finding_ids: string[]
  linked_assertion_ids: string[]
  link_reasons: string[]
  theme_relationships: EvidenceThemeRelationship[]
  supports_coverage: boolean
  excluded_evidence_type: FidrecEvidenceType | null
}

export type EvidencePresentationContext = {
  verifiedProcessedType: string | null
  predictedProcessedType: string | null
  extractedText: string | null
  extractedJson?: Record<string, unknown> | null
}

export type BuildEvidenceLinksInput = {
  evidenceLabel: EvidenceLabel
  reviewTitle: string
  presentation: EvidencePresentationContext
  findings: CaseFindingRow[]
  themes: CasePackTheme[]
  themeLinks: CaseThemeLinkRow[]
  assertions: CaseBankAssertionRow[]
  existingLinkedFindingIds?: string[]
  existingLinkedThemeIds?: string[]
  existingLinkedAssertionIds?: string[]
  manualCoverageOverride?: boolean
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "they",
  "them",
  "their",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "his",
  "her",
  "not",
  "no",
  "after",
  "before",
  "during",
  "within",
  "into",
  "through",
  "over",
  "under",
  "between",
  "about",
  "against",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "than",
  "too",
  "very",
  "just",
  "also",
  "only",
  "own",
  "same",
  "so",
  "then",
  "there",
  "when",
  "where",
  "who",
  "whom",
  "which",
  "what",
  "how",
  "why",
  "if",
  "because",
  "while",
  "although",
  "though",
  "until",
  "unless",
  "since",
  "upon",
  "per",
  "via",
  "customer",
  "bank",
  "case",
  "document",
  "record",
  "records",
  "file",
  "uploaded",
  "original",
  "filename",
  "identified",
])

const FINDING_KEYWORD_RULES: Array<{
  evidencePatterns: RegExp[]
  findingPatterns: RegExp[]
  reason: string
}> = [
  {
    evidencePatterns: [
      /\bhotline\b/i,
      /\bcall\s*log\b/i,
      /\bfraud\s*hotline\b/i,
      /\bcall\s*recording\b/i,
      /\bBANK_SCAM_FRAUD_HOTLINE/i,
    ],
    findingPatterns: [/\bhotline\b/i, /\bcalled\b/i, /\bcall(ed)?\s+the\s+bank\b/i, /\bfraud\s*hotline\b/i],
    reason: "hotline",
  },
  {
    evidencePatterns: [/\btoken\b/i, /\bwallet\b/i, /\bdigital\s*token\b/i, /\btoken\s*registration\b/i],
    findingPatterns: [/\btoken\b/i, /\bwallet\b/i, /\bdigital\s*token\b/i, /\bregistered\b/i],
    reason: "token",
  },
  {
    evidencePatterns: [
      /\btransaction\b/i,
      /\bpending\s*transaction\b/i,
      /\bstatement\b/i,
      /\brapidly\s*drained\b/i,
      /\bdrained\b/i,
    ],
    findingPatterns: [
      /\btransaction\b/i,
      /\bdisputed\b/i,
      /\bminutes\b/i,
      /\boccurred\s+within\b/i,
      /\bpending\b/i,
    ],
    reason: "transaction",
  },
  {
    evidencePatterns: [/\bexpert\s*report\b/i, /\bcyber\s*security\b/i, /\bcybersecurity\b/i, /\bforensic\b/i],
    findingPatterns: [/\btoken\b/i, /\bcompromise\b/i, /\bauthentication\b/i, /\bcredential\b/i],
    reason: "token compromise",
  },
  {
    evidencePatterns: [/\bcontainment\b/i, /\bfreeze\b/i, /\bblock\b/i],
    findingPatterns: [/\bcontainment\b/i, /\bfreeze\b/i, /\bblock\b/i, /\bhotline\b/i],
    reason: "containment",
  },
  {
    evidencePatterns: [/\bnotification\b/i, /\bsms\b/i, /\bemail\s*alert\b/i],
    findingPatterns: [/\bnotif/i, /\bsms\b/i, /\balert\b/i],
    reason: "notification",
  },
]

const EVIDENCE_THEME_KEYWORD_RULES: Array<{
  evidencePatterns: RegExp[]
  themePatterns: RegExp[]
  reason: string
}> = [
  {
    evidencePatterns: [/\bhotline\b/i, /\bcall\s*log\b/i, /\breport\b/i, /\bcustomer\s*service\b/i, /\bnotification\b/i],
    themePatterns: [
      /\breport/i,
      /\bnotification/i,
      /\bhotline/i,
      /\bcustomer\s*report/i,
      /\bcontainment\s*actions\s*post/i,
      /\btimeline/i,
      /\btimelines/i,
    ],
    reason: "reporting",
  },
  {
    evidencePatterns: [
      /\bauthentication\b/i,
      /\b3ds\b/i,
      /\b3d\s*secure\b/i,
      /\btoken\b/i,
      /\bwallet\b/i,
      /\bdevice\b/i,
      /\bverification\b/i,
      /\bexpert\s*report\b/i,
      /\bcyber\s*security\b/i,
    ],
    themePatterns: [
      /\bauthentication/i,
      /\btoken/i,
      /\bwallet/i,
      /\bdevice/i,
      /\bverification/i,
    ],
    reason: "authentication",
  },
  {
    evidencePatterns: [
      /\btransaction\s*pattern\b/i,
      /\bfraud\s*alert\b/i,
      /\bvelocity\b/i,
      /\bmonitoring\b/i,
      /\bcontainment\b/i,
      /\bpending\s*transaction\b/i,
      /\bscreenshot\b/i,
      /\btransaction\b/i,
    ],
    themePatterns: [
      /\bfraud\s*monitor/i,
      /\banomaly/i,
      /\btransaction\s*pattern/i,
      /\bmonitoring/i,
      /\bdetection/i,
      /\bcontainment/i,
    ],
    reason: "fraud monitoring",
  },
]

const EVIDENCE_TYPE_THEME_TYPES: Partial<Record<FidrecEvidenceType, string[]>> = {
  hotline_call_record: ["customer_reporting", "containment"],
  bank_email_or_letter: ["customer_reporting", "bank_investigation_quality", "evidence_disclosure"],
  token_registration_record: ["authentication", "token_registration"],
  authentication_record: ["authentication"],
  device_or_ip_record: ["authentication"],
  transaction_history: ["transaction_pattern", "fraud_detection"],
  fraud_monitoring_record: ["fraud_detection"],
  containment_record: ["containment"],
  screenshot: ["fraud_detection", "authentication"],
  other: ["authentication", "fraud_detection"],
}

const OVERLAP_SCORE_THRESHOLD = 0.12
const MIN_SHARED_TOKENS = 2
const MIN_SIGNIFICANT_TOKEN_LENGTH = 4

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= MIN_SIGNIFICANT_TOKEN_LENGTH && !STOP_WORDS.has(token))
}

function extractSupportingEvidenceStrings(finding: CaseFindingRow): string[] {
  if (!Array.isArray(finding.supporting_evidence)) {
    return []
  }
  return finding.supporting_evidence.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  )
}

function buildEvidenceCorpus(input: BuildEvidenceLinksInput): string {
  return [
    input.presentation.verifiedProcessedType,
    input.presentation.predictedProcessedType,
    input.presentation.extractedText,
    input.evidenceLabel.short_description,
    input.evidenceLabel.original_filename,
    input.reviewTitle,
    input.evidenceLabel.evidence_type.replaceAll("_", " "),
  ]
    .filter(Boolean)
    .join(" ")
    .replaceAll("_", " ")
}

function buildFindingCorpus(finding: CaseFindingRow): string {
  return [finding.finding_text, finding.finding_type.replaceAll("_", " "), ...extractSupportingEvidenceStrings(finding)]
    .filter(Boolean)
    .join(" ")
}

function buildThemeCorpus(theme: CasePackTheme): string {
  return [theme.theme_title, theme.theme_summary, theme.theme_type.replaceAll("_", " ")]
    .filter(Boolean)
    .join(" ")
}

function computeOverlapScore(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left))
  const rightTokens = new Set(tokenize(right))
  if (!leftTokens.size || !rightTokens.size) {
    return 0
  }

  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size
  return union > 0 ? intersection / union : 0
}

function countSharedTokens(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left))
  const rightTokens = tokenize(right)
  let count = 0
  for (const token of rightTokens) {
    if (leftTokens.has(token)) {
      count += 1
    }
  }
  return count
}

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function matchFindingsByKeywords(
  evidenceCorpus: string,
  findings: CaseFindingRow[],
): { findingIds: string[]; reasons: string[] } {
  const findingIds: string[] = []
  const reasons: string[] = []

  for (const rule of FINDING_KEYWORD_RULES) {
    if (!matchesAnyPattern(evidenceCorpus, rule.evidencePatterns)) {
      continue
    }

    for (const finding of findings) {
      const findingCorpus = buildFindingCorpus(finding)
      if (!matchesAnyPattern(findingCorpus, rule.findingPatterns)) {
        continue
      }
      findingIds.push(finding.id)
      reasons.push(`keyword match: ${rule.reason}`)
    }
  }

  return { findingIds, reasons }
}

function matchFindingsByOverlap(
  evidenceCorpus: string,
  findings: CaseFindingRow[],
): { findingIds: string[]; reasons: string[] } {
  const findingIds: string[] = []
  const reasons: string[] = []

  for (const finding of findings) {
    const findingCorpus = buildFindingCorpus(finding)
    const overlapScore = computeOverlapScore(evidenceCorpus, findingCorpus)
    const sharedTokens = countSharedTokens(evidenceCorpus, findingCorpus)

    if (overlapScore >= OVERLAP_SCORE_THRESHOLD || sharedTokens >= MIN_SHARED_TOKENS) {
      findingIds.push(finding.id)
      reasons.push(`text overlap: ${Math.max(overlapScore, sharedTokens / 10).toFixed(2)}`)
    }
  }

  return { findingIds, reasons }
}

function inheritThemesFromFindings(
  findingIds: string[],
  themeLinks: CaseThemeLinkRow[],
  findings: CaseFindingRow[],
  evidenceCorpus: string,
): ThemeLinkCandidate[] {
  const findingIdSet = new Set(findingIds)
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]))
  const candidates: ThemeLinkCandidate[] = []

  for (const link of themeLinks) {
    if (!link.finding_id || !findingIdSet.has(link.finding_id)) continue

    const finding = findingsById.get(link.finding_id)
    if (!finding) continue

    const findingCorpus = buildFindingCorpus(finding)
    const overlapScore = computeOverlapScore(evidenceCorpus, findingCorpus)
    const sharedTokens = countSharedTokens(evidenceCorpus, findingCorpus)
    const confidence = Math.max(overlapScore, sharedTokens >= MIN_SHARED_TOKENS ? 0.5 : 0.2)

    candidates.push({
      theme_id: link.theme_id,
      confidence,
      source: "inheritance",
      reason: "inherited from linked finding",
    })
  }

  return candidates
}

function matchThemesByKeywords(evidenceCorpus: string, themes: CasePackTheme[]): ThemeLinkCandidate[] {
  const candidates: ThemeLinkCandidate[] = []

  for (const rule of EVIDENCE_THEME_KEYWORD_RULES) {
    if (!matchesAnyPattern(evidenceCorpus, rule.evidencePatterns)) continue

    for (const theme of themes) {
      const themeCorpus = buildThemeCorpus(theme)
      if (!matchesAnyPattern(themeCorpus, rule.themePatterns)) continue

      candidates.push({
        theme_id: theme.theme_id,
        confidence: 0.75,
        source: "keyword",
        reason: `theme keyword match: ${rule.reason}`,
      })
    }
  }

  return candidates
}

function matchThemesByEvidenceType(evidenceType: FidrecEvidenceType, themes: CasePackTheme[]): ThemeLinkCandidate[] {
  const mappedThemeTypes = EVIDENCE_TYPE_THEME_TYPES[evidenceType] ?? []
  const candidates: ThemeLinkCandidate[] = []

  for (const theme of themes) {
    if (!mappedThemeTypes.includes(theme.theme_type)) continue

    candidates.push({
      theme_id: theme.theme_id,
      confidence: 0.6,
      source: "type",
      reason: `evidence type match: ${evidenceType}`,
    })
  }

  return candidates
}

function matchThemesByOverlap(evidenceCorpus: string, themes: CasePackTheme[]): ThemeLinkCandidate[] {
  const candidates: ThemeLinkCandidate[] = []

  for (const theme of themes) {
    const themeCorpus = buildThemeCorpus(theme)
    const overlapScore = computeOverlapScore(evidenceCorpus, themeCorpus)
    const sharedTokens = countSharedTokens(evidenceCorpus, themeCorpus)

    if (overlapScore >= OVERLAP_SCORE_THRESHOLD || sharedTokens >= MIN_SHARED_TOKENS) {
      candidates.push({
        theme_id: theme.theme_id,
        confidence: Math.max(overlapScore, sharedTokens >= MIN_SHARED_TOKENS ? 0.5 : 0.2),
        source: "overlap",
        reason: `theme text overlap: ${Math.max(overlapScore, sharedTokens / 10).toFixed(2)}`,
      })
    }
  }

  return candidates
}

function extractKeywordReason(reason: string): string | null {
  const match = reason.match(/theme keyword match:\s*(.+)/i)
  return match?.[1]?.trim() ?? null
}

function groupCandidatesByTheme(candidates: ThemeLinkCandidate[]): Map<string, ThemeLinkCandidate[]> {
  const grouped = new Map<string, ThemeLinkCandidate[]>()
  for (const candidate of candidates) {
    const list = grouped.get(candidate.theme_id) ?? []
    list.push(candidate)
    grouped.set(candidate.theme_id, list)
  }
  return grouped
}

function filterInheritanceCandidates(candidates: ThemeLinkCandidate[]): ThemeLinkCandidate[] {
  const grouped = groupCandidatesByTheme(candidates)
  const acceptedInheritanceThemeIds = new Set<string>()

  for (const [themeId, themeCandidates] of grouped) {
    const inheritanceCandidates = themeCandidates.filter((candidate) => candidate.source === "inheritance")
    if (!inheritanceCandidates.length) continue

    const independentSourceCount = new Set(themeCandidates.map((candidate) => candidate.source)).size
    const maxInheritanceConfidence = Math.max(...inheritanceCandidates.map((candidate) => candidate.confidence))

    if (
      maxInheritanceConfidence >= 0.5 ||
      independentSourceCount >= 2 ||
      passesThemeInheritanceThreshold(inheritanceCandidates)
    ) {
      acceptedInheritanceThemeIds.add(themeId)
    }
  }

  return candidates.filter((candidate) => {
    if (candidate.source !== "inheritance") return true
    return acceptedInheritanceThemeIds.has(candidate.theme_id)
  })
}

function buildThemeRelationships(input: {
  candidates: ThemeLinkCandidate[]
  themes: CasePackTheme[]
  evidenceType: FidrecEvidenceType
}): Array<Omit<EvidenceThemeRelationship, "ownership" | "supports_coverage">> {
  const themesById = new Map(input.themes.map((theme) => [theme.theme_id, theme]))
  const grouped = groupCandidatesByTheme(input.candidates)
  const relationships: Array<Omit<EvidenceThemeRelationship, "ownership" | "supports_coverage">> = []

  for (const [themeId, themeCandidates] of grouped) {
    const theme = themesById.get(themeId)
    if (!theme) continue

    const sources = [...new Set(themeCandidates.map((candidate) => candidate.source))]
    const keywordReason =
      themeCandidates
        .map((candidate) => extractKeywordReason(candidate.reason))
        .find((reason): reason is string => Boolean(reason)) ?? null

    const relationshipStrength = resolveRelationshipStrength({
      evidenceType: input.evidenceType,
      theme,
      sources,
      keywordReason,
    })

    relationships.push({
      theme_id: themeId,
      theme_title: theme.theme_title,
      relationship_strength: relationshipStrength,
      link_reasons: uniqueStrings(themeCandidates.map((candidate) => candidate.reason)),
    })
  }

  return relationships.sort((left, right) => left.theme_title.localeCompare(right.theme_title))
}

function matchAssertionsBySourceDocument(
  caseDocumentId: string,
  assertions: CaseBankAssertionRow[],
): { assertionIds: string[]; reasons: string[] } {
  const assertionIds = assertions
    .filter((assertion) => assertion.source_document_id === caseDocumentId)
    .map((assertion) => assertion.id)

  if (!assertionIds.length) {
    return { assertionIds: [], reasons: [] }
  }

  return {
    assertionIds,
    reasons: assertionIds.map(() => "source document match"),
  }
}

export function buildEvidenceLinks(input: BuildEvidenceLinksInput): EvidenceLinkResult {
  const evidenceCorpus = buildEvidenceCorpus(input)
  const excludedType = detectExcludedEvidenceType(evidenceCorpus)
  const effectiveEvidenceType = excludedType ?? input.evidenceLabel.evidence_type
  const supportsCoverage = !isExcludedFromCoverage(effectiveEvidenceType, input.manualCoverageOverride)

  const keywordFindings = matchFindingsByKeywords(evidenceCorpus, input.findings)
  const overlapFindings = matchFindingsByOverlap(evidenceCorpus, input.findings)

  const linkedFindingIds = uniqueStrings([
    ...(input.existingLinkedFindingIds ?? []),
    ...keywordFindings.findingIds,
    ...overlapFindings.findingIds,
  ])

  const rawThemeCandidates: ThemeLinkCandidate[] = supportsCoverage
    ? [
        ...inheritThemesFromFindings(
          linkedFindingIds,
          input.themeLinks,
          input.findings,
          evidenceCorpus,
        ),
        ...matchThemesByKeywords(evidenceCorpus, input.themes),
        ...matchThemesByEvidenceType(effectiveEvidenceType, input.themes),
        ...matchThemesByOverlap(evidenceCorpus, input.themes),
      ]
    : []

  const filteredThemeCandidates = filterInheritanceCandidates(rawThemeCandidates)
  const rawThemeRelationships = supportsCoverage
    ? buildThemeRelationships({
        candidates: filteredThemeCandidates,
        themes: input.themes,
        evidenceType: effectiveEvidenceType,
      })
    : []
  const themeRelationships = supportsCoverage
    ? assignThemeOwnership({
        relationships: rawThemeRelationships,
        candidates: filteredThemeCandidates,
        evidenceCorpus,
        itemSupportsCoverage: supportsCoverage,
      })
    : []

  const linkedThemeIds = uniqueStrings(themeRelationships.map((relationship) => relationship.theme_id))

  const sourceAssertions = matchAssertionsBySourceDocument(
    input.evidenceLabel.case_document_id,
    input.assertions,
  )

  const linkedAssertionIds = uniqueStrings([
    ...(input.existingLinkedAssertionIds ?? []),
    ...sourceAssertions.assertionIds,
  ])

  const linkReasons = uniqueStrings([
    ...keywordFindings.reasons,
    ...overlapFindings.reasons,
    ...filteredThemeCandidates.map((candidate) => candidate.reason),
    ...sourceAssertions.reasons,
    ...(excludedType ? [`excluded evidence type: ${excludedType}`] : []),
    ...(!supportsCoverage ? ["excluded from theme coverage"] : []),
  ])

  return {
    linked_theme_ids: linkedThemeIds,
    linked_finding_ids: linkedFindingIds,
    linked_assertion_ids: linkedAssertionIds,
    link_reasons: linkReasons,
    theme_relationships: themeRelationships,
    supports_coverage: supportsCoverage,
    excluded_evidence_type: excludedType,
  }
}
