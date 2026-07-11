import { z } from "zod"

import {
  type RegulatoryCitationReference,
} from "@/lib/server/fidrec/build-theme-regulatory-citations"
import { consolidateEvidenceRequests, type EvidenceRequestCandidate } from "@/lib/server/fidrec/consolidate-investigation-issues"
import { zodEnum } from "@/lib/server/fidrec/zod-enums"
import { generateJson, getOpenAiModel } from "@/lib/server/ai/generate-json"
import { sanitizeNullableSourceId } from "@/lib/server/fidrec/normalize-source-id"
import { logger } from "@/lib/logger"
import { createServiceClient } from "@/lib/supabase/service"
import type {
  CaseEvidenceRequestRow,
  EvidenceRequestCategory,
  EvidenceRequestPriority,
  EvidenceRequestRequestedFrom,
} from "@/lib/types/fidrec"

const modelName = getOpenAiModel()
const log = logger.withContext({ module: "fidrec-generate-evidence-requests", model: modelName })

const EVIDENCE_CATEGORIES: readonly EvidenceRequestCategory[] = [
  "bank_communication",
  "hotline_record",
  "transaction_record",
  "notification_record",
  "authentication_record",
  "device_or_ip_record",
  "police_or_statutory",
  "customer_context",
  "bank_particulars",
  "other",
] as const

const REQUESTED_FROM: readonly EvidenceRequestRequestedFrom[] = [
  "customer",
  "bank",
  "third_party",
  "unknown",
] as const

const PRIORITIES: readonly EvidenceRequestPriority[] = ["low", "medium", "high", "critical"] as const

const ALLOWED_EVIDENCE_CATEGORIES = new Set<string>(EVIDENCE_CATEGORIES)

const EVIDENCE_CATEGORY_ALIASES: Record<string, EvidenceRequestCategory> = {
  fraud_monitoring_record: "bank_particulars",
  fraud_monitoring: "bank_particulars",
  fraud_detection_log: "bank_particulars",
  fraud_detection_record: "bank_particulars",
  monitoring_log: "bank_particulars",
  containment_log: "bank_particulars",
  "3ds_log": "authentication_record",
  "3d_secure_log": "authentication_record",
  authentication_log: "authentication_record",
  auth_log: "authentication_record",
  token_record: "authentication_record",
  token_registration_record: "authentication_record",
  device_log: "device_or_ip_record",
  ip_log: "device_or_ip_record",
  device_fingerprint: "device_or_ip_record",
  wallet_device_record: "device_or_ip_record",
  transaction_log: "transaction_record",
  payment_log: "transaction_record",
  emv_log: "transaction_record",
  contactless_log: "transaction_record",
}

function normalizeEvidenceCategoryKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

function extractRegulatoryCitations(rawModelOutput: unknown): RegulatoryCitationReference[] {
  if (!rawModelOutput || typeof rawModelOutput !== "object" || Array.isArray(rawModelOutput)) {
    return []
  }

  const citations = (rawModelOutput as Record<string, unknown>).regulatory_citations
  if (!Array.isArray(citations)) {
    return []
  }

  return citations.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return []
    }

    const record = entry as Record<string, unknown>
    const clauseId = typeof record.clause_id === "string" ? record.clause_id.trim() : ""
    const documentName = typeof record.document_name === "string" ? record.document_name.trim() : ""
    if (!clauseId || !documentName) {
      return []
    }

    return [
      {
        clause_id: clauseId,
        document_name: documentName,
        clause_number:
          typeof record.clause_number === "string" && record.clause_number.trim()
            ? record.clause_number.trim()
            : null,
      },
    ]
  })
}

export function normalizeEvidenceCategory(value: unknown): EvidenceRequestCategory {
  if (typeof value !== "string" || !value.trim()) {
    return "other"
  }

  const key = normalizeEvidenceCategoryKey(value)
  if (ALLOWED_EVIDENCE_CATEGORIES.has(key)) {
    return key as EvidenceRequestCategory
  }

  return EVIDENCE_CATEGORY_ALIASES[key] ?? "other"
}

const evidenceRequestSchema = z.object({
  source_question_id: z.string().nullable().optional(),
  source_assertion_id: z.string().nullable().optional(),
  source_finding_id: z.string().nullable().optional(),
  source_link_id: z.string().nullable().optional(),
  request_text: z.string().trim().min(1, "request_text is required"),
  request_reason: z.string().trim().min(1).nullable().optional(),
  evidence_category: z.string(),
  requested_from: zodEnum(REQUESTED_FROM),
  priority: zodEnum(PRIORITIES).default("medium"),
  suggested_file_types: z.array(z.string().trim().min(1)).default([]),
  example_documents: z.array(z.string().trim().min(1)).default([]),
})

