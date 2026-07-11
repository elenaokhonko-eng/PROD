import { createServiceClient } from "@/lib/supabase/service"
import { buildEvidenceLinks, type EvidencePresentationContext } from "@/lib/server/fidrec/build-evidence-links"
import type {
  CasePackAnnexurePlaceholder,
  CasePackTheme,
} from "@/lib/types/fidrec-case-pack"
import type { EvidenceLabel, FidrecEvidenceType } from "@/lib/types/fidrec-evidence-labels"
import {
  EVIDENCE_RELATIONSHIP_WEIGHTS as RELATIONSHIP_WEIGHTS,
  type EvidenceCoverageMatrix,
  type EvidenceCoverageMatrixRow,
  type EvidenceCoverageStatus,
  type EvidenceLinkDiagnostic,
  type EvidenceReviewItem,
  type EvidenceReviewModel,
  type EvidenceReviewStatus,
  type EvidenceStrength,
} from "@/lib/types/fidrec-evidence-review"
import type {
  CaseBankAssertionRow,
  CaseEvidenceRequestRow,
  CaseFindingRow,
  CaseInvestigationQuestionRow,
  CaseThemeLinkRow,
} from "@/lib/types/fidrec"

const PROCESSED_TYPE_HUMAN_TITLES: Record<string, string> = {
  BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY: "Bank Final Response",
  BANK_SRF_INVESTIGATION_REPORT_OR_OFFICIAL_RESPONSE: "Bank Investigation Report",
  BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL: "Bank Correspondence",
  BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS: "Transaction History",
  CREDIT_CARD_STATEMENT_SHOWING_TRANSACTIONS: "Credit Card Transaction History",
  POLICE_REPORT_OF_FRAUD_SCAM: "Police Report",
  BANK_SCAM_FRAUD_HOTLINE_CALL_LOG: "Fraud Hotline Call Log",
  BANK_SCAM_FRAUD_HOTLINE_CALL_RECORDING: "Fraud Hotline Call Recording",
  SMS_LOG_ALL_TRANSACTION_NOTIFICATIONS: "Transaction SMS Notifications",
  SMS_LOG_TOKEN_BINDING_NOTIFICATIONS: "Digital Token Registration SMS",
  SMS_LOG_BANK_ACCOUNT_LIMIT_NOTIFICATIONS: "Account Limit SMS Notifications",
  SMS_LOG_CREDIT_CARD_BLOCKING_NOTIFICATIONS: "Card Blocking SMS Notifications",
  RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA: "Authentication and Login Activity Record",
  PHISHING_EMAIL_COPY_OR_DESCRIPTION: "Phishing Message Screenshot",
  TIMELINE_NOTES: "Customer Timeline Notes",
  TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK: "Dispute Submission to Bank",
  CYBER_EXPERT_REPORT: "Independent Cybersecurity Expert Report",
  OTHER: "Supporting Document",
}

const CONTENT_TITLE_PATTERNS: Array<{ pattern: RegExp; title: string; strength?: EvidenceStrength }> = [
  { pattern: /\b(cyber\s*security|cybersecurity)\s+expert\s+report\b/i, title: "Independent Cybersecurity Expert Report", strength: "high" },
  { pattern: /\b(expert\s+report|forensic\s+report)\b/i, title: "Independent Expert Report", strength: "high" },
  { pattern: /\b(fraud\s+hotline|scam\s+hotline)\b/i, title: "Fraud Hotline Call Log", strength: "high" },
  { pattern: /\b(call\s+recording|hotline\s+recording)\b/i, title: "Fraud Hotline Call Recording", strength: "high" },
  { pattern: /\b(statutory\s+declaration|stat\s*dec)\b/i, title: "Statutory Declaration", strength: "high" },
  { pattern: /\b(police\s+report|spf\s+report)\b/i, title: "Police Report", strength: "high" },
  { pattern: /\b(final\s+response|dispute\s+response|unsuccessful)\b/i, title: "Bank Final Response", strength: "high" },
  { pattern: /\b(3d\s*secure|3ds|authentication\s+log)\b/i, title: "Authentication Activity Record", strength: "high" },
  { pattern: /\b(token\s+registration|digital\s+token)\b/i, title: "Digital Token Registration Record", strength: "medium" },
  { pattern: /\b(transaction\s+history|bank\s+statement|card\s+statement)\b/i, title: "Transaction History", strength: "medium" },
  { pattern: /\b(customer\s+service|service\s+response)\b/i, title: "Customer Service Response", strength: "medium" },
  { pattern: /\b(travel\s+itinerary|flight\s+itinerary)\b/i, title: "Travel Itinerary", strength: "low" },
  { pattern: /\b(news\s+article|news\s+clip)\b/i, title: "News Article", strength: "low" },
  { pattern: /\b(screenshot|screen\s*grab)\b/i, title: "Screenshot", strength: "low" },
]

