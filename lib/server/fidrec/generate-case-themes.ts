import { z } from "zod"

import { zodEnum } from "@/lib/server/fidrec/zod-enums"
import { selectCanonicalCaseFindings } from "@/lib/server/fidrec/load-canonical-case-findings"
import { generateJson, getOpenAiModel } from "@/lib/server/ai/generate-json"
import { normalizeNullableUuid } from "@/lib/server/fidrec/normalize-source-id"
import { logger } from "@/lib/logger"
import { createServiceClient } from "@/lib/supabase/service"
import type {
  CaseThemeLinkRow,
  CaseThemeRow,
  ThemePriority,
  ThemeType,
} from "@/lib/types/fidrec"

const modelName = getOpenAiModel()
const log = logger.withContext({ module: "fidrec-generate-case-themes", model: modelName })

const THEME_TYPES: readonly ThemeType[] = [
  "authentication",
  "token_registration",
  "transaction_pattern",
  "fraud_detection",
  "containment",
  "customer_reporting",
  "bank_investigation_quality",
  "evidence_disclosure",
  "customer_negligence",
  "other",
] as const

const PRIORITIES: readonly ThemePriority[] = ["low", "medium", "high", "critical"] as const

const themeSchema = z.object({
  theme_type: zodEnum(THEME_TYPES),
  theme_title: z.string().trim().min(1, "theme_title is required"),
  theme_summary: z.string().trim().min(1).nullable().optional(),
  priority: zodEnum(PRIORITIES).default("medium"),
  linked_bank_assertion_ids: z.array(z.string()).default([]),
  linked_finding_ids: z.array(z.string()).default([]),
  linked_assertion_finding_link_ids: z.array(z.string()).default([]),
  linked_investigation_question_ids: z.array(z.string()).default([]),
  linked_evidence_request_ids: z.array(z.string()).default([]),
  link_reason: z.string().trim().min(1).nullable().optional(),
})

const themesPayloadSchema = z.object({
  themes: z.array(themeSchema).min(1, "No case themes generated"),
})

export type GenerateAndPersistCaseThemesInput = {
  caseId: string
}

export type GenerateAndPersistCaseThemesResult = {
  themes: CaseThemeRow[]
  theme_links: CaseThemeLinkRow[]
}

type LoadedCaseContext = {
  assertions: Array<{ id: string; assertion_text: string; assertion_type: string }>
  findings: Array<{ id: string; finding_text: string; finding_type: string }>
  links: Array<{
    id: string
    bank_assertion_id: string
    finding_id: string
    relationship: string
    explanation: string | null
  }>
  questions: Array<{ id: string; question_text: string; question_type: string; priority: string }>
  evidenceRequests: Array<{ id: string; request_text: string; evidence_category: string; priority: string }>
  validAssertionIds: Set<string>
  validFindingIds: Set<string>
  validLinkIds: Set<string>
  validQuestionIds: Set<string>
  validEvidenceRequestIds: Set<string>
}

function buildCaseThemesPrompt(context: LoadedCaseContext): string {
  return `You are grouping Tier-2 investigative material into coherent case themes for a Singapore phishing-scam dispute.

Task:
- Group related bank assertions, findings, links, investigation questions, and evidence requests into themes.
- Themes are organisational and investigative only.
- Do not make legal conclusions.
- Do not assign liability.
- Do not apply SRF, UPG, or ABS.
- Prefer fewer stronger themes over many tiny themes.
- A theme may include multiple assertions, findings, links, questions, and evidence requests.
- Avoid duplicating the same factual uncertainty across multiple themes.
- Use only IDs from the input data.
- Case findings in the input are persisted canonical findings only (one row per distinct finding).

Allowed theme_type values:
- authentication
- token_registration
- transaction_pattern
- fraud_detection
- containment
- customer_reporting
- bank_investigation_quality
- evidence_disclosure
- customer_negligence
- other

Allowed priority values:
- low
- medium
- high
- critical

Return JSON only in this exact shape:
{
  "themes": [
    {
      "theme_type": "authentication",
      "theme_title": "Authentication chain after token registration",
      "theme_summary": "The bank relies on authenticated transaction mechanisms, while the findings indicate a new digital token was registered before the disputed transactions.",
      "priority": "high",
      "linked_bank_assertion_ids": ["..."],
      "linked_finding_ids": ["..."],
      "linked_assertion_finding_link_ids": ["..."],
      "linked_investigation_question_ids": ["..."],
      "linked_evidence_request_ids": ["..."],
      "link_reason": "These items all relate to whether authentication proves customer authorisation after possible compromise."
    }
  ]
}

Bank assertions:
${JSON.stringify(context.assertions, null, 2)}

Case findings:
${JSON.stringify(context.findings, null, 2)}

Assertion-finding links:
${JSON.stringify(context.links, null, 2)}

Investigation questions:
${JSON.stringify(context.questions, null, 2)}

Evidence requests:
${JSON.stringify(context.evidenceRequests, null, 2)}

JSON Output:`
}

