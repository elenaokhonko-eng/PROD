import { z } from "zod"

import { consolidateInvestigationIssues } from "@/lib/server/fidrec/consolidate-investigation-issues"
import {
  buildCitationsByThemeId,
  buildThemeRegulatoryCitations,
} from "@/lib/server/fidrec/build-theme-regulatory-citations"
import {
  loadOpenThemeContexts,
  resolveDominantThemeSources,
  type OpenThemeContext,
} from "@/lib/server/fidrec/load-open-theme-contexts"
import { retrieveThemeRegulatoryClauses } from "@/lib/server/fidrec/retrieve-theme-regulatory-clauses"
import { zodEnum } from "@/lib/server/fidrec/zod-enums"
import { generateJson, getOpenAiModel } from "@/lib/server/ai/generate-json"
import { normalizeNullableUuid, sanitizeNullableSourceId } from "@/lib/server/fidrec/normalize-source-id"
import { logger } from "@/lib/logger"
import { createServiceClient } from "@/lib/supabase/service"
import type {
  CaseInvestigationQuestionRow,
  InvestigationQuestionPriority,
  InvestigationQuestionType,
} from "@/lib/types/fidrec"

const modelName = getOpenAiModel()
const log = logger.withContext({ module: "fidrec-generate-investigation-questions", model: modelName })

const QUESTION_TYPES: readonly InvestigationQuestionType[] = [
  "particulars",
  "evidence_request",
  "chronology_gap",
  "authentication_gap",
  "containment_gap",
  "contradiction",
  "human_review",
] as const

const PRIORITIES: readonly InvestigationQuestionPriority[] = ["low", "medium", "high", "critical"] as const

const QUESTION_TYPE_ALIASES: Record<string, InvestigationQuestionType> = {
  transaction_pattern: "evidence_request",
  authentication: "authentication_gap",
  notification: "chronology_gap",
  customer_behaviour: "human_review",
  fi_behaviour: "human_review",
  containment: "containment_gap",
  chronology: "chronology_gap",
  core_claim: "human_review",
}

function coerceQuestionType(value: unknown): InvestigationQuestionType {
  if (typeof value === "string" && QUESTION_TYPES.includes(value as InvestigationQuestionType)) {
    return value as InvestigationQuestionType
  }
  if (typeof value === "string" && value in QUESTION_TYPE_ALIASES) {
    return QUESTION_TYPE_ALIASES[value]
  }
  return "human_review"
}

const questionTypeSchema = z.preprocess(coerceQuestionType, zodEnum(QUESTION_TYPES))

const investigationQuestionSchema = z.object({
  source_assertion_id: z.string().nullable().optional(),
  source_finding_id: z.string().nullable().optional(),
  source_link_id: z.string().nullable().optional(),
  question_text: z.string().trim().min(1, "question_text is required"),
  question_type: questionTypeSchema,
  priority: zodEnum(PRIORITIES).default("medium"),
  evidence_requested: z.array(z.string().trim().min(1)).default([]),
})

const investigationQuestionsPayloadSchema = z.object({
  investigation_questions: z.array(investigationQuestionSchema).min(1, "No investigation questions generated"),
})

const themeInvestigationQuestionSchema = z.object({
  source_theme_id: z.string().uuid("source_theme_id must be a valid UUID"),
  source_assertion_id: z.string().nullable().optional(),
  source_finding_id: z.string().nullable().optional(),
  source_link_id: z.string().nullable().optional(),
  issue_text: z.string().trim().min(1, "issue_text is required"),
  question_text: z.string().trim().min(1, "question_text is required"),
  question_type: questionTypeSchema,
  priority: zodEnum(PRIORITIES).default("medium"),
  evidence_requested: z.array(z.string().trim().min(1)).default([]),
})

const themeInvestigationQuestionsPayloadSchema = z.object({
  investigation_questions: z.array(themeInvestigationQuestionSchema).min(1, "No investigation questions generated"),
})

type SanitizedQuestion = {
  source_assertion_id: string | null
  source_finding_id: string | null
  source_link_id: string | null
  question_text: string
  question_type: InvestigationQuestionType
  priority: InvestigationQuestionPriority
  evidence_requested: string[]
}

type ThemeQuestionInsert = SanitizedQuestion & {
  source_theme_id: string
  source_theme_title: string
  issue_text: string
}

export type GenerateAndPersistInvestigationQuestionsInput = {
  caseId: string
}