const FILENAME_TITLE_PATTERNS: Array<{ pattern: RegExp; title: string }> = [
  { pattern: /\b(hotline|call\s*log)\b/i, title: "Fraud Hotline Call Log" },
  { pattern: /\b(police|spf)\b/i, title: "Police Report" },
  { pattern: /\b(stat\s*dec|statutory)\b/i, title: "Statutory Declaration" },
  { pattern: /\b(cyber|expert|forensic)\b/i, title: "Independent Cybersecurity Expert Report" },
  { pattern: /\b(final\s*response|dispute\s*response)\b/i, title: "Bank Final Response" },
  { pattern: /\b(statement|transaction)\b/i, title: "Transaction History" },
  { pattern: /\b(screenshot|screen\s*grab)\b/i, title: "Screenshot" },
  { pattern: /\b(itinerary|travel)\b/i, title: "Travel Itinerary" },
  { pattern: /\b(news)\b/i, title: "News Article" },
]

const BANK_NAME_PATTERN =
  /\b(DBS|OCBC|UOB|HSBC|Standard Chartered|Citibank|Maybank|CIMB|Bank of China|ANZ)\b/i

const HIGH_STRENGTH_TYPES = new Set<FidrecEvidenceType>([
  "bank_final_response",
  "police_report",
  "statutory_declaration",
  "authentication_record",
  "hotline_call_record",
  "bank_investigation_report",
])

const MEDIUM_STRENGTH_TYPES = new Set<FidrecEvidenceType>([
  "bank_email_or_letter",
  "transaction_history",
  "customer_narrative",
  "token_registration_record",
  "fraud_monitoring_record",
  "containment_record",
  "sms_or_email_alert",
  "merchant_record",
  "device_or_ip_record",
])

const HIGH_STRENGTH_CONTENT_PATTERNS = [
  /\bexpert\s+report\b/i,
  /\bcyber\s*security\s+specialist\b/i,
  /\bcybersecurity\s+specialist\b/i,
  /\bindependent\s+cyber\s*security\b/i,
  /\bsigned\s+report\b/i,
  /\bforensic\s+report\b/i,
  /\bcall\s+recording\b/i,
  /\bcall\s+log\b/i,
  /\bhotline\s+log\b/i,
  /\bfraud\s+hotline\b/i,
  /\bbank\s+final\s+response\b/i,
  /\bfinal\s+response\b/i,
  /\bpolice\s+report\b/i,
  /\bstatutory\s+declaration\b/i,
]

const MEDIUM_STRENGTH_CONTENT_PATTERNS = [
  /\bbank\s+correspondence\b/i,
  /\bcustomer\s+correspondence\b/i,
  /\bcustomer\s+service\b/i,
  /\btransaction\s+history\b/i,
  /\bdevice\s+record\b/i,
  /\bdevice\s+or\s+ip\b/i,
]

const LOW_STRENGTH_TYPES = new Set<FidrecEvidenceType>(["screenshot"])

const HIGH_STRENGTH_PROCESSED_TYPES = new Set([
  "CYBER_EXPERT_REPORT",
  "BANK_SCAM_FRAUD_HOTLINE_CALL_RECORDING",
])

const LOW_STRENGTH_CONTENT_PATTERNS = [/\bnews\b/i, /\bitinerary\b/i, /\btravel\b/i]

