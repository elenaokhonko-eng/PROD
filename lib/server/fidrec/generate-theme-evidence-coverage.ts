import { z } from "zod"

import { zodEnum } from "@/lib/server/fidrec/zod-enums"
import { loadOpenThemeContexts, type OpenThemeContext } from "@/lib/server/fidrec/load-open-theme-contexts"
import {
  retrieveThemeRegulatoryClauses,
  type RetrievedRegulatoryClause,
  type ThemeRegulatoryRetrievalResult,
} from "@/lib/server/fidrec/retrieve-theme-regulatory-clauses"
import { generateJson } from "@/lib/server/ai/generate-json"
import { logger } from "@/lib/logger"
import { createServiceClient } from "@/lib/supabase/service"

const log = logger.withContext({ module: "fidrec-generate-theme-evidence-coverage" })

const COVERAGE_STATUSES = ["complete", "partial", "missing"] as const
const COVERAGE_CONFIDENCE = ["high", "medium", "low"] as const

export type ParsedRegulatoryClause = {
  clause_id: string
  framework: string
  clause_number: string | null
  clause_title: string | null
  summary: string
  similarity: number
}

export type ThemeEvidenceCoverageItem = {
  framework: string
  clause_number: string | null
  clause_title: string | null
  expected_evidence: string[]
  evidence_available: string[]
  evidence_requested: string[]
  evidence_missing: string[]
  coverage_status: (typeof COVERAGE_STATUSES)[number]
  confidence: (typeof COVERAGE_CONFIDENCE)[number]
}

export type ThemeEvidenceCoverageResult = {
  theme_id: string
  theme_title: string
  theme_type: string
  investigation_issue: string | null
  coverage_items: ThemeEvidenceCoverageItem[]
}

export type GenerateThemeEvidenceCoverageInput = {
  caseId: string
  theme: OpenThemeContext["theme"]
  investigation_issue: string | null
  clauses: ParsedRegulatoryClause[]
  findings: OpenThemeContext["findings"]
  evidence_requests: Array<{
    id: string
    request_text: string
    request_reason: string | null
    evidence_category: string
    requested_from: string
    priority: string
  }>
}

export type GenerateCaseThemeEvidenceCoverageInput = {
  caseId: string
  retrievalResults?: ThemeRegulatoryRetrievalResult[]
}

const coverageItemSchema = z.object({
  clause_id: z.string().uuid(),
  expected_evidence: z.array(z.string().trim().min(1)).default([]),
  evidence_available: z.array(z.string().trim().min(1)).default([]),
  evidence_requested: z.array(z.string().trim().min(1)).default([]),
  evidence_missing: z.array(z.string().trim().min(1)).default([]),
  coverage_status: zodEnum(COVERAGE_STATUSES),
  confidence: zodEnum(COVERAGE_CONFIDENCE),
})

const coveragePayloadSchema = z.object({
  coverage_items: z.array(coverageItemSchema),
})

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function parseRegulatoryClauseMetadata(clause: RetrievedRegulatoryClause): ParsedRegulatoryClause {
  const framework =
    clause.document_regulator?.trim() ||
    clause.document_source?.trim() ||
    clause.document_title?.trim() ||
    "Regulatory"

  return {
    clause_id: clause.id,
    framework,
    clause_number: clause.clause_ref?.trim() || clause.source_ref?.trim() || null,
    clause_title: clause.title?.trim() || null,
    summary: clause.text_content.trim().slice(0, 500),
    similarity: clause.similarity,
  }
}