export type GenerateAndPersistInvestigationQuestionsResult = {
  investigation_questions: CaseInvestigationQuestionRow[]
}

function buildLinkLevelInvestigationQuestionsPrompt(
  assertions: Array<{
    id: string
    assertion_text: string
    assertion_type: string
    particulars_needed: unknown
    evidence_needed: unknown
  }>,
  findings: Array<{
    id: string
    finding_text: string
    finding_type: string
    supporting_evidence: unknown
    missing_information: unknown
    human_review_required: boolean
  }>,
  links: Array<{
    id: string
    bank_assertion_id: string
    finding_id: string
    relationship: string
    explanation: string | null
    confidence: string
    next_question: string | null
  }>,
): string {
  return `You are generating unresolved investigation questions for a Singapore phishing-scam dispute case.

Task:
- Generate candidate investigation questions only.
- These candidates will be consolidated in-memory into one investigation issue and one final question per unique factual uncertainty.
- Do not assign liability.
- Do not determine negligence.
- Do not apply SRF, UPG or ABS.
- Focus on missing facts, missing particulars, contradictions, and evidence requests.

Question rules:
- Generate at most one investigation question per assertion/finding/link combination.
- Keep each question narrowly tied to the specific assertion, finding, and link relationship provided.
- Do not import unrelated findings into a question.
- For 3DS, contactless, token, device, or authentication assertions, ask authentication-chain questions only.
- For hotline or reporting findings, ask reporting or containment questions only when linked to a reporting or containment assertion.
- Do not create broad catch-all questions that span multiple unrelated issues under one assertion.

Do not create questions for irrelevant links. Irrelevant links are excluded from the input below.

Allowed question_type values:
- particulars
- evidence_request
- chronology_gap
- authentication_gap
- containment_gap
- contradiction
- human_review

Allowed priority values:
- low
- medium
- high
- critical

Return JSON only in this exact shape:
{
  "investigation_questions": [
    {
      "source_assertion_id": "...",
      "source_finding_id": "...",
      "source_link_id": "...",
      "question_text": "...",
      "question_type": "particulars",
      "priority": "high",
      "evidence_requested": ["..."]
    }
  ]
}

Bank assertions:
${JSON.stringify(assertions, null, 2)}

Case findings:
${JSON.stringify(findings, null, 2)}

Assertion-finding links (irrelevant links excluded):
${JSON.stringify(links, null, 2)}

JSON Output:`
}

function buildThemeLevelInvestigationQuestionsPrompt(themeContexts: OpenThemeContext[]): string {
  const themesForPrompt = themeContexts.map((context) => ({
    theme: context.theme,
    linked_assertions: context.assertions,
    linked_findings: context.findings,
    linked_assertion_finding_links: context.links,
    linked_evidence_requests: context.evidenceRequests,
  }))

  return `You are generating unresolved investigation questions for a Singapore phishing-scam dispute case.

Task:
- Generate exactly one investigation question per theme provided below.
- Each question must capture the unresolved factual issue for that theme as a whole.
- Questions must be tied to the theme, not a single isolated link.
- Do not assign liability.
- Do not determine negligence.
- Do not apply SRF, UPG or ABS yet.
- Do not use the word "prove"; use "provide records showing" or "demonstrate with records".

Theme-level rules:
- Generate at most one question per theme.
- Do not mix unrelated mechanisms unless the theme genuinely combines them.
- For authentication themes, ask one consolidated transaction-level authentication question.
- For transaction_pattern themes, ask about fraud monitoring, velocity, or anomaly detection.
- For customer_reporting themes, ask about reporting timestamp and containment after notification.
- If a theme has a dominant assertion/finding/link, you may populate those source IDs; otherwise leave them null.

Example:
Theme:
Authentication process and legitimacy of digital token and wallet usage

Question:
Can the bank provide transaction-level authentication records showing the authentication method, device or wallet used, token status, and timestamps for each disputed transaction?

Allowed question_type values:
- particulars
- evidence_request
- chronology_gap
- authentication_gap
- containment_gap
- contradiction
- human_review

Allowed priority values:
- low
- medium
- high
- critical

Return JSON only in this exact shape:
{
  "investigation_questions": [
    {
      "source_theme_id": "...",
      "source_assertion_id": "...",
      "source_finding_id": "...",
      "source_link_id": "...",
      "issue_text": "Whether transaction-level authentication records show legitimate customer authorisation after possible token compromise.",
      "question_text": "...",
      "question_type": "authentication_gap",
      "priority": "high",
      "evidence_requested": ["..."]
    }
  ]
}

Open case themes with linked context:
${JSON.stringify(themesForPrompt, null, 2)}

JSON Output:`
}