const evidenceRequestsPayloadSchema = z.object({
  evidence_requests: z.array(evidenceRequestSchema).min(1, "No evidence requests generated"),
})

export type GenerateAndPersistEvidenceRequestsInput = {
  caseId: string
}

export type GenerateAndPersistEvidenceRequestsResult = {
  evidence_requests: CaseEvidenceRequestRow[]
}

function buildEvidenceRequestsPrompt(
  questions: Array<{
    id: string
    question_text: string
    question_type: string
    priority: string
    evidence_requested: unknown
    source_assertion_id: string | null
    source_finding_id: string | null
    source_link_id: string | null
    source_theme_id: string | null
    source_theme_title: string | null
    issue_text: string | null
    source_assertion: Record<string, unknown> | null
    source_finding: Record<string, unknown> | null
    source_link: Record<string, unknown> | null
  }>,
): string {
  return `You are converting open investigation questions into practical evidence requests for a Singapore phishing-scam dispute case.

Task:
- Generate evidence requests only.
- Do not decide liability.
- Do not determine negligence.
- Do not apply SRF, UPG or ABS.
- Do not generate legal arguments.
- Use plain language.
- Requests should be practical and specific.
- Avoid duplicate requests.
- Requests may be consolidated in-memory after generation when they are semantically equivalent.
- Generate evidence requests only from the provided open investigation questions.
- Do not invent requests from irrelevant links or unrelated case context.
- When a question is theme-level, keep requests aligned to the theme issue rather than one isolated link.

Guidance for requested_from:
- If evidence is likely held by the bank, use "bank".
- If evidence is likely held by the customer, use "customer".
- If evidence may be held by police/telco/airline/merchant/etc, use "third_party".
- If unclear, use "unknown".

Allowed evidence_category values:
Use only these evidence_category values: bank_communication, hotline_record, transaction_record, notification_record, authentication_record, device_or_ip_record, police_or_statutory, customer_context, bank_particulars, other.
If unsure, use "other".

Allowed requested_from values:
- customer
- bank
- third_party
- unknown

Allowed priority values:
- low
- medium
- high
- critical

Return JSON only in this exact shape:
{
  "evidence_requests": [
    {
      "source_question_id": "...",
      "source_assertion_id": "...",
      "source_finding_id": "...",
      "source_link_id": "...",
      "request_text": "Please provide a hotline call log or call recording showing when the fraud was first reported.",
      "request_reason": "This helps establish the first fraud-report timestamp.",
      "evidence_category": "hotline_record",
      "requested_from": "customer",
      "priority": "high",
      "suggested_file_types": ["pdf", "png", "jpg", "mp3", "m4a"],
      "example_documents": ["hotline call log screenshot", "call recording", "bank acknowledgement email"]
    }
  ]
}

Open investigation questions with linked context:
${JSON.stringify(questions, null, 2)}

JSON Output:`
}

