import {
  buildEvidenceCoverageMatrix,
  buildEvidenceReviewModel,
  loadDocumentPresentationById,
} from "@/lib/server/fidrec/build-evidence-review-model"
import { loadDocumentChunkTextByDocumentId } from "@/lib/server/fidrec/load-document-chunk-text"
import { buildFidrecSubmissionPack } from "@/lib/server/fidrec/build-fidrec-submission-pack"
import {
  buildThemeRegulatoryCitations,
  type RegulatoryCitationItem,
} from "@/lib/server/fidrec/build-theme-regulatory-citations"
import { generateEvidenceLabels, matchEvidenceLabelToRequest } from "@/lib/server/fidrec/generate-evidence-labels"
import { retrieveThemeRegulatoryClauses } from "@/lib/server/fidrec/retrieve-theme-regulatory-clauses"
import { createServiceClient } from "@/lib/supabase/service"
import type {
  CasePackAnnexurePlaceholder,
  CasePackAssertionSection,
  CasePackEvidenceRequestGroup,
  CasePackInvestigationQuestion,
  CasePackMaterialFinding,
  CasePackOutstandingEvidenceRequest,
  CasePackRegulatoryReference,
  CasePackRegulatoryReferenceGroup,
  CasePackTheme,
  CasePackThemeEvidenceRequest,
  FidrecCasePackGenerationResult,
  GenerateCasePackJsonInput,
} from "@/lib/types/fidrec-case-pack"
import type { EvidenceLabel } from "@/lib/types/fidrec-evidence-labels"
import type {
  AssertionFindingRelationship,
  CaseAssertionFindingLinkRow,
  CaseBankAssertionRow,
  CaseEvidenceRequestRow,
  CaseFindingRow,
  CaseInvestigationQuestionRow,
  CaseThemeRow,
  ThemePriority,
} from "@/lib/types/fidrec"

export const CASE_PACK_VERSION = "fidrec_case_pack_v1" as const

const UNLINKED_EVIDENCE_GROUP_TITLE = "Unlinked evidence requests"

const MATERIAL_RELATIONSHIPS = new Set<AssertionFindingRelationship>([
  "supports_bank_assertion",
  "requires_particulars",
  "partially_rebuts",
  "rebuts_bank_assertion",
])

const PRIORITY_ORDER: Record<ThemePriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function toAnnexureSource(requestedFrom: string): CasePackAnnexurePlaceholder["source"] {
  if (
    requestedFrom === "customer" ||
    requestedFrom === "bank" ||
    requestedFrom === "third_party" ||
    requestedFrom === "unknown"
  ) {
    return requestedFrom
  }
  return "unknown"
}

function getThemeIdFromRawOutput(rawModelOutput: Record<string, unknown> | null): string | null {
  const themeId = rawModelOutput?.source_theme_id
  return typeof themeId === "string" && themeId.trim() ? themeId.trim() : null
}

function getIssueTextFromQuestion(question: CaseInvestigationQuestionRow): string | null {
  const investigationIssue = question.raw_model_output?.investigation_issue
  if (!investigationIssue || typeof investigationIssue !== "object" || Array.isArray(investigationIssue)) {
    return null
  }

  const issueText = (investigationIssue as Record<string, unknown>).issue_text
  return typeof issueText === "string" && issueText.trim() ? issueText.trim() : null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === "string")
}

function mapRegulatoryReference(citation: RegulatoryCitationItem): CasePackRegulatoryReference {
  return {
    clause_id: citation.clause_id,
    document_name: citation.document_name,
    clause_number: citation.clause_number ?? "",
    clause_title: citation.clause_title ?? "",
    clause_summary: citation.clause_summary,
    similarity_score: citation.similarity_score,
  }
}

function sortThemes(themes: CaseThemeRow[]): CaseThemeRow[] {
  return themes.slice().sort((left, right) => {
    const leftPriority = PRIORITY_ORDER[left.priority] ?? 99
    const rightPriority = PRIORITY_ORDER[right.priority] ?? 99
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority
    }
    return left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1 : 0
  })
}

