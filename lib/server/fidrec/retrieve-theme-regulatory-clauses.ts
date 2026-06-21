import { generateEmbedding, toVectorLiteral } from "@/lib/server/ai/generate-embedding"
import { loadOpenThemeContexts, type OpenThemeContext } from "@/lib/server/fidrec/load-open-theme-contexts"
import { logger } from "@/lib/logger"
import { createServiceClient } from "@/lib/supabase/service"

const log = logger.withContext({ module: "fidrec-retrieve-theme-regulatory-clauses" })

const DEFAULT_MATCH_COUNT = 5
const DEFAULT_SIMILARITY_THRESHOLD = 0.12

type RpcClauseMatch = {
  id: string
  document_id: string
  clause_ref: string | null
  clause_type: string | null
  title: string | null
  text_content: string
  source_ref: string | null
  similarity: number
}

type RegulatoryDocumentRow = {
  id: string
  regulator: string | null
  source: string | null
  document_title: string
  jurisdiction: string | null
}

export type RetrievedRegulatoryClause = {
  id: string
  document_id: string
  clause_ref: string | null
  clause_type: string | null
  title: string | null
  text_content: string
  source_ref: string | null
  similarity: number
  document_regulator: string | null
  document_source: string | null
  document_title: string | null
  display_label: string
}

export type ThemeRegulatoryRetrievalResult = {
  theme_id: string
  theme_title: string
  theme_type: string
  retrieval_query: string
  investigation_issue: string | null
  clauses: RetrievedRegulatoryClause[]
}

export type RetrieveThemeRegulatoryClausesInput = {
  caseId: string
  matchCount?: number
  similarityThreshold?: number
}

function extractInvestigationIssue(rawModelOutput: unknown): string | null {
  if (!rawModelOutput || typeof rawModelOutput !== "object") return null
  const investigationIssue = (rawModelOutput as Record<string, unknown>).investigation_issue
  if (!investigationIssue || typeof investigationIssue !== "object") return null
  const issueText = (investigationIssue as Record<string, unknown>).issue_text
  return typeof issueText === "string" && issueText.trim() ? issueText.trim() : null
}

function extractThemeId(rawModelOutput: unknown): string | null {
  if (!rawModelOutput || typeof rawModelOutput !== "object") return null
  const themeId = (rawModelOutput as Record<string, unknown>).source_theme_id
  return typeof themeId === "string" && themeId.trim() ? themeId.trim() : null
}

export function buildThemeRegulatoryRetrievalQuery(input: {
  theme_title: string
  theme_summary: string | null
  theme_type: string
  investigation_issue: string | null
  linked_findings: Array<{ finding_text: string; finding_type: string }>
}): string {
  const findingLines = input.linked_findings.map(
    (finding) => `- [${finding.finding_type}] ${finding.finding_text.trim()}`,
  )

  return [
    `THEME: ${input.theme_title.trim()}`,
    `THEME_TYPE: ${input.theme_type.trim()}`,
    `THEME_SUMMARY: ${input.theme_summary?.trim() || "null"}`,
    "",
    "INVESTIGATION_ISSUE:",
    input.investigation_issue?.trim() || "null",
    "",
    "LINKED_FINDINGS:",
    findingLines.length ? findingLines.join("\n") : "- (none)",
  ].join("\n")
}

function buildClauseDisplayLabel(
  clause: RpcClauseMatch,
  document: RegulatoryDocumentRow | undefined,
): string {
  const frameworkLabel =
    document?.regulator?.trim() ||
    document?.source?.trim() ||
    document?.document_title?.trim() ||
    "Regulatory"

  const clauseLabel =
    clause.clause_ref?.trim() ||
    clause.title?.trim() ||
    clause.text_content.trim().slice(0, 120)

  return `${frameworkLabel} — ${clauseLabel}`
}

async function loadInvestigationIssuesByThemeId(caseId: string): Promise<Map<string, string>> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("case_investigation_questions")
    .select("raw_model_output")
    .eq("case_id", caseId)
    .eq("status", "open")

  if (error) {
    throw new Error(`Failed to load case_investigation_questions for theme retrieval: ${error.message}`)
  }

  const issuesByThemeId = new Map<string, string>()
  for (const row of data ?? []) {
    const themeId = extractThemeId(row.raw_model_output)
    const issueText = extractInvestigationIssue(row.raw_model_output)
    if (!themeId || !issueText || issuesByThemeId.has(themeId)) continue
    issuesByThemeId.set(themeId, issueText)
  }

  return issuesByThemeId
}