function sanitizeQuestionSources(input: {
  caseId: string
  question: {
    source_assertion_id?: string | null
    source_finding_id?: string | null
    source_link_id?: string | null
    question_text: string
    question_type: InvestigationQuestionType
    priority: InvestigationQuestionPriority
    evidence_requested: string[]
  }
  validAssertionIds: Set<string>
  validFindingIds: Set<string>
  validLinkIds: Set<string>
}): SanitizedQuestion {
  const preview = input.question.question_text.slice(0, 120)

  return {
    question_text: input.question.question_text,
    question_type: input.question.question_type,
    priority: input.question.priority,
    evidence_requested: input.question.evidence_requested,
    source_assertion_id: sanitizeNullableSourceId({
      caseId: input.caseId,
      field: "source_assertion_id",
      rawValue: input.question.source_assertion_id,
      validIds: input.validAssertionIds,
      preview,
      previewField: "questionTextPreview",
      log,
    }),
    source_finding_id: sanitizeNullableSourceId({
      caseId: input.caseId,
      field: "source_finding_id",
      rawValue: input.question.source_finding_id,
      validIds: input.validFindingIds,
      preview,
      previewField: "questionTextPreview",
      log,
    }),
    source_link_id: sanitizeNullableSourceId({
      caseId: input.caseId,
      field: "source_link_id",
      rawValue: input.question.source_link_id,
      validIds: input.validLinkIds,
      preview,
      previewField: "questionTextPreview",
      log,
    }),
  }
}

function dedupeThemeQuestions(questions: ThemeQuestionInsert[]): ThemeQuestionInsert[] {
  const byThemeId = new Map<string, ThemeQuestionInsert>()
  for (const question of questions) {
    if (!byThemeId.has(question.source_theme_id)) {
      byThemeId.set(question.source_theme_id, question)
    }
  }
  return [...byThemeId.values()]
}

async function persistInvestigationQuestions(input: {
  caseId: string
  insertRows: Array<{
    case_id: string
    source_assertion_id: string | null
    source_finding_id: string | null
    source_link_id: string | null
    question_text: string
    question_type: InvestigationQuestionType
    priority: InvestigationQuestionPriority
    status: "open"
    evidence_requested: string[]
    raw_model_output: Record<string, unknown>
  }>
}): Promise<GenerateAndPersistInvestigationQuestionsResult> {
  const supabase = createServiceClient()

  const { error: deleteError } = await supabase
    .from("case_investigation_questions")
    .delete()
    .eq("case_id", input.caseId)
    .eq("status", "open")

  if (deleteError) {
    throw new Error(`Failed to clear existing open case_investigation_questions rows: ${deleteError.message}`)
  }

  const { data, error } = await supabase
    .from("case_investigation_questions")
    .insert(input.insertRows)
    .select(
      "id, case_id, source_assertion_id, source_finding_id, source_link_id, question_text, question_type, priority, status, evidence_requested, answer, raw_model_output, created_at, updated_at",
    )

  if (error) {
    throw new Error(`Failed to insert case_investigation_questions rows: ${error.message}`)
  }

  return { investigation_questions: (data ?? []) as CaseInvestigationQuestionRow[] }
}