function resolveEvidenceRequestThemeId(
  request: CaseEvidenceRequestRow,
  questionsById: Map<string, CaseInvestigationQuestionRow>,
): string | null {
  const rawThemeId = getThemeIdFromRawOutput(request.raw_model_output)
  if (rawThemeId) {
    return rawThemeId
  }

  if (!request.source_question_id) {
    return null
  }

  const linkedQuestion = questionsById.get(request.source_question_id)
  return linkedQuestion ? getThemeIdFromRawOutput(linkedQuestion.raw_model_output) : null
}

function mapThemeEvidenceRequest(request: CaseEvidenceRequestRow): CasePackThemeEvidenceRequest {
  return {
    id: request.id,
    request_text: request.request_text,
    evidence_category: request.evidence_category,
    requested_from: request.requested_from,
    priority: request.priority,
    status: request.status,
  }
}

function mapOutstandingEvidenceRequest(request: CaseEvidenceRequestRow): CasePackOutstandingEvidenceRequest {
  return {
    id: request.id,
    request_text: request.request_text,
    request_reason: request.request_reason,
    evidence_category: request.evidence_category,
    requested_from: request.requested_from,
    priority: request.priority,
    status: request.status,
    suggested_file_types: toStringArray(request.suggested_file_types),
    example_documents: toStringArray(request.example_documents),
  }
}

function buildAnnexureTitle(request: CaseEvidenceRequestRow): string {
  const trimmed = request.request_text.trim()
  if (!trimmed) {
    return request.evidence_category.replaceAll("_", " ")
  }

  const firstSentence = trimmed.split(/[.!?]/)[0]?.trim()
  const candidate = firstSentence && firstSentence.length >= 12 ? firstSentence : trimmed
  return candidate.length > 80 ? `${candidate.slice(0, 77).trim()}...` : candidate
}

function buildAnnexureLabel(index: number): string {
  return `A${index + 1}`
}

function buildKeyThemes(input: {
  openThemes: CaseThemeRow[]
  openQuestions: CaseInvestigationQuestionRow[]
  openEvidenceRequests: CaseEvidenceRequestRow[]
  citationsByThemeId: Map<string, CasePackRegulatoryReference[]>
}): CasePackTheme[] {
  const { openThemes, openQuestions, openEvidenceRequests, citationsByThemeId } = input
  const questionsById = new Map(openQuestions.map((question) => [question.id, question]))

  return openThemes.map((theme) => {
    const themeQuestions = openQuestions
      .filter((question) => getThemeIdFromRawOutput(question.raw_model_output) === theme.id)
      .sort((left, right) => (left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1 : 0))

    const primaryQuestion = themeQuestions[0] ?? null
    const themeQuestionIds = new Set(themeQuestions.map((question) => question.id))

    const themeEvidenceRequests = openEvidenceRequests
      .filter((request) => {
        if (request.source_question_id && themeQuestionIds.has(request.source_question_id)) {
          return true
        }
        return resolveEvidenceRequestThemeId(request, questionsById) === theme.id
      })
      .sort((left, right) => (left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1 : 0))
      .map(mapThemeEvidenceRequest)

    let investigationQuestion: CasePackInvestigationQuestion | null = null
    if (primaryQuestion) {
      investigationQuestion = {
        id: primaryQuestion.id,
        question_text: primaryQuestion.question_text,
        priority: primaryQuestion.priority,
      }
    }

    return {
      theme_id: theme.id,
      theme_title: theme.theme_title,
      theme_type: theme.theme_type,
      priority: theme.priority,
      theme_summary: theme.theme_summary,
      issue: primaryQuestion ? getIssueTextFromQuestion(primaryQuestion) : null,
      investigation_question: investigationQuestion,
      evidence_requests: themeEvidenceRequests,
      regulatory_references: citationsByThemeId.get(theme.id) ?? [],
    }
  })
}