function sanitizeIdList(input: {
  caseId: string
  field: string
  rawIds: unknown
  validIds: Set<string>
  preview: string
}): string[] {
  const { caseId, field, rawIds, validIds, preview } = input

  if (!Array.isArray(rawIds)) return []

  const seen = new Set<string>()
  const sanitized: string[] = []

  for (const rawId of rawIds) {
    if (typeof rawId !== "string") {
      log.warn("Ignored invalid theme link id format", {
        caseId,
        field,
        rawValue: String(rawId),
        themeTitlePreview: preview,
      })
      continue
    }

    const trimmed = rawId.trim()
    const normalized = normalizeNullableUuid(trimmed)
    if (!normalized) {
      if (trimmed) {
        log.warn("Ignored invalid theme link id format", {
          caseId,
          field,
          rawValue: trimmed,
          themeTitlePreview: preview,
        })
      }
      continue
    }

    if (!validIds.has(normalized)) {
      log.warn("Ignored theme link id not found in loaded rows", {
        caseId,
        field,
        invalidId: normalized,
        themeTitlePreview: preview,
      })
      continue
    }

    if (seen.has(normalized)) continue
    seen.add(normalized)
    sanitized.push(normalized)
  }

  return sanitized
}

function buildThemeLinkRows(input: {
  caseId: string
  themeId: string
  theme: z.infer<typeof themeSchema>
  sanitized: {
    assertionIds: string[]
    findingIds: string[]
    linkIds: string[]
    questionIds: string[]
    evidenceRequestIds: string[]
  }
}): Array<Omit<CaseThemeLinkRow, "id" | "created_at">> {
  const linkReason = input.theme.link_reason ?? null
  const rows: Array<Omit<CaseThemeLinkRow, "id" | "created_at">> = []

  for (const bankAssertionId of input.sanitized.assertionIds) {
    rows.push({
      case_id: input.caseId,
      theme_id: input.themeId,
      bank_assertion_id: bankAssertionId,
      finding_id: null,
      assertion_finding_link_id: null,
      investigation_question_id: null,
      evidence_request_id: null,
      link_reason: linkReason,
    })
  }

  for (const findingId of input.sanitized.findingIds) {
    rows.push({
      case_id: input.caseId,
      theme_id: input.themeId,
      bank_assertion_id: null,
      finding_id: findingId,
      assertion_finding_link_id: null,
      investigation_question_id: null,
      evidence_request_id: null,
      link_reason: linkReason,
    })
  }

  for (const linkId of input.sanitized.linkIds) {
    rows.push({
      case_id: input.caseId,
      theme_id: input.themeId,
      bank_assertion_id: null,
      finding_id: null,
      assertion_finding_link_id: linkId,
      investigation_question_id: null,
      evidence_request_id: null,
      link_reason: linkReason,
    })
  }

  for (const questionId of input.sanitized.questionIds) {
    rows.push({
      case_id: input.caseId,
      theme_id: input.themeId,
      bank_assertion_id: null,
      finding_id: null,
      assertion_finding_link_id: null,
      investigation_question_id: questionId,
      evidence_request_id: null,
      link_reason: linkReason,
    })
  }

  for (const evidenceRequestId of input.sanitized.evidenceRequestIds) {
    rows.push({
      case_id: input.caseId,
      theme_id: input.themeId,
      bank_assertion_id: null,
      finding_id: null,
      assertion_finding_link_id: null,
      investigation_question_id: null,
      evidence_request_id: evidenceRequestId,
      link_reason: linkReason,
    })
  }

  return rows
}