async function generateThemeLevelInvestigationQuestions(
  input: GenerateAndPersistInvestigationQuestionsInput,
  themeContexts: OpenThemeContext[],
): Promise<GenerateAndPersistInvestigationQuestionsResult> {
  const validThemeIds = new Set(themeContexts.map((context) => context.theme.id))
  const validAssertionIds = new Set(themeContexts.flatMap((context) => context.assertions.map((row) => row.id)))
  const validFindingIds = new Set(themeContexts.flatMap((context) => context.findings.map((row) => row.id)))
  const validLinkIds = new Set(themeContexts.flatMap((context) => context.links.map((row) => row.id)))
  const themeById = new Map(themeContexts.map((context) => [context.theme.id, context]))

  log.info("Calling model to generate theme-level investigation questions", {
    caseId: input.caseId,
    openThemeCount: themeContexts.length,
    method: "theme",
  })

  const parsedJson = await generateJson({
    prompt: buildThemeLevelInvestigationQuestionsPrompt(themeContexts),
    schemaName: "theme investigation questions generation",
  })

  const parsed = themeInvestigationQuestionsPayloadSchema.parse(parsedJson)
  const themeQuestions: ThemeQuestionInsert[] = []

  for (const question of parsed.investigation_questions) {
    const normalizedThemeId = normalizeNullableUuid(question.source_theme_id)
    if (!normalizedThemeId || !validThemeIds.has(normalizedThemeId)) {
      log.warn("Ignored theme-level question with unknown source_theme_id", {
        caseId: input.caseId,
        sourceThemeId: question.source_theme_id,
      })
      continue
    }

    const themeContext = themeById.get(normalizedThemeId)
    if (!themeContext) continue

    const dominantSources = resolveDominantThemeSources(themeContext)
    const sanitized = sanitizeQuestionSources({
      caseId: input.caseId,
      question: {
        source_assertion_id: question.source_assertion_id ?? dominantSources.source_assertion_id,
        source_finding_id: question.source_finding_id ?? dominantSources.source_finding_id,
        source_link_id: question.source_link_id ?? dominantSources.source_link_id,
        question_text: question.question_text,
        question_type: question.question_type,
        priority: question.priority,
        evidence_requested: question.evidence_requested,
      },
      validAssertionIds,
      validFindingIds,
      validLinkIds,
    })

    themeQuestions.push({
      ...sanitized,
      source_theme_id: normalizedThemeId,
      source_theme_title: themeContext.theme.theme_title,
      issue_text: question.issue_text,
    })
  }

  const dedupedThemeQuestions = dedupeThemeQuestions(themeQuestions)
  if (dedupedThemeQuestions.length === 0) {
    throw new Error("No investigation questions generated")
  }

  log.info("Prepared theme-level investigation questions for insert", {
    caseId: input.caseId,
    rawQuestionCount: parsed.investigation_questions.length,
    dedupedQuestionCount: dedupedThemeQuestions.length,
    method: "theme",
  })

  const themeRetrievalResults = await retrieveThemeRegulatoryClauses({ caseId: input.caseId })
  const citationsByThemeId = buildCitationsByThemeId(buildThemeRegulatoryCitations(themeRetrievalResults))

  return persistInvestigationQuestions({
    caseId: input.caseId,
    insertRows: dedupedThemeQuestions.map((question) => ({
      case_id: input.caseId,
      source_assertion_id: question.source_assertion_id,
      source_finding_id: question.source_finding_id,
      source_link_id: question.source_link_id,
      question_text: question.question_text,
      question_type: question.question_type,
      priority: question.priority,
      status: "open" as const,
      evidence_requested: question.evidence_requested,
      raw_model_output: {
        source_theme_id: question.source_theme_id,
        source_theme_title: question.source_theme_title,
        investigation_issue: {
          issue_text: question.issue_text,
        },
        regulatory_citations: citationsByThemeId.get(question.source_theme_id) ?? [],
      },
    })),
  })
}