function buildAssertionSections(input: {
  assertions: CaseBankAssertionRow[]
  links: CaseAssertionFindingLinkRow[]
  findingsById: Map<string, CaseFindingRow>
}): CasePackAssertionSection[] {
  const { assertions, links, findingsById } = input

  return assertions.map((assertion) => {
    const materialFindings: CasePackMaterialFinding[] = links
      .filter(
        (link) =>
          link.bank_assertion_id === assertion.id && MATERIAL_RELATIONSHIPS.has(link.relationship),
      )
      .map((link) => {
        const finding = findingsById.get(link.finding_id)
        return {
          finding_id: link.finding_id,
          finding_text: finding?.finding_text ?? "",
          finding_type: finding?.finding_type ?? "",
          relationship: link.relationship,
          confidence: link.confidence,
          explanation: link.explanation ?? "",
        }
      })

    return {
      assertion_id: assertion.id,
      assertion_text: assertion.assertion_text,
      assertion_type: assertion.assertion_type,
      bank_conclusion_supported: assertion.bank_conclusion_supported,
      material_findings: materialFindings,
    }
  })
}

function buildOutstandingEvidenceRequestGroups(input: {
  openThemes: CaseThemeRow[]
  openEvidenceRequests: CaseEvidenceRequestRow[]
  openQuestions: CaseInvestigationQuestionRow[]
}): CasePackEvidenceRequestGroup[] {
  const { openThemes, openEvidenceRequests, openQuestions } = input
  const questionsById = new Map(openQuestions.map((question) => [question.id, question]))
  const groupedRequestIds = new Set<string>()
  const groups: CasePackEvidenceRequestGroup[] = []

  for (const theme of openThemes) {
    const themeQuestions = openQuestions.filter(
      (question) => getThemeIdFromRawOutput(question.raw_model_output) === theme.id,
    )
    const themeQuestionIds = new Set(themeQuestions.map((question) => question.id))

    const requests = openEvidenceRequests
      .filter((request) => {
        if (groupedRequestIds.has(request.id)) {
          return false
        }
        if (request.source_question_id && themeQuestionIds.has(request.source_question_id)) {
          return true
        }
        return resolveEvidenceRequestThemeId(request, questionsById) === theme.id
      })
      .sort((left, right) => (left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1 : 0))
      .map((request) => {
        groupedRequestIds.add(request.id)
        return mapOutstandingEvidenceRequest(request)
      })

    groups.push({
      theme_id: theme.id,
      theme_title: theme.theme_title,
      requests,
    })
  }

  const unlinkedRequests = openEvidenceRequests
    .filter((request) => !groupedRequestIds.has(request.id))
    .sort((left, right) => (left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1 : 0))
    .map(mapOutstandingEvidenceRequest)

  if (unlinkedRequests.length) {
    groups.push({
      theme_id: null,
      theme_title: UNLINKED_EVIDENCE_GROUP_TITLE,
      requests: unlinkedRequests,
    })
  }

  return groups
}

function buildRegulatoryReferenceGroups(
  openThemes: CaseThemeRow[],
  citationsByThemeId: Map<string, CasePackRegulatoryReference[]>,
): CasePackRegulatoryReferenceGroup[] {
  return openThemes.map((theme) => ({
    theme_id: theme.id,
    theme_title: theme.theme_title,
    references: citationsByThemeId.get(theme.id) ?? [],
  }))
}

function buildAnnexurePlaceholders(input: {
  openEvidenceRequests: CaseEvidenceRequestRow[]
  openQuestions: CaseInvestigationQuestionRow[]
  evidenceLabels: EvidenceLabel[]
}): CasePackAnnexurePlaceholder[] {
  const { openEvidenceRequests, openQuestions, evidenceLabels } = input
  const questionsById = new Map(openQuestions.map((question) => [question.id, question]))
  const assignedDocumentIds = new Set<string>()

  return openEvidenceRequests
    .slice()
    .sort((left, right) => (left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1 : 0))
    .map((request, index) => {
      const matchedLabel = matchEvidenceLabelToRequest({
        evidenceLabels,
        request,
        assignedDocumentIds,
      })

      if (matchedLabel) {
        assignedDocumentIds.add(matchedLabel.case_document_id)
      }

      return {
        annexure_label: buildAnnexureLabel(index),
        evidence_label: matchedLabel?.label ?? null,
        title: buildAnnexureTitle(request),
        source: toAnnexureSource(request.requested_from),
        related_theme_id: resolveEvidenceRequestThemeId(request, questionsById),
        related_evidence_request_id: request.id,
        related_case_document_id: matchedLabel?.case_document_id ?? null,
        status: matchedLabel ? ("available" as const) : ("requested" as const),
      }
    })
}