export type BuildEvidenceReviewModelInput = {
  caseId: string
  evidenceLabels: EvidenceLabel[]
  keyThemes: CasePackTheme[]
  annexurePlaceholders: CasePackAnnexurePlaceholder[]
  assertions: CaseBankAssertionRow[]
  findings: CaseFindingRow[]
  questions: CaseInvestigationQuestionRow[]
  evidenceRequests: CaseEvidenceRequestRow[]
}

function normalizeProcessedTypeKey(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  return value.trim().toUpperCase()
}

function detectBankName(...sources: Array<string | null | undefined>): string | null {
  for (const source of sources) {
    if (!source?.trim()) continue
    const match = source.match(BANK_NAME_PATTERN)
    if (match?.[1]) {
      return match[1]
    }
  }
  return null
}

function cleanFilenameTitle(filename: string | null | undefined): string | null {
  if (!filename?.trim()) return null

  const withoutExtension = filename.replace(/\.[^.]+$/, "").trim()
  if (!withoutExtension || withoutExtension.length < 4) return null
  if (/^(document|scan|file|img|image|photo|upload|attachment)\d*$/i.test(withoutExtension)) {
    return null
  }

  const normalized = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (/^[A-Z0-9\s]+$/.test(normalized)) {
    return normalized
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase())
  }

  return normalized.length > 80 ? `${normalized.slice(0, 77).trim()}...` : normalized
}

function applyBankPrefix(title: string, bankName: string | null, suffix: string): string {
  if (!bankName) return title
  if (title.toLowerCase().includes(bankName.toLowerCase())) return title
  return `${bankName} ${suffix}`
}

function refineProcessedTypeTitle(
  processedTypeKey: string,
  baseTitle: string,
  bankName: string | null,
): string {
  if (processedTypeKey === "BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY") {
    return applyBankPrefix(baseTitle, bankName, "Final Response")
  }
  if (processedTypeKey === "BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL") {
    return applyBankPrefix("Customer Service Response", bankName, "Customer Service Response")
  }
  if (processedTypeKey === "BANK_SRF_INVESTIGATION_REPORT_OR_OFFICIAL_RESPONSE") {
    return applyBankPrefix(baseTitle, bankName, "Investigation Report")
  }
  return baseTitle
}

function fallbackTypeTitle(evidenceType: FidrecEvidenceType, bankName: string | null): string {
  switch (evidenceType) {
    case "bank_final_response":
      return applyBankPrefix("Bank Final Response", bankName, "Final Response")
    case "bank_investigation_report":
      return applyBankPrefix("Bank Investigation Report", bankName, "Investigation Report")
    case "bank_email_or_letter":
      return applyBankPrefix("Customer Service Response", bankName, "Customer Service Response")
    case "transaction_history":
      return "Transaction History"
    case "police_report":
      return "Police Report"
    case "statutory_declaration":
      return "Statutory Declaration"
    case "hotline_call_record":
      return "Fraud Hotline Call Log"
    case "authentication_record":
      return "Authentication Activity Record"
    case "token_registration_record":
      return "Digital Token Registration Record"
    case "fraud_monitoring_record":
      return "Fraud Monitoring Record"
    case "containment_record":
      return "Fraud Containment Action Record"
    case "customer_narrative":
      return "Customer Narrative"
    case "merchant_record":
      return "Merchant Record"
    case "sms_or_email_alert":
      return "SMS or Email Alert"
    case "screenshot":
      return "Screenshot"
    default:
      return "Supporting Document"
  }
}