async function generateLinkLevelInvestigationQuestions(
  input: GenerateAndPersistInvestigationQuestionsInput,
): Promise<GenerateAndPersistInvestigationQuestionsResult> {
  const supabase = createServiceClient()

  const { data: assertions, error: assertionsError } = await supabase
    .from("case_bank_assertions")
    .select("id, assertion_text, assertion_type, particulars_needed, evidence_needed, created_at")
    .eq("case_id", input.caseId)
    .order("created_at", { ascending: true })

  if (assertionsError) {
    throw new Error(`Failed to load case_bank_assertions rows: ${assertionsError.message}`)
  }

  const { data: findings, error: findingsError } = await supabase
    .from("case_findings")
    .select(
      "id, finding_text, finding_type, supporting_evidence, missing_information, human_review_required, created_at",
    )
    .eq("case_id", input.caseId)
    .order("created_at", { ascending: true })

  if (findingsError) {
    throw new Error(`Failed to load case_findings rows: ${findingsError.message}`)
  }

  const { data: links, error: linksError } = await supabase
    .from("case_assertion_finding_links")
    .select("id, bank_assertion_id, finding_id, relationship, explanation, confidence, next_question, created_at")
    .eq("case_id", input.caseId)
    .order("created_at", { ascending: true })

  if (linksError) {
    throw new Error(`Failed to load case_assertion_finding_links rows: ${linksError.message}`)
  }

  if (!assertions?.length) {
    throw new Error("No persisted bank assertions found for this case")
  }
  if (!findings?.length) {
    throw new Error("No persisted case findings found for this case")
  }
  if (!links?.length) {
    throw new Error("No persisted assertion-finding links found for this case")
  }

  const irrelevantLinkIds = new Set(
    links.filter((link) => link.relationship === "irrelevant").map((link) => link.id),
  )
  const relevantLinks = links.filter((link) => link.relationship !== "irrelevant")
  const validAssertionIds = new Set(assertions.map((row) => row.id))
  const validFindingIds = new Set(findings.map((row) => row.id))
  const validLinkIds = new Set(links.map((row) => row.id))

  log.info("Calling model to generate link-level investigation questions", {
    caseId: input.caseId,
    assertionsCount: assertions.length,
    findingsCount: findings.length,
    linksCount: links.length,
    relevantLinksCount: relevantLinks.length,
    excludedIrrelevantLinksCount: irrelevantLinkIds.size,
    method: "link",
  })

  const parsedJson = await generateJson({
    prompt: buildLinkLevelInvestigationQuestionsPrompt(assertions, findings, relevantLinks),
    schemaName: "investigation questions generation",
  })

  const parsed = investigationQuestionsPayloadSchema.parse(parsedJson)
  const filteredQuestions = parsed.investigation_questions.filter((question) => {
    const normalizedLinkId = normalizeNullableUuid(question.source_link_id)
    return !normalizedLinkId || !irrelevantLinkIds.has(normalizedLinkId)
  })
  if (filteredQuestions.length === 0) {
    throw new Error("No investigation questions generated")
  }

  const sanitizedQuestions = filteredQuestions.map((question) =>
    sanitizeQuestionSources({
      caseId: input.caseId,
      question: {
        source_assertion_id: question.source_assertion_id,
        source_finding_id: question.source_finding_id,
        source_link_id: question.source_link_id,
        question_text: question.question_text,
        question_type: question.question_type,
        priority: question.priority,
        evidence_requested: question.evidence_requested,
      },
      validAssertionIds,
      validFindingIds,
      validLinkIds,
    }),
  )

  const consolidatedIssues = await consolidateInvestigationIssues({
    caseId: input.caseId,
    candidates: sanitizedQuestions.map((question) => ({
      source_assertion_id: question.source_assertion_id,
      source_finding_id: question.source_finding_id,
      source_link_id: question.source_link_id,
      question_text: question.question_text,
      question_type: question.question_type,
      priority: question.priority,
      evidence_requested: question.evidence_requested,
    })),
  })

  if (consolidatedIssues.length === 0) {
    throw new Error("No investigation questions generated")
  }

  log.info("Prepared link-level investigation questions for insert", {
    caseId: input.caseId,
    rawQuestionCount: filteredQuestions.length,
    consolidatedQuestionCount: consolidatedIssues.length,
    method: "link",
  })

  return persistInvestigationQuestions({
    caseId: input.caseId,
    insertRows: consolidatedIssues.map((issue) => ({
      case_id: input.caseId,
      source_assertion_id: issue.source_assertion_id,
      source_finding_id: issue.source_finding_id,
      source_link_id: issue.source_link_id,
      question_text: issue.question_text,
      question_type: issue.question_type,
      priority: issue.priority,
      status: "open" as const,
      evidence_requested: issue.evidence_requested,
      raw_model_output: {
        investigation_issue: {
          issue_text: issue.issue_text,
          merged_question_texts: issue.merged_question_texts,
        },
      },
    })),
  })
}

export async function generateAndPersistInvestigationQuestions(
  input: GenerateAndPersistInvestigationQuestionsInput,
): Promise<GenerateAndPersistInvestigationQuestionsResult> {
  const themeContexts = await loadOpenThemeContexts(input.caseId)

  if (themeContexts.length > 0) {
    log.info("Using theme-level investigation question generation", {
      caseId: input.caseId,
      openThemeCount: themeContexts.length,
    })
    return generateThemeLevelInvestigationQuestions(input, themeContexts)
  }

  log.info("No open case themes found; falling back to link-level investigation question generation", {
    caseId: input.caseId,
  })
  return generateLinkLevelInvestigationQuestions(input)
}