export async function generateCasePackJson(
  input: GenerateCasePackJsonInput,
): Promise<FidrecCasePackGenerationResult> {
  const supabase = createServiceClient()

  const [
    themesResult,
    assertionsResult,
    findingsResult,
    linksResult,
    questionsResult,
    evidenceRequestsResult,
    caseResult,
    extractRunResult,
  ] = await Promise.all([
    supabase
      .from("case_themes")
      .select(
        "id, case_id, theme_type, theme_title, theme_summary, priority, status, raw_model_output, created_at, updated_at",
      )
      .eq("case_id", input.caseId)
      .order("created_at", { ascending: true }),
    supabase
      .from("case_bank_assertions")
      .select(
        "id, case_id, source_document_id, assertion_text, assertion_type, bank_conclusion_supported, particulars_needed, evidence_needed, raw_model_output, created_at, updated_at",
      )
      .eq("case_id", input.caseId)
      .order("created_at", { ascending: true }),
    supabase
      .from("case_findings")
      .select(
        "id, case_id, finding_text, finding_type, supporting_evidence, confidence, missing_information, human_review_required, raw_model_output, created_at, updated_at",
      )
      .eq("case_id", input.caseId)
      .order("created_at", { ascending: true }),
    supabase
      .from("case_assertion_finding_links")
      .select(
        "id, case_id, bank_assertion_id, finding_id, relationship, explanation, confidence, next_question, created_at, updated_at",
      )
      .eq("case_id", input.caseId)
      .order("created_at", { ascending: true }),
    supabase
      .from("case_investigation_questions")
      .select(
        "id, case_id, source_assertion_id, source_finding_id, source_link_id, question_text, question_type, priority, status, evidence_requested, answer, raw_model_output, created_at, updated_at",
      )
      .eq("case_id", input.caseId)
      .order("created_at", { ascending: true }),
    supabase
      .from("case_evidence_requests")
      .select(
        "id, case_id, source_question_id, source_assertion_id, source_finding_id, source_link_id, request_text, request_reason, evidence_category, requested_from, priority, status, suggested_file_types, example_documents, raw_model_output, created_at, updated_at",
      )
      .eq("case_id", input.caseId)
      .order("created_at", { ascending: true }),
    supabase
      .from("cases")
      .select("claim_amount, claim_currency, institution_name, primary_narrative")
      .eq("id", input.caseId)
      .maybeSingle(),
    supabase
      .from("case_extract_runs")
      .select("extract_json")
      .eq("case_id", input.caseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (themesResult.error) {
    throw new Error(`Failed to load case_themes rows: ${themesResult.error.message}`)
  }
  if (assertionsResult.error) {
    throw new Error(`Failed to load case_bank_assertions rows: ${assertionsResult.error.message}`)
  }
  if (findingsResult.error) {
    throw new Error(`Failed to load case_findings rows: ${findingsResult.error.message}`)
  }
  if (linksResult.error) {
    throw new Error(`Failed to load case_assertion_finding_links rows: ${linksResult.error.message}`)
  }
  if (questionsResult.error) {
    throw new Error(`Failed to load case_investigation_questions rows: ${questionsResult.error.message}`)
  }
  if (evidenceRequestsResult.error) {
    throw new Error(`Failed to load case_evidence_requests rows: ${evidenceRequestsResult.error.message}`)
  }

  const themes = (themesResult.data ?? []) as CaseThemeRow[]
  const assertions = (assertionsResult.data ?? []) as CaseBankAssertionRow[]
  const findings = (findingsResult.data ?? []) as CaseFindingRow[]
  const links = (linksResult.data ?? []) as CaseAssertionFindingLinkRow[]
  const questions = (questionsResult.data ?? []) as CaseInvestigationQuestionRow[]
  const evidenceRequests = (evidenceRequestsResult.data ?? []) as CaseEvidenceRequestRow[]

  const openThemes = sortThemes(themes.filter((theme) => theme.status === "open"))
  const openQuestions = questions.filter((question) => question.status === "open")
  const openEvidenceRequests = evidenceRequests.filter((request) => request.status === "open")
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]))

  const themeRegulatoryRetrieval = await retrieveThemeRegulatoryClauses({ caseId: input.caseId })
  const themeRegulatoryCitations = buildThemeRegulatoryCitations(themeRegulatoryRetrieval)
  const citationsByThemeId = new Map(
    themeRegulatoryCitations.map((themeCitation) => [
      themeCitation.theme_id,
      themeCitation.citations.map(mapRegulatoryReference),
    ]),
  )

  const { evidence_labels: evidenceLabels } = await generateEvidenceLabels({ caseId: input.caseId })

  const annexurePlaceholders = buildAnnexurePlaceholders({
    openEvidenceRequests,
    openQuestions,
    evidenceLabels,
  })

  const keyThemes = buildKeyThemes({
    openThemes,
    openQuestions,
    openEvidenceRequests,
    citationsByThemeId,
  })

  const evidenceReviewModel = await buildEvidenceReviewModel({
    caseId: input.caseId,
    evidenceLabels,
    keyThemes,
    annexurePlaceholders,
    assertions,
    findings,
    questions,
    evidenceRequests,
  })

  const evidenceCoverageMatrix = buildEvidenceCoverageMatrix({
    keyThemes,
    evidenceReviewModel,
  })

  const outstandingEvidenceRequests = buildOutstandingEvidenceRequestGroups({
    openThemes,
    openEvidenceRequests,
    openQuestions,
  })

  const evidenceRequestsByThemeId = new Map<string, string[]>()
  for (const group of outstandingEvidenceRequests) {
    if (!group.theme_id) continue
    evidenceRequestsByThemeId.set(
      group.theme_id,
      group.requests.map((request) => request.request_text),
    )
  }

  const dedupedRegulatoryReferences = openThemes.flatMap(
    (theme) => citationsByThemeId.get(theme.id) ?? [],
  )

  const documentIds = evidenceLabels.map((label) => label.case_document_id)
  const documentPresentationById = await loadDocumentPresentationById(input.caseId, documentIds)
  const documentChunkTextById = await loadDocumentChunkTextByDocumentId(input.caseId, documentIds)

  const extractJson =
    extractRunResult.data?.extract_json &&
    typeof extractRunResult.data.extract_json === "object" &&
    !Array.isArray(extractRunResult.data.extract_json)
      ? (extractRunResult.data.extract_json as Record<string, unknown>)
      : null

  const submissionPackResult = buildFidrecSubmissionPack({
    caseId: input.caseId,
    findings,
    assertions,
    links,
    keyThemes,
    openEvidenceRequests,
    evidenceRequestsByThemeId,
    evidenceLabels,
    evidenceReviewModel,
    regulatoryReferences: dedupedRegulatoryReferences,
    documentPresentationById,
    documentChunkTextById,
    extractJson,
    claimAmount: caseResult.data?.claim_amount ?? null,
    claimCurrency: caseResult.data?.claim_currency ?? null,
    institutionName: caseResult.data?.institution_name ?? null,
    customerName: null,
    primaryNarrative: caseResult.data?.primary_narrative ?? null,
  })

  return {
    submission_pack: submissionPackResult.pack,
    internal_debug: {
      pack_version: CASE_PACK_VERSION,
      key_themes: keyThemes,
      bank_assertions_and_material_findings: buildAssertionSections({
        assertions,
        links,
        findingsById,
      }),
      outstanding_evidence_requests: outstandingEvidenceRequests,
      relevant_regulatory_references: buildRegulatoryReferenceGroups(openThemes, citationsByThemeId),
      evidence_labels: evidenceLabels,
      evidence_review_model: evidenceReviewModel,
      evidence_coverage_matrix: evidenceCoverageMatrix,
      annexure_placeholders: annexurePlaceholders,
      chronology_diagnostics: submissionPackResult.chronologyDiagnostics,
      bank_position_diagnostics: submissionPackResult.bankPositionDiagnostics,
      executive_summary_diagnostics: submissionPackResult.executiveSummaryDiagnostics,
      executive_summary_critical_fact_diagnostics:
        submissionPackResult.executiveSummaryCriticalFactDiagnostics,
      executive_summary_case_overview_diagnostics:
        submissionPackResult.executiveSummaryCaseOverviewDiagnostics,
    },
  }
}