export function buildHumanFriendlyEvidenceTitle(input: {
  evidenceType: FidrecEvidenceType
  shortDescription: string
  originalFilename: string | null
  presentation: DocumentPresentationContext
}): string {
  const combinedText = [
    input.presentation.verifiedProcessedType,
    input.presentation.predictedProcessedType,
    input.presentation.extractedText,
    input.shortDescription,
    input.originalFilename,
  ]
    .filter(Boolean)
    .join(" ")

  const bankName = detectBankName(
    input.presentation.extractedText,
    input.shortDescription,
    input.originalFilename,
  )

  const verifiedKey = normalizeProcessedTypeKey(input.presentation.verifiedProcessedType)
  if (verifiedKey && PROCESSED_TYPE_HUMAN_TITLES[verifiedKey]) {
    return refineProcessedTypeTitle(verifiedKey, PROCESSED_TYPE_HUMAN_TITLES[verifiedKey], bankName)
  }

  const predictedKey = normalizeProcessedTypeKey(input.presentation.predictedProcessedType)
  if (predictedKey && PROCESSED_TYPE_HUMAN_TITLES[predictedKey]) {
    return refineProcessedTypeTitle(predictedKey, PROCESSED_TYPE_HUMAN_TITLES[predictedKey], bankName)
  }

  for (const entry of CONTENT_TITLE_PATTERNS) {
    if (entry.pattern.test(combinedText)) {
      if (entry.title === "Customer Service Response" || entry.title === "Bank Correspondence") {
        return applyBankPrefix(entry.title, bankName, "Customer Service Response")
      }
      return entry.title
    }
  }

  for (const entry of FILENAME_TITLE_PATTERNS) {
    if (entry.pattern.test(input.originalFilename ?? "")) {
      if (entry.title === "Bank Final Response") {
        return applyBankPrefix(entry.title, bankName, "Final Response")
      }
      return entry.title
    }
  }

  if (input.evidenceType === "hotline_call_record") {
    return "Fraud Hotline Call Log"
  }
  if (input.evidenceType === "bank_email_or_letter") {
    return applyBankPrefix("Customer Service Response", bankName, "Customer Service Response")
  }
  if (input.evidenceType === "device_or_ip_record") {
    return "Authentication and Login Activity Record"
  }
  if (input.evidenceType === "other") {
    const filenameTitle = cleanFilenameTitle(input.originalFilename)
    if (filenameTitle) return filenameTitle
    return "Supporting Document"
  }

  return fallbackTypeTitle(input.evidenceType, bankName)
}

export function scoreEvidenceStrength(input: {
  evidenceType: FidrecEvidenceType
  sourceConfidence: EvidenceLabel["source_confidence"]
  presentation: DocumentPresentationContext
  combinedText: string
  reviewTitle?: string
}): EvidenceStrength {
  const combinedText = [input.combinedText, input.reviewTitle].filter(Boolean).join(" ")

  for (const pattern of LOW_STRENGTH_CONTENT_PATTERNS) {
    if (pattern.test(combinedText)) {
      return "low"
    }
  }

  for (const pattern of HIGH_STRENGTH_CONTENT_PATTERNS) {
    if (pattern.test(combinedText)) {
      return "high"
    }
  }

  const processedKey =
    normalizeProcessedTypeKey(input.presentation.verifiedProcessedType) ??
    normalizeProcessedTypeKey(input.presentation.predictedProcessedType)

  if (processedKey && HIGH_STRENGTH_PROCESSED_TYPES.has(processedKey)) {
    return "high"
  }

  if (HIGH_STRENGTH_TYPES.has(input.evidenceType)) {
    return "high"
  }
  if (LOW_STRENGTH_TYPES.has(input.evidenceType)) {
    return "low"
  }

  for (const pattern of MEDIUM_STRENGTH_CONTENT_PATTERNS) {
    if (pattern.test(combinedText)) {
      return "medium"
    }
  }

  if (MEDIUM_STRENGTH_TYPES.has(input.evidenceType)) {
    return "medium"
  }

  for (const entry of CONTENT_TITLE_PATTERNS) {
    if (entry.strength && entry.pattern.test(combinedText)) {
      return entry.strength
    }
  }

  if (input.evidenceType === "other") {
    if (/\b(expert|forensic|cyber|specialist|signed)\b/i.test(combinedText)) {
      return "high"
    }
    return input.sourceConfidence === "high" ? "medium" : "unknown"
  }

  return "unknown"
}

function resolveEvidenceStatus(caseDocumentId: string): EvidenceReviewStatus {
  void caseDocumentId
  return "available"
}