export async function generateAndPersistCaseThemes(
  input: GenerateAndPersistCaseThemesInput,
): Promise<GenerateAndPersistCaseThemesResult> {
  const supabase = createServiceClient()

  const [assertionsResult, findingsResult, linksResult, questionsResult, evidenceRequestsResult] =
    await Promise.all([
      supabase
        .from("case_bank_assertions")
        .select("id, assertion_text, assertion_type")
        .eq("case_id", input.caseId)
        .order("created_at", { ascending: true }),
      supabase
        .from("case_findings")
        .select("id, finding_text, finding_type, created_at")
        .eq("case_id", input.caseId)
        .order("created_at", { ascending: true }),
      supabase
        .from("case_assertion_finding_links")
        .select("id, bank_assertion_id, finding_id, relationship, explanation")
        .eq("case_id", input.caseId)
        .order("created_at", { ascending: true }),
      supabase
        .from("case_investigation_questions")
        .select("id, question_text, question_type, priority")
        .eq("case_id", input.caseId)
        .order("created_at", { ascending: true }),
      supabase
        .from("case_evidence_requests")
        .select("id, request_text, evidence_category, priority")
        .eq("case_id", input.caseId)
        .order("created_at", { ascending: true }),
    ])

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

  const assertions = assertionsResult.data ?? []
  const loadedFindings = findingsResult.data ?? []
  const canonicalFindings = selectCanonicalCaseFindings(loadedFindings)
  const links = linksResult.data ?? []
  const questions = questionsResult.data ?? []
  const evidenceRequests = evidenceRequestsResult.data ?? []

  if (!assertions.length) {
    throw new Error("No persisted bank assertions found for this case")
  }
  if (!canonicalFindings.length) {
    throw new Error("No persisted case findings found for this case")
  }

  if (canonicalFindings.length < loadedFindings.length) {
    log.info("Using canonical case findings for theme generation", {
      caseId: input.caseId,
      loadedFindingCount: loadedFindings.length,
      canonicalFindingCount: canonicalFindings.length,
    })
  }

  const context: LoadedCaseContext = {
    assertions,
    findings: canonicalFindings.map(({ id, finding_text, finding_type }) => ({
      id,
      finding_text,
      finding_type,
    })),
    links,
    questions,
    evidenceRequests,
    validAssertionIds: new Set(assertions.map((row) => row.id)),
    validFindingIds: new Set(canonicalFindings.map((row) => row.id)),
    validLinkIds: new Set(links.map((row) => row.id)),
    validQuestionIds: new Set(questions.map((row) => row.id)),
    validEvidenceRequestIds: new Set(evidenceRequests.map((row) => row.id)),
  }

  log.info("Calling model to generate case themes", {
    caseId: input.caseId,
    assertionsCount: assertions.length,
    findingsCount: canonicalFindings.length,
    linksCount: links.length,
    questionsCount: questions.length,
    evidenceRequestsCount: evidenceRequests.length,
  })

  const parsedJson = await generateJson({
    prompt: buildCaseThemesPrompt(context),
    schemaName: "case themes generation",
  })

  const parsed = themesPayloadSchema.parse(parsedJson)
  if (parsed.themes.length === 0) {
    throw new Error("No case themes generated")
  }

  const { data: openThemes, error: openThemesError } = await supabase
    .from("case_themes")
    .select("id")
    .eq("case_id", input.caseId)
    .eq("status", "open")

  if (openThemesError) {
    throw new Error(`Failed to load open case_themes rows: ${openThemesError.message}`)
  }

  const openThemeIds = (openThemes ?? []).map((row) => row.id)
  if (openThemeIds.length) {
    const { error: deleteLinksError } = await supabase
      .from("case_theme_links")
      .delete()
      .eq("case_id", input.caseId)
      .in("theme_id", openThemeIds)

    if (deleteLinksError) {
      throw new Error(`Failed to clear open case_theme_links rows: ${deleteLinksError.message}`)
    }

    const { error: deleteThemesError } = await supabase
      .from("case_themes")
      .delete()
      .eq("case_id", input.caseId)
      .eq("status", "open")

    if (deleteThemesError) {
      throw new Error(`Failed to clear open case_themes rows: ${deleteThemesError.message}`)
    }
  }

  const themeInsertRows = parsed.themes.map((theme) => ({
    case_id: input.caseId,
    theme_type: theme.theme_type,
    theme_title: theme.theme_title,
    theme_summary: theme.theme_summary ?? null,
    priority: theme.priority,
    status: "open" as const,
    raw_model_output: theme,
  }))

  const { data: insertedThemes, error: insertThemesError } = await supabase
    .from("case_themes")
    .insert(themeInsertRows)
    .select(
      "id, case_id, theme_type, theme_title, theme_summary, priority, status, raw_model_output, created_at, updated_at",
    )

  if (insertThemesError) {
    throw new Error(`Failed to insert case_themes rows: ${insertThemesError.message}`)
  }

  const themes = (insertedThemes ?? []) as CaseThemeRow[]
  const themeLinkInsertRows: Array<Omit<CaseThemeLinkRow, "id" | "created_at">> = []

  for (let index = 0; index < parsed.themes.length; index += 1) {
    const theme = parsed.themes[index]
    const insertedTheme = themes[index]
    if (!insertedTheme) continue

    const preview = theme.theme_title.slice(0, 120)
    const sanitized = {
      assertionIds: sanitizeIdList({
        caseId: input.caseId,
        field: "linked_bank_assertion_ids",
        rawIds: theme.linked_bank_assertion_ids,
        validIds: context.validAssertionIds,
        preview,
      }),
      findingIds: sanitizeIdList({
        caseId: input.caseId,
        field: "linked_finding_ids",
        rawIds: theme.linked_finding_ids,
        validIds: context.validFindingIds,
        preview,
      }),
      linkIds: sanitizeIdList({
        caseId: input.caseId,
        field: "linked_assertion_finding_link_ids",
        rawIds: theme.linked_assertion_finding_link_ids,
        validIds: context.validLinkIds,
        preview,
      }),
      questionIds: sanitizeIdList({
        caseId: input.caseId,
        field: "linked_investigation_question_ids",
        rawIds: theme.linked_investigation_question_ids,
        validIds: context.validQuestionIds,
        preview,
      }),
      evidenceRequestIds: sanitizeIdList({
        caseId: input.caseId,
        field: "linked_evidence_request_ids",
        rawIds: theme.linked_evidence_request_ids,
        validIds: context.validEvidenceRequestIds,
        preview,
      }),
    }

    themeLinkInsertRows.push(
      ...buildThemeLinkRows({
        caseId: input.caseId,
        themeId: insertedTheme.id,
        theme,
        sanitized,
      }),
    )
  }

  let themeLinks: CaseThemeLinkRow[] = []
  if (themeLinkInsertRows.length) {
    const { data: insertedThemeLinks, error: insertThemeLinksError } = await supabase
      .from("case_theme_links")
      .insert(themeLinkInsertRows)
      .select(
        "id, case_id, theme_id, bank_assertion_id, finding_id, assertion_finding_link_id, investigation_question_id, evidence_request_id, link_reason, created_at",
      )

    if (insertThemeLinksError) {
      throw new Error(`Failed to insert case_theme_links rows: ${insertThemeLinksError.message}`)
    }

    themeLinks = (insertedThemeLinks ?? []) as CaseThemeLinkRow[]
  }

  log.info("Persisted case themes", {
    caseId: input.caseId,
    themeCount: themes.length,
    themeLinkCount: themeLinks.length,
    preservedNonOpenThemes: true,
  })

  return { themes, theme_links: themeLinks }
}