async function hydrateClauseMatches(matches: RpcClauseMatch[]): Promise<RetrievedRegulatoryClause[]> {
  if (!matches.length) return []

  const supabase = createServiceClient()
  const documentIds = [...new Set(matches.map((match) => match.document_id))]

  const { data: documents, error } = await supabase
    .from("regulatory_documents")
    .select("id, regulator, source, document_title, jurisdiction")
    .in("id", documentIds)

  if (error) {
    throw new Error(`Failed to load regulatory_documents for theme retrieval: ${error.message}`)
  }

  const documentById = new Map((documents ?? []).map((document) => [document.id, document as RegulatoryDocumentRow]))

  return matches.map((match) => {
    const document = documentById.get(match.document_id)
    return {
      id: match.id,
      document_id: match.document_id,
      clause_ref: match.clause_ref,
      clause_type: match.clause_type,
      title: match.title,
      text_content: match.text_content,
      source_ref: match.source_ref,
      similarity: match.similarity,
      document_regulator: document?.regulator ?? null,
      document_source: document?.source ?? null,
      document_title: document?.document_title ?? null,
      display_label: buildClauseDisplayLabel(match, document),
    }
  })
}

async function retrieveClausesForTheme(input: {
  caseId: string
  themeContext: OpenThemeContext
  investigationIssue: string | null
  matchCount: number
  similarityThreshold: number
}): Promise<ThemeRegulatoryRetrievalResult> {
  const retrievalQuery = buildThemeRegulatoryRetrievalQuery({
    theme_title: input.themeContext.theme.theme_title,
    theme_summary: input.themeContext.theme.theme_summary,
    theme_type: input.themeContext.theme.theme_type,
    investigation_issue: input.investigationIssue,
    linked_findings: input.themeContext.findings.map((finding) => ({
      finding_text: finding.finding_text,
      finding_type: finding.finding_type,
    })),
  })

  const embedding = await generateEmbedding(retrievalQuery)
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc("match_regulatory_clauses_threshold", {
    query_embedding: toVectorLiteral(embedding),
    match_count: input.matchCount,
    similarity_threshold: input.similarityThreshold,
  })

  if (error) {
    throw new Error(
      `match_regulatory_clauses_threshold RPC failed for theme ${input.themeContext.theme.id}: ${error.message}`,
    )
  }

  const clauses = await hydrateClauseMatches((data ?? []) as RpcClauseMatch[])

  log.info("Retrieved regulatory clauses for theme", {
    caseId: input.caseId,
    themeId: input.themeContext.theme.id,
    themeTitle: input.themeContext.theme.theme_title,
    matchCount: clauses.length,
    similarityThreshold: input.similarityThreshold,
  })

  return {
    theme_id: input.themeContext.theme.id,
    theme_title: input.themeContext.theme.theme_title,
    theme_type: input.themeContext.theme.theme_type,
    retrieval_query: retrievalQuery,
    investigation_issue: input.investigationIssue,
    clauses,
  }
}

export async function retrieveThemeRegulatoryClauses(
  input: RetrieveThemeRegulatoryClausesInput,
): Promise<ThemeRegulatoryRetrievalResult[]> {
  const matchCount = input.matchCount ?? DEFAULT_MATCH_COUNT
  const similarityThreshold = input.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD

  const [themeContexts, investigationIssuesByThemeId] = await Promise.all([
    loadOpenThemeContexts(input.caseId),
    loadInvestigationIssuesByThemeId(input.caseId),
  ])

  if (themeContexts.length === 0) {
    log.info("No open case themes found for regulatory clause retrieval", { caseId: input.caseId })
    return []
  }

  const results: ThemeRegulatoryRetrievalResult[] = []
  for (const themeContext of themeContexts) {
    results.push(
      await retrieveClausesForTheme({
        caseId: input.caseId,
        themeContext,
        investigationIssue: investigationIssuesByThemeId.get(themeContext.theme.id) ?? null,
        matchCount,
        similarityThreshold,
      }),
    )
  }

  return results
}