export async function generateAndPersistEvidenceRequests(
  input: GenerateAndPersistEvidenceRequestsInput,
): Promise<GenerateAndPersistEvidenceRequestsResult> {
  const supabase = createServiceClient()

  const { data: openQuestions, error: questionsError } = await supabase
    .from("case_investigation_questions")
    .select(
      "id, question_text, question_type, priority, evidence_requested, source_assertion_id, source_finding_id, source_link_id, raw_model_output, created_at",
    )
    .eq("case_id", input.caseId)
    .eq("status", "open")
    .order("created_at", { ascending: true })

  if (questionsError) {
    throw new Error(`Failed to load case_investigation_questions rows: ${questionsError.message}`)
  }

  if (!openQuestions?.length) {
    throw new Error("No open investigation questions found for this case")
  }

  const { data: caseLinks, error: caseLinksError } = await supabase
    .from("case_assertion_finding_links")
    .select("id, relationship")
    .eq("case_id", input.caseId)

  if (caseLinksError) {
    throw new Error(`Failed to load case_assertion_finding_links rows: ${caseLinksError.message}`)
  }

  const irrelevantLinkIds = new Set(
    (caseLinks ?? []).filter((link) => link.relationship === "irrelevant").map((link) => link.id),
  )
  const eligibleQuestions = openQuestions.filter(
    (question) => !question.source_link_id || !irrelevantLinkIds.has(question.source_link_id),
  )

  if (!eligibleQuestions.length) {
    throw new Error("No eligible open investigation questions found for this case")
  }

  const validQuestionIds = new Set(eligibleQuestions.map((question) => question.id))
  const questionCitationsById = new Map(
    eligibleQuestions.map((question) => [question.id, extractRegulatoryCitations(question.raw_model_output)]),
  )

  const [allAssertionsResult, allFindingsResult] = await Promise.all([
    supabase.from("case_bank_assertions").select("id").eq("case_id", input.caseId),
    supabase.from("case_findings").select("id").eq("case_id", input.caseId),
  ])

  if (allAssertionsResult.error) {
    throw new Error(`Failed to load case_bank_assertions ids: ${allAssertionsResult.error.message}`)
  }
  if (allFindingsResult.error) {
    throw new Error(`Failed to load case_findings ids: ${allFindingsResult.error.message}`)
  }

  const validAssertionIds = new Set((allAssertionsResult.data ?? []).map((row) => row.id))
  const validFindingIds = new Set((allFindingsResult.data ?? []).map((row) => row.id))
  const validLinkIds = new Set((caseLinks ?? []).map((row) => row.id))

  const assertionIds = [
    ...new Set(eligibleQuestions.map((q) => q.source_assertion_id).filter(Boolean)),
  ] as string[]
  const findingIds = [...new Set(eligibleQuestions.map((q) => q.source_finding_id).filter(Boolean))] as string[]
  const linkIds = [...new Set(eligibleQuestions.map((q) => q.source_link_id).filter(Boolean))] as string[]

  const [assertionsResult, findingsResult, linksResult] = await Promise.all([
    assertionIds.length
      ? supabase
          .from("case_bank_assertions")
          .select("id, assertion_text, assertion_type, particulars_needed, evidence_needed")
          .in("id", assertionIds)
      : Promise.resolve({ data: [], error: null }),
    findingIds.length
      ? supabase
          .from("case_findings")
          .select("id, finding_text, finding_type, supporting_evidence, missing_information")
          .in("id", findingIds)
      : Promise.resolve({ data: [], error: null }),
    linkIds.length
      ? supabase
          .from("case_assertion_finding_links")
          .select("id, relationship, explanation, confidence, next_question")
          .in("id", linkIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (assertionsResult.error) {
    throw new Error(`Failed to load case_bank_assertions context: ${assertionsResult.error.message}`)
  }
  if (findingsResult.error) {
    throw new Error(`Failed to load case_findings context: ${findingsResult.error.message}`)
  }
  if (linksResult.error) {
    throw new Error(`Failed to load case_assertion_finding_links context: ${linksResult.error.message}`)
  }

  const assertionById = new Map((assertionsResult.data ?? []).map((row) => [row.id, row]))
  const findingById = new Map((findingsResult.data ?? []).map((row) => [row.id, row]))
  const linkById = new Map((linksResult.data ?? []).map((row) => [row.id, row]))

  const questionsWithContext = eligibleQuestions.map((question) => {
    const rawOutput =
      question.raw_model_output && typeof question.raw_model_output === "object"
        ? (question.raw_model_output as Record<string, unknown>)
        : null
    const investigationIssue =
      rawOutput?.investigation_issue && typeof rawOutput.investigation_issue === "object"
        ? (rawOutput.investigation_issue as Record<string, unknown>)
        : null

    return {
      ...question,
      source_theme_id: typeof rawOutput?.source_theme_id === "string" ? rawOutput.source_theme_id : null,
      source_theme_title: typeof rawOutput?.source_theme_title === "string" ? rawOutput.source_theme_title : null,
      issue_text: typeof investigationIssue?.issue_text === "string" ? investigationIssue.issue_text : null,
      source_assertion: question.source_assertion_id
        ? (assertionById.get(question.source_assertion_id) ?? null)
        : null,
      source_finding: question.source_finding_id ? (findingById.get(question.source_finding_id) ?? null) : null,
      source_link: question.source_link_id ? (linkById.get(question.source_link_id) ?? null) : null,
    }
  })

  const prompt = buildEvidenceRequestsPrompt(questionsWithContext)

  log.info("Calling model to generate evidence requests", {
    caseId: input.caseId,
    openQuestionsCount: openQuestions.length,
    eligibleQuestionsCount: eligibleQuestions.length,
    excludedIrrelevantLinkedQuestionsCount: openQuestions.length - eligibleQuestions.length,
  })

  const parsedJson = await generateJson({
    prompt,
    schemaName: "evidence requests generation",
  })

  const parsed = evidenceRequestsPayloadSchema.parse(parsedJson)
  if (parsed.evidence_requests.length === 0) {
    throw new Error("No evidence requests generated")
  }

  const sanitizedRequests: EvidenceRequestCandidate[] = parsed.evidence_requests.map((request) => {
    const preview = request.request_text.slice(0, 120)
    const rawCategory = request.evidence_category
    const evidenceCategory = normalizeEvidenceCategory(rawCategory)

    if (normalizeEvidenceCategoryKey(String(rawCategory)) !== evidenceCategory) {
      log.warn("Normalized evidence_category", {
        caseId: input.caseId,
        rawCategory: String(rawCategory),
        normalizedCategory: evidenceCategory,
        requestTextPreview: preview,
      })
    }

    return {
      request_text: request.request_text,
      request_reason: request.request_reason ?? null,
      evidence_category: evidenceCategory,
      requested_from: request.requested_from,
      priority: request.priority,
      suggested_file_types: request.suggested_file_types,
      example_documents: request.example_documents,
      source_question_id: sanitizeNullableSourceId({
        caseId: input.caseId,
        field: "source_question_id",
        rawValue: request.source_question_id,
        validIds: validQuestionIds,
        preview,
        previewField: "requestTextPreview",
        log,
      }),
      source_assertion_id: sanitizeNullableSourceId({
        caseId: input.caseId,
        field: "source_assertion_id",
        rawValue: request.source_assertion_id,
        validIds: validAssertionIds,
        preview,
        previewField: "requestTextPreview",
        log,
      }),
      source_finding_id: sanitizeNullableSourceId({
        caseId: input.caseId,
        field: "source_finding_id",
        rawValue: request.source_finding_id,
        validIds: validFindingIds,
        preview,
        previewField: "requestTextPreview",
        log,
      }),
      source_link_id: sanitizeNullableSourceId({
        caseId: input.caseId,
        field: "source_link_id",
        rawValue: request.source_link_id,
        validIds: validLinkIds,
        preview,
        previewField: "requestTextPreview",
        log,
      }),
    }
  })

  const consolidatedRequests = consolidateEvidenceRequests(sanitizedRequests)
  if (consolidatedRequests.length === 0) {
    throw new Error("No evidence requests generated")
  }

  log.info("Consolidated evidence requests", {
    caseId: input.caseId,
    rawRequestCount: sanitizedRequests.length,
    consolidatedRequestCount: consolidatedRequests.length,
  })

  const insertRows = consolidatedRequests.map((request) => ({
    case_id: input.caseId,
    source_question_id: request.source_question_id ?? null,
    source_assertion_id: request.source_assertion_id ?? null,
    source_finding_id: request.source_finding_id ?? null,
    source_link_id: request.source_link_id ?? null,
    request_text: request.request_text,
    request_reason: request.request_reason ?? null,
    evidence_category: request.evidence_category,
    requested_from: request.requested_from,
    priority: request.priority,
    status: "open" as const,
    suggested_file_types: request.suggested_file_types,
    example_documents: request.example_documents,
    raw_model_output: {
      ...request,
      consolidated_from_count: sanitizedRequests.length,
      regulatory_citations: request.source_question_id
        ? (questionCitationsById.get(request.source_question_id) ?? [])
        : [],
    },
  }))

  const { error: deleteError } = await supabase
    .from("case_evidence_requests")
    .delete()
    .eq("case_id", input.caseId)
    .eq("status", "open")

  if (deleteError) {
    throw new Error(`Failed to clear existing open case_evidence_requests rows: ${deleteError.message}`)
  }

  const { data, error } = await supabase
    .from("case_evidence_requests")
    .insert(insertRows)
    .select(
      "id, case_id, source_question_id, source_assertion_id, source_finding_id, source_link_id, request_text, request_reason, evidence_category, requested_from, priority, status, suggested_file_types, example_documents, raw_model_output, created_at, updated_at",
    )

  if (error) {
    throw new Error(`Failed to insert case_evidence_requests rows: ${error.message}`)
  }

  return { evidence_requests: (data ?? []) as CaseEvidenceRequestRow[] }
}