function buildCoveragePrompt(input: GenerateThemeEvidenceCoverageInput): string {
  return `You are building an evidence coverage matrix for a Singapore phishing-scam dispute investigation.

Task:
- For each regulatory clause provided, infer what practical evidence would normally help verify or demonstrate compliance with that clause in this case context.
- Compare expected evidence against linked findings (material already available) and open evidence requests (already requested).
- Assign each inferred expected evidence item to exactly one of: evidence_available, evidence_requested, or evidence_missing.
- Do NOT determine legal liability, fault, negligence, or regulatory breach.
- Do NOT apply SRF, UPG, or ABS.
- Only assess evidence completeness for investigation and disclosure purposes.

coverage_status rules:
- complete: all meaningful expected evidence is already available or requested
- partial: some expected evidence is available or requested, but gaps remain
- missing: little or none of the expected evidence is available or requested

confidence rules:
- high: clear overlap between findings/requests and expected evidence
- medium: partial or semantic overlap only
- low: weak or inferential overlap

Return JSON only in this exact shape:
{
  "coverage_items": [
    {
      "clause_id": "...",
      "expected_evidence": ["Authentication logs", "ACS logs"],
      "evidence_available": ["Token registration finding"],
      "evidence_requested": ["Authentication logs"],
      "evidence_missing": ["ACS challenge logs", "Device binding records"],
      "coverage_status": "partial",
      "confidence": "high"
    }
  ]
}

Theme:
${JSON.stringify(
  {
    theme_id: input.theme.id,
    theme_title: input.theme.theme_title,
    theme_type: input.theme.theme_type,
    theme_summary: input.theme.theme_summary,
    investigation_issue: input.investigation_issue,
  },
  null,
  2,
)}

Regulatory clauses:
${JSON.stringify(input.clauses, null, 2)}

Linked findings:
${JSON.stringify(
  input.findings.map((finding) => ({
    finding_type: finding.finding_type,
    finding_text: finding.finding_text,
    supporting_evidence: finding.supporting_evidence,
    missing_information: finding.missing_information,
  })),
  null,
  2,
)}

Open evidence requests:
${JSON.stringify(
  input.evidence_requests.map((request) => ({
    request_text: request.request_text,
    request_reason: request.request_reason,
    evidence_category: request.evidence_category,
    requested_from: request.requested_from,
    priority: request.priority,
  })),
  null,
  2,
)}

JSON Output:`
}

function mergeCoverageItem(
  parsed: z.infer<typeof coverageItemSchema>,
  clause: ParsedRegulatoryClause,
): ThemeEvidenceCoverageItem {
  return {
    framework: clause.framework,
    clause_number: clause.clause_number,
    clause_title: clause.clause_title,
    expected_evidence: uniqueStrings(parsed.expected_evidence),
    evidence_available: uniqueStrings(parsed.evidence_available),
    evidence_requested: uniqueStrings(parsed.evidence_requested),
    evidence_missing: uniqueStrings(parsed.evidence_missing),
    coverage_status: parsed.coverage_status,
    confidence: parsed.confidence,
  }
}

function defaultMissingCoverageItem(clause: ParsedRegulatoryClause): ThemeEvidenceCoverageItem {
  return {
    framework: clause.framework,
    clause_number: clause.clause_number,
    clause_title: clause.clause_title,
    expected_evidence: [],
    evidence_available: [],
    evidence_requested: [],
    evidence_missing: [],
    coverage_status: "missing",
    confidence: "low",
  }
}

export async function generateThemeEvidenceCoverage(
  input: GenerateThemeEvidenceCoverageInput,
): Promise<ThemeEvidenceCoverageResult> {
  if (input.clauses.length === 0) {
    return {
      theme_id: input.theme.id,
      theme_title: input.theme.theme_title,
      theme_type: input.theme.theme_type,
      investigation_issue: input.investigation_issue,
      coverage_items: [],
    }
  }

  const parsedJson = await generateJson({
    prompt: buildCoveragePrompt(input),
    schemaName: "theme regulatory evidence coverage",
  })

  const parsed = coveragePayloadSchema.parse(parsedJson)
  const clauseById = new Map(input.clauses.map((clause) => [clause.clause_id, clause]))
  const parsedByClauseId = new Map(parsed.coverage_items.map((item) => [item.clause_id, item]))

  const coverageItems = input.clauses.map((clause) => {
    const modelItem = parsedByClauseId.get(clause.clause_id)
    if (!modelItem) {
      log.warn("Coverage model omitted clause; defaulting to missing", {
        caseId: input.caseId,
        themeId: input.theme.id,
        clauseId: clause.clause_id,
      })
      return defaultMissingCoverageItem(clause)
    }
    return mergeCoverageItem(modelItem, clause)
  })

  log.info("Generated theme regulatory evidence coverage", {
    caseId: input.caseId,
    themeId: input.theme.id,
    themeTitle: input.theme.theme_title,
    clauseCount: input.clauses.length,
    coverageItemCount: coverageItems.length,
  })

  return {
    theme_id: input.theme.id,
    theme_title: input.theme.theme_title,
    theme_type: input.theme.theme_type,
    investigation_issue: input.investigation_issue,
    coverage_items: coverageItems,
  }
}

function extractThemeId(rawModelOutput: unknown): string | null {
  if (!rawModelOutput || typeof rawModelOutput !== "object") return null
  const themeId = (rawModelOutput as Record<string, unknown>).source_theme_id
  return typeof themeId === "string" && themeId.trim() ? themeId.trim() : null
}

