import type { ThemeRegulatoryRetrievalResult } from "@/lib/server/fidrec/retrieve-theme-regulatory-clauses"

const MAX_CITATIONS_PER_THEME = 5

export type RegulatoryCitationItem = {
  clause_id: string
  document_name: string
  clause_number: string | null
  clause_title: string | null
  clause_summary: string
  similarity_score: number
}

export type ThemeRegulatoryCitation = {
  theme_id: string
  theme_title: string
  citations: RegulatoryCitationItem[]
}

export type RegulatoryCitationReference = {
  clause_id: string
  document_name: string
  clause_number: string | null
}

type RegulatoryClauseCategory =
  | "definition"
  | "notification"
  | "authentication"
  | "incident_response"
  | "other"

const DIVERSITY_LIMITED_CATEGORIES = new Set<RegulatoryClauseCategory>([
  "definition",
  "notification",
  "authentication",
  "incident_response",
])

function buildDocumentName(clause: ThemeRegulatoryRetrievalResult["clauses"][number]): string {
  return (
    clause.document_title?.trim() ||
    clause.document_regulator?.trim() ||
    clause.document_source?.trim() ||
    "Regulatory"
  )
}

function classifyRegulatoryClause(clause: ThemeRegulatoryRetrievalResult["clauses"][number]): RegulatoryClauseCategory {
  const corpus = [clause.clause_type, clause.title, clause.text_content, clause.clause_ref]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (/\bdefinition\b|\bmeans\b|\bshall mean\b|\bdefined as\b/.test(corpus)) {
    return "definition"
  }
  if (/\bnotif|\balert\b|\bwarn\b|\bsms\b|\bemail\b/.test(corpus)) {
    return "notification"
  }
  if (/\bauthenticat|\b3ds\b|\b3d secure\b|\bverification\b|\botp\b|\btoken\b/.test(corpus)) {
    return "authentication"
  }
  if (/\bincident\b|\bresponse\b|\bcontain\b|\breporting duty\b|\bescalat/.test(corpus)) {
    return "incident_response"
  }

  return "other"
}

function applyRegulatoryDiversityFilter(
  clauses: ThemeRegulatoryRetrievalResult["clauses"],
): ThemeRegulatoryRetrievalResult["clauses"] {
  const sorted = clauses.slice().sort((left, right) => right.similarity - left.similarity)
  const selected: ThemeRegulatoryRetrievalResult["clauses"] = []
  const categoryCounts = new Map<RegulatoryClauseCategory, number>()

  for (const clause of sorted) {
    if (selected.length >= MAX_CITATIONS_PER_THEME) {
      break
    }

    const category = classifyRegulatoryClause(clause)
    const currentCount = categoryCounts.get(category) ?? 0

    if (DIVERSITY_LIMITED_CATEGORIES.has(category) && currentCount >= 1) {
      continue
    }

    selected.push(clause)
    categoryCounts.set(category, currentCount + 1)
  }

  return selected
}

export function toRegulatoryCitationReferences(
  citations: RegulatoryCitationItem[],
): RegulatoryCitationReference[] {
  return citations.map((citation) => ({
    clause_id: citation.clause_id,
    document_name: citation.document_name,
    clause_number: citation.clause_number,
  }))
}

export function buildCitationsByThemeId(
  themeCitations: ThemeRegulatoryCitation[],
): Map<string, RegulatoryCitationReference[]> {
  return new Map(
    themeCitations.map((theme) => [theme.theme_id, toRegulatoryCitationReferences(theme.citations)]),
  )
}

export function buildThemeRegulatoryCitations(
  themeRetrievalResults: ThemeRegulatoryRetrievalResult[],
): ThemeRegulatoryCitation[] {
  return themeRetrievalResults.map((result) => {
    const diverseClauses = applyRegulatoryDiversityFilter(result.clauses)

    return {
      theme_id: result.theme_id,
      theme_title: result.theme_title,
      citations: diverseClauses.map((clause) => ({
        clause_id: clause.id,
        document_name: buildDocumentName(clause),
        clause_number: clause.clause_ref?.trim() || clause.source_ref?.trim() || null,
        clause_title: clause.title?.trim() || null,
        clause_summary: clause.text_content.trim().slice(0, 500),
        similarity_score: clause.similarity,
      })),
    }
  })
}