function getThemeIdFromQuestion(question: CaseInvestigationQuestionRow): string | null {
  const themeId = question.raw_model_output?.source_theme_id
  return typeof themeId === "string" && themeId.trim() ? themeId.trim() : null
}

async function loadManualCoverageOverrides(
  caseId: string,
  documentIds: string[],
): Promise<Map<string, boolean>> {
  if (!documentIds.length) {
    return new Map()
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("case_documents")
    .select("id, exhibit_label")
    .eq("case_id", caseId)
    .in("id", documentIds)

  if (error) {
    throw new Error(`Failed to load case_documents exhibit labels: ${error.message}`)
  }

  const overrides = new Map<string, boolean>()
  for (const row of data ?? []) {
    const exhibitLabel = typeof row.exhibit_label === "string" ? row.exhibit_label.trim() : ""
    overrides.set(row.id as string, exhibitLabel.length > 0)
  }

  return overrides
}

export async function loadDocumentPresentationById(
  caseId: string,
  documentIds: string[],
): Promise<Map<string, DocumentPresentationContext>> {
  if (!documentIds.length) {
    return new Map()
  }

  const supabase = createServiceClient()
  const [documentsResult, extractionsResult] = await Promise.all([
    supabase
      .from("case_documents")
      .select("id, verified_document_type")
      .eq("case_id", caseId)
      .in("id", documentIds),
    supabase
      .from("case_document_extractions")
      .select("document_id, extracted_text, extracted_json, extraction_type, created_at")
      .eq("case_id", caseId)
      .in("document_id", documentIds)
      .eq("extraction_type", "doc_summary_v3")
      .order("created_at", { ascending: false }),
  ])

  if (documentsResult.error) {
    throw new Error(`Failed to load case_documents for evidence review: ${documentsResult.error.message}`)
  }
  if (extractionsResult.error) {
    throw new Error(`Failed to load case_document_extractions for evidence review: ${extractionsResult.error.message}`)
  }

  const presentationById = new Map<string, DocumentPresentationContext>()

  for (const row of documentsResult.data ?? []) {
    presentationById.set(row.id as string, {
      verifiedProcessedType:
        typeof row.verified_document_type === "string" ? row.verified_document_type : null,
      predictedProcessedType: null,
      extractedText: null,
    })
  }

  for (const row of extractionsResult.data ?? []) {
    const documentId = row.document_id as string
    const existing = presentationById.get(documentId) ?? {
      verifiedProcessedType: null,
      predictedProcessedType: null,
      extractedText: null,
    }

    const extractedJson =
      row.extracted_json && typeof row.extracted_json === "object" && !Array.isArray(row.extracted_json)
        ? (row.extracted_json as Record<string, unknown>)
        : null

    const predicted = extractedJson?.predicted_document_type
    existing.predictedProcessedType =
      typeof predicted === "string" ? predicted : existing.predictedProcessedType
    existing.extractedText =
      typeof row.extracted_text === "string" && row.extracted_text.trim()
        ? row.extracted_text.trim()
        : existing.extractedText
    existing.extractedJson = extractedJson ?? existing.extractedJson ?? null

    presentationById.set(documentId, existing)
  }

  return presentationById
}

function assignDistinctReviewTitles(
  labels: EvidenceLabel[],
  presentationById: Map<string, DocumentPresentationContext>,
): Map<string, string> {
  const titlesByDocumentId = new Map<string, string>()
  const titleCounts = new Map<string, number>()

  for (const label of labels) {
    const presentation = presentationById.get(label.case_document_id) ?? {
      verifiedProcessedType: null,
      predictedProcessedType: null,
      extractedText: null,
    }

    let title = buildHumanFriendlyEvidenceTitle({
      evidenceType: label.evidence_type,
      shortDescription: label.short_description,
      originalFilename: label.original_filename,
      presentation,
    })

    const seenCount = titleCounts.get(title) ?? 0
    titleCounts.set(title, seenCount + 1)

    if (seenCount > 0) {
      if (label.document_date) {
        title = `${title} — ${label.document_date}`
      } else if (label.evidence_type === "screenshot") {
        title = `Screenshot ${seenCount + 1}`
      } else {
        title = `${title} ${seenCount + 1}`
      }
    }

    titlesByDocumentId.set(label.case_document_id, title)
  }

  return titlesByDocumentId
}

function uniqueDisplayThemes(themeTitles: string[]): string[] {
  return [...new Set(themeTitles)]
}

function resolveCoverageStatus(coverageScore: number): EvidenceCoverageStatus {
  if (coverageScore <= 0) {
    return "weak"
  }
  if (coverageScore >= 1) {
    return "strong"
  }
  return "partial"
}

export function buildEvidenceCoverageMatrix(input: {
  keyThemes: CasePackTheme[]
  evidenceReviewModel: EvidenceReviewModel
}): EvidenceCoverageMatrix {
  const weightedByThemeId = new Map<string, number>()
  const availableCountByThemeId = new Map<string, number>()

  for (const item of input.evidenceReviewModel.evidence_items) {
    if (item.evidence_status !== "available" || !item.supports_coverage) continue

    for (const relationship of item.theme_relationships) {
      if (relationship.ownership !== "primary" || !relationship.supports_coverage) continue

      const weight = RELATIONSHIP_WEIGHTS[relationship.relationship_strength]
      if (weight <= 0) continue

      weightedByThemeId.set(
        relationship.theme_id,
        (weightedByThemeId.get(relationship.theme_id) ?? 0) + weight,
      )
      availableCountByThemeId.set(
        relationship.theme_id,
        (availableCountByThemeId.get(relationship.theme_id) ?? 0) + 1,
      )
    }
  }

  const themes: EvidenceCoverageMatrixRow[] = input.keyThemes.map((theme) => {
    const requestedEvidenceCount = theme.evidence_requests.length
    const weightedEvidenceScore = weightedByThemeId.get(theme.theme_id) ?? 0
    const availableEvidenceCount = availableCountByThemeId.get(theme.theme_id) ?? 0
    const coverageScore =
      requestedEvidenceCount > 0 ? weightedEvidenceScore / requestedEvidenceCount : weightedEvidenceScore
    const missingEvidenceCount = Math.max(0, requestedEvidenceCount - weightedEvidenceScore)

    return {
      theme_id: theme.theme_id,
      theme_title: theme.theme_title,
      available_evidence_count: availableEvidenceCount,
      requested_evidence_count: requestedEvidenceCount,
      missing_evidence_count: missingEvidenceCount,
      weighted_evidence_score: weightedEvidenceScore,
      coverage_score: coverageScore,
      coverage_status: resolveCoverageStatus(coverageScore),
    }
  })

  return { themes }
}

async function loadThemeLinks(caseId: string): Promise<CaseThemeLinkRow[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("case_theme_links")
    .select("id, case_id, theme_id, bank_assertion_id, finding_id, evidence_request_id")
    .eq("case_id", caseId)

  if (error) {
    throw new Error(`Failed to load case_theme_links for evidence review: ${error.message}`)
  }

  return (data ?? []) as CaseThemeLinkRow[]
}

export async function buildEvidenceReviewModel(
  input: BuildEvidenceReviewModelInput,
): Promise<EvidenceReviewModel> {
  const themesById = new Map(input.keyThemes.map((theme) => [theme.theme_id, theme.theme_title]))
  const findingsById = new Map(input.findings.map((finding) => [finding.id, finding.finding_text]))
  const assertionsByDocumentId = new Map<string, string[]>()
  const questionsByThemeId = new Map<string, string[]>()
  const evidenceRequestsById = new Map(
    input.evidenceRequests.map((request) => [request.id, request.request_text]),
  )

  for (const assertion of input.assertions) {
    if (!assertion.source_document_id) continue
    const list = assertionsByDocumentId.get(assertion.source_document_id) ?? []
    list.push(assertion.assertion_text)
    assertionsByDocumentId.set(assertion.source_document_id, list)
  }

  for (const question of input.questions) {
    if (question.status !== "open") continue
    const themeId = getThemeIdFromQuestion(question)
    if (!themeId) continue
    const list = questionsByThemeId.get(themeId) ?? []
    list.push(question.question_text)
    questionsByThemeId.set(themeId, list)
  }

  const presentationById = await loadDocumentPresentationById(
    input.caseId,
    input.evidenceLabels.map((label) => label.case_document_id),
  )
  const titlesByDocumentId = assignDistinctReviewTitles(input.evidenceLabels, presentationById)
  const themeLinks = await loadThemeLinks(input.caseId)
  const manualCoverageOverrides = await loadManualCoverageOverrides(
    input.caseId,
    input.evidenceLabels.map((label) => label.case_document_id),
  )
  const assertionsById = new Map(input.assertions.map((assertion) => [assertion.id, assertion.assertion_text]))

  const evidenceItems: EvidenceReviewItem[] = []
  const linkDiagnostics: EvidenceLinkDiagnostic[] = []

  for (const label of input.evidenceLabels) {
    const presentation = presentationById.get(label.case_document_id) ?? {
      verifiedProcessedType: null,
      predictedProcessedType: null,
      extractedText: null,
    }

    const reviewTitle = titlesByDocumentId.get(label.case_document_id) ?? label.title

    const combinedText = [
      presentation.verifiedProcessedType,
      presentation.predictedProcessedType,
      presentation.extractedText,
      label.short_description,
      label.original_filename,
      reviewTitle,
    ]
      .filter(Boolean)
      .join(" ")

    const evidenceLinks = buildEvidenceLinks({
      evidenceLabel: label,
      reviewTitle,
      presentation,
      findings: input.findings,
      themes: input.keyThemes,
      themeLinks,
      assertions: input.assertions,
      existingLinkedFindingIds: label.linked_finding_ids,
      existingLinkedThemeIds: label.linked_theme_ids,
      existingLinkedAssertionIds: [],
      manualCoverageOverride: manualCoverageOverrides.get(label.case_document_id) ?? false,
    })

    const displayThemes = uniqueDisplayThemes(
      evidenceLinks.theme_relationships.map((relationship) => relationship.theme_title),
    )

    const relatedQuestions = [...new Set(
      evidenceLinks.linked_theme_ids.flatMap((themeId) => questionsByThemeId.get(themeId) ?? []),
    )]

    const relatedAssertions = [
      ...new Set([
        ...(assertionsByDocumentId.get(label.case_document_id) ?? []),
        ...evidenceLinks.linked_assertion_ids
          .map((assertionId) => assertionsById.get(assertionId))
          .filter((text): text is string => Boolean(text)),
      ]),
    ]

    evidenceItems.push({
      evidence_label: label.label,
      title: reviewTitle,
      evidence_type: evidenceLinks.excluded_evidence_type ?? label.evidence_type,
      description: label.short_description,
      source_confidence: label.source_confidence,
      supports_themes: displayThemes,
      theme_relationships: evidenceLinks.theme_relationships,
      supports_coverage: evidenceLinks.supports_coverage,
      related_findings: evidenceLinks.linked_finding_ids
        .map((findingId) => findingsById.get(findingId))
        .filter((text): text is string => Boolean(text)),
      related_assertions: relatedAssertions,
      related_questions: relatedQuestions,
      related_evidence_requests: label.linked_evidence_request_ids
        .map((requestId) => evidenceRequestsById.get(requestId))
        .filter((text): text is string => Boolean(text)),
      reviewer_notes: [],
      evidence_strength: scoreEvidenceStrength({
        evidenceType: label.evidence_type,
        sourceConfidence: label.source_confidence,
        presentation,
        combinedText,
        reviewTitle,
      }),
      evidence_status: resolveEvidenceStatus(label.case_document_id),
    })

    linkDiagnostics.push({
      evidence_label: label.label,
      title: reviewTitle,
      linked_finding_count: evidenceLinks.linked_finding_ids.length,
      linked_theme_count: evidenceLinks.linked_theme_ids.length,
      link_reasons: evidenceLinks.link_reasons.length
        ? evidenceLinks.link_reasons
        : ["no deterministic link matched"],
    })
  }

  return { evidence_items: evidenceItems, link_diagnostics: linkDiagnostics }
}