async function loadThemeLinkedEvidenceRequests(caseId: string): Promise<{
  evidenceRequestsByThemeId: Map<
    string,
    GenerateThemeEvidenceCoverageInput["evidence_requests"]
  >
}> {
  const supabase = createServiceClient()

  const [themeContexts, evidenceRequestsResult, questionsResult] = await Promise.all([
    loadOpenThemeContexts(caseId),
    supabase
      .from("case_evidence_requests")
      .select("id, request_text, request_reason, evidence_category, requested_from, priority, source_question_id")
      .eq("case_id", caseId)
      .eq("status", "open")
      .order("created_at", { ascending: true }),
    supabase
      .from("case_investigation_questions")
      .select("id, raw_model_output")
      .eq("case_id", caseId)
      .eq("status", "open"),
  ])

  if (evidenceRequestsResult.error) {
    throw new Error(`Failed to load case_evidence_requests for coverage: ${evidenceRequestsResult.error.message}`)
  }
  if (questionsResult.error) {
    throw new Error(
      `Failed to load case_investigation_questions for coverage: ${questionsResult.error.message}`,
    )
  }

  const questionThemeById = new Map<string, string>()
  for (const question of questionsResult.data ?? []) {
    const themeId = extractThemeId(question.raw_model_output)
    if (themeId) {
      questionThemeById.set(question.id, themeId)
    }
  }

  const evidenceRequestsByThemeId = new Map<
    string,
    GenerateThemeEvidenceCoverageInput["evidence_requests"]
  >()

  for (const context of themeContexts) {
    evidenceRequestsByThemeId.set(
      context.theme.id,
      context.evidenceRequests.map((request) => ({
        id: request.id,
        request_text: request.request_text,
        request_reason: null,
        evidence_category: request.evidence_category,
        requested_from: request.requested_from,
        priority: request.priority,
      })),
    )
  }

  for (const request of evidenceRequestsResult.data ?? []) {
    if (!request.source_question_id) continue
    const themeId = questionThemeById.get(request.source_question_id)
    if (!themeId) continue

    const existing = evidenceRequestsByThemeId.get(themeId) ?? []
    if (existing.some((item) => item.id === request.id)) continue

    existing.push({
      id: request.id,
      request_text: request.request_text,
      request_reason: request.request_reason,
      evidence_category: request.evidence_category,
      requested_from: request.requested_from,
      priority: request.priority,
    })
    evidenceRequestsByThemeId.set(themeId, existing)
  }

  return { evidenceRequestsByThemeId }
}

export async function generateCaseThemeEvidenceCoverage(
  input: GenerateCaseThemeEvidenceCoverageInput,
): Promise<ThemeEvidenceCoverageResult[]> {
  const retrievalResults =
    input.retrievalResults ?? (await retrieveThemeRegulatoryClauses({ caseId: input.caseId }))

  if (retrievalResults.length === 0) {
    log.info("No open themes for regulatory evidence coverage", { caseId: input.caseId })
    return []
  }

  const [themeContexts, evidenceRequestMaps] = await Promise.all([
    loadOpenThemeContexts(input.caseId),
    loadThemeLinkedEvidenceRequests(input.caseId),
  ])

  const themeContextById = new Map(themeContexts.map((context) => [context.theme.id, context]))
  const results: ThemeEvidenceCoverageResult[] = []

  for (const retrieval of retrievalResults) {
    const themeContext = themeContextById.get(retrieval.theme_id)
    if (!themeContext) continue

    const clauses = retrieval.clauses.map(parseRegulatoryClauseMetadata)
    const evidenceRequests = evidenceRequestMaps.evidenceRequestsByThemeId.get(retrieval.theme_id) ?? []

    try {
      results.push(
        await generateThemeEvidenceCoverage({
          caseId: input.caseId,
          theme: themeContext.theme,
          investigation_issue: retrieval.investigation_issue,
          clauses,
          findings: themeContext.findings,
          evidence_requests: evidenceRequests,
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn("Theme evidence coverage generation failed; using empty coverage items", {
        caseId: input.caseId,
        themeId: retrieval.theme_id,
        error: message,
      })
      results.push({
        theme_id: retrieval.theme_id,
        theme_title: retrieval.theme_title,
        theme_type: retrieval.theme_type,
        investigation_issue: retrieval.investigation_issue,
        coverage_items: clauses.map(defaultMissingCoverageItem),
      })
    }
  }

  return results
}
