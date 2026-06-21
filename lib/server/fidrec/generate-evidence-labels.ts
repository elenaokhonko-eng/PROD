import { detectExcludedEvidenceType } from "@/lib/server/fidrec/evidence-relevance"
import { createServiceClient } from "@/lib/supabase/service"
import type { CaseDocumentRow } from "@/lib/types/documents"
import type {
  EvidenceLabel,
  EvidenceLabelSourceConfidence,
  FidrecEvidenceType,
  GenerateEvidenceLabelsInput,
  GenerateEvidenceLabelsResult,
} from "@/lib/types/fidrec-evidence-labels"
import type {
  CaseAssertionFindingLinkRow,
  CaseBankAssertionRow,
  CaseEvidenceRequestRow,
  CaseFindingRow,
  CaseThemeLinkRow,
} from "@/lib/types/fidrec"

const EVIDENCE_TYPE_ORDER: readonly FidrecEvidenceType[] = [
  "bank_final_response",
  "bank_investigation_report",
  "customer_narrative",
  "police_report",
  "statutory_declaration",
  "transaction_history",
  "token_registration_record",
  "authentication_record",
  "device_or_ip_record",
  "sms_or_email_alert",
  "hotline_call_record",
  "fraud_monitoring_record",
  "containment_record",
  "bank_email_or_letter",
  "merchant_record",
  "screenshot",
  "other",
]

const EVIDENCE_TYPE_RANK = new Map(EVIDENCE_TYPE_ORDER.map((type, index) => [type, index]))

const TITLE_TEMPLATES: Record<FidrecEvidenceType, string> = {
  bank_final_response: "Bank Final Response",
  bank_investigation_report: "Bank Investigation Report",
  bank_email_or_letter: "Bank Email or Letter",
  transaction_history: "Transaction History",
  police_report: "Police Report",
  statutory_declaration: "Statutory Declaration",
  hotline_call_record: "Fraud Hotline Call Record",
  sms_or_email_alert: "SMS or Email Alert",
  token_registration_record: "Digital Token Registration Record",
  authentication_record: "Authentication Record",
  device_or_ip_record: "Device or IP Record",
  fraud_monitoring_record: "Fraud Monitoring Record",
  containment_record: "Containment Record",
  customer_narrative: "Customer Narrative",
  merchant_record: "Merchant Record",
  screenshot: "Screenshot",
  flight_itinerary: "Flight Itinerary",
  travel_document: "Travel Document",
  identity_document: "Identity Document",
  news_article: "News Article",
  other: "Supporting Document",
}

const PROCESSED_TYPE_MAP: Record<string, FidrecEvidenceType> = {
  BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY: "bank_final_response",
  BANK_SRF_INVESTIGATION_REPORT_OR_OFFICIAL_RESPONSE: "bank_investigation_report",
  BANK_EMAILS_OR_COMMUNICATIONS_ADDITIONAL: "bank_email_or_letter",
  BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS: "transaction_history",
  CREDIT_CARD_STATEMENT_SHOWING_TRANSACTIONS: "transaction_history",
  POLICE_REPORT_OF_FRAUD_SCAM: "police_report",
  BANK_SCAM_FRAUD_HOTLINE_CALL_LOG: "hotline_call_record",
  BANK_SCAM_FRAUD_HOTLINE_CALL_RECORDING: "hotline_call_record",
  SMS_LOG_ALL_TRANSACTION_NOTIFICATIONS: "sms_or_email_alert",
  SMS_LOG_TOKEN_BINDING_NOTIFICATIONS: "token_registration_record",
  SMS_LOG_BANK_ACCOUNT_LIMIT_NOTIFICATIONS: "sms_or_email_alert",
  SMS_LOG_CREDIT_CARD_BLOCKING_NOTIFICATIONS: "sms_or_email_alert",
  RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA: "device_or_ip_record",
  PHISHING_EMAIL_COPY_OR_DESCRIPTION: "screenshot",
  TIMELINE_NOTES: "customer_narrative",
  TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK: "customer_narrative",
  CYBER_EXPERT_REPORT: "other",
  OTHER: "other",
}

const LEGACY_DECLARED_TYPE_MAP: Record<string, FidrecEvidenceType> = {
  BANK_STATEMENT: "transaction_history",
  ACCOUNT_STATEMENT: "transaction_history",
  CREDIT_CARD_STATEMENT: "transaction_history",
  POLICE_REPORT: "police_report",
  STATUTORY_DECLARATION: "statutory_declaration",
  HOTLINE_RECORD: "hotline_call_record",
  BANK_FINAL_RESPONSE: "bank_final_response",
  BANK_COMMS: "bank_email_or_letter",
  BANK_EMAILS: "bank_email_or_letter",
  EMAIL: "bank_email_or_letter",
  USER_LOGS: "device_or_ip_record",
  LOGIN_LOGS: "authentication_record",
  IP_LOGS: "device_or_ip_record",
  FRAUD_SCREENSHOTS: "screenshot",
}

const FILENAME_TYPE_PATTERNS: Array<{ pattern: RegExp; type: FidrecEvidenceType }> = [
  { pattern: /\b(bank\s*final|final\s*response|dispute\s*response|official\s*response)\b/i, type: "bank_final_response" },
  { pattern: /\b(srf|investigation\s*report|bank\s*investigation)\b/i, type: "bank_investigation_report" },
  { pattern: /\b(police\s*report|police\s*statement|spf\s*report)\b/i, type: "police_report" },
  { pattern: /\b(statutory\s*declaration|stat\s*dec)\b/i, type: "statutory_declaration" },
  { pattern: /\b(transaction\s*history|bank\s*statement|account\s*statement|card\s*statement)\b/i, type: "transaction_history" },
  { pattern: /\b(token\s*registration|digital\s*token|sms\s*token)\b/i, type: "token_registration_record" },
  { pattern: /\b(hotline|call\s*log|call\s*record)\b/i, type: "hotline_call_record" },
  { pattern: /\b(authentication|3ds|otp|login\s*record)\b/i, type: "authentication_record" },
  { pattern: /\b(device|ip\s*log|fingerprint)\b/i, type: "device_or_ip_record" },
  { pattern: /\b(fraud\s*monitor|anomaly|velocity)\b/i, type: "fraud_monitoring_record" },
  { pattern: /\b(containment|freeze|block)\b/i, type: "containment_record" },
  { pattern: /\b(sms|email\s*alert|notification)\b/i, type: "sms_or_email_alert" },
  { pattern: /\b(customer\s*narrative|timeline|affidavit)\b/i, type: "customer_narrative" },
  { pattern: /\b(merchant|invoice|receipt)\b/i, type: "merchant_record" },
  { pattern: /\b(screenshot|screen\s*grab|capture)\b/i, type: "screenshot" },
]

export const EVIDENCE_CATEGORY_TO_TYPES: Record<string, readonly FidrecEvidenceType[]> = {
  bank_communication: ["bank_email_or_letter", "bank_final_response"],
  hotline_record: ["hotline_call_record"],
  transaction_record: ["transaction_history"],
  notification_record: ["sms_or_email_alert"],
  authentication_record: ["authentication_record", "token_registration_record"],
  device_or_ip_record: ["device_or_ip_record"],
  police_or_statutory: ["police_report", "statutory_declaration"],
  customer_context: ["customer_narrative"],
  bank_particulars: ["bank_investigation_report", "fraud_monitoring_record", "containment_record"],
  other: ["other"],
}

const MATERIAL_RELATIONSHIPS = new Set([
  "supports_bank_assertion",
  "requires_particulars",
  "partially_rebuts",
  "rebuts_bank_assertion",
])

type DocumentExtractionContext = {
  predictedProcessedType: string | null
  extractedText: string | null
  extractionConfidence: number | null
  verificationDecision: string | null
  documentDate: string | null
}

type PreparedDocument = {
  document: CaseDocumentRow
  extraction: DocumentExtractionContext
  evidenceType: FidrecEvidenceType
  sourceConfidence: EvidenceLabelSourceConfidence
}

type LinkContext = {
  assertionsByDocumentId: Map<string, CaseBankAssertionRow[]>
  findingsById: Map<string, CaseFindingRow>
  materialLinks: CaseAssertionFindingLinkRow[]
  themeLinks: CaseThemeLinkRow[]
  evidenceRequests: CaseEvidenceRequestRow[]
}

function normalizeProcessedTypeKey(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed ? trimmed.toUpperCase() : null
}

function mapProcessedType(value: string | null | undefined): FidrecEvidenceType | null {
  const key = normalizeProcessedTypeKey(value)
  if (!key) return null
  return PROCESSED_TYPE_MAP[key] ?? LEGACY_DECLARED_TYPE_MAP[key] ?? null
}

function inferTypeFromFilename(filename: string | null | undefined): FidrecEvidenceType | null {
  if (!filename?.trim()) return null
  for (const entry of FILENAME_TYPE_PATTERNS) {
    if (entry.pattern.test(filename)) {
      return entry.type
    }
  }
  return null
}

function inferTypeFromMimeType(mimeType: string | null | undefined): FidrecEvidenceType | null {
  if (!mimeType) return null
  if (mimeType.startsWith("image/")) {
    return "screenshot"
  }
  return null
}

export function normalizeEvidenceType(input: {
  verifiedDocumentType?: string | null
  predictedDocumentType?: string | null
  declaredDocumentType?: string | null
  filename?: string | null
  mimeType?: string | null
}): { evidenceType: FidrecEvidenceType; sourceConfidence: EvidenceLabelSourceConfidence } {
  const verifiedMapped = mapProcessedType(input.verifiedDocumentType)
  if (verifiedMapped) {
    return { evidenceType: verifiedMapped, sourceConfidence: "high" }
  }

  const predictedMapped = mapProcessedType(input.predictedDocumentType)
  if (predictedMapped) {
    return { evidenceType: predictedMapped, sourceConfidence: "medium" }
  }

  const declaredMapped = mapProcessedType(input.declaredDocumentType)
  if (declaredMapped) {
    return { evidenceType: declaredMapped, sourceConfidence: "medium" }
  }

  const filenameMapped = inferTypeFromFilename(input.filename)
  if (filenameMapped) {
    return { evidenceType: filenameMapped, sourceConfidence: "low" }
  }

  const mimeMapped = inferTypeFromMimeType(input.mimeType)
  if (mimeMapped) {
    return { evidenceType: mimeMapped, sourceConfidence: "low" }
  }

  return { evidenceType: "other", sourceConfidence: "low" }
}

function parseDocumentDateFromTransactions(transactions: unknown): string | null {
  if (!Array.isArray(transactions)) return null

  for (const entry of transactions) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const date = (entry as Record<string, unknown>).date
    if (typeof date === "string" && date.trim()) {
      return date.trim()
    }
  }

  return null
}

function formatTitleDate(documentDate: string | null): string | null {
  if (!documentDate) return null

  const parsed = Date.parse(documentDate)
  if (Number.isNaN(parsed)) {
    return documentDate
  }

  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(new Date(parsed))
}

function buildBaseTitle(evidenceType: FidrecEvidenceType, originalFilename: string | null): string {
  if (evidenceType === "other" && originalFilename?.trim()) {
    const withoutExtension = originalFilename.replace(/\.[^.]+$/, "").trim()
    if (withoutExtension.length >= 4) {
      return withoutExtension.slice(0, 80)
    }
  }

  return TITLE_TEMPLATES[evidenceType]
}

function assignDistinctTitles(preparedDocuments: PreparedDocument[]): Map<string, string> {
  const titlesByDocumentId = new Map<string, string>()
  const baseTitleCounts = new Map<string, number>()
  const screenshotCounts = new Map<string, number>()

  for (const prepared of preparedDocuments) {
    const documentId = prepared.document.id
    const baseTitle = buildBaseTitle(prepared.evidenceType, prepared.document.original_filename)
    const formattedDate = formatTitleDate(prepared.extraction.documentDate)

    if (prepared.evidenceType === "screenshot") {
      const nextCount = (screenshotCounts.get("screenshot") ?? 0) + 1
      screenshotCounts.set("screenshot", nextCount)
      titlesByDocumentId.set(documentId, `Screenshot ${nextCount}`)
      continue
    }

    const seenCount = baseTitleCounts.get(baseTitle) ?? 0
    baseTitleCounts.set(baseTitle, seenCount + 1)

    if (seenCount === 0) {
      titlesByDocumentId.set(documentId, baseTitle)
      continue
    }

    if (formattedDate) {
      titlesByDocumentId.set(documentId, `${baseTitle} — ${formattedDate}`)
      continue
    }

    titlesByDocumentId.set(documentId, `${baseTitle} ${seenCount + 1}`)
  }

  return titlesByDocumentId
}

function buildShortDescription(input: {
  title: string
  extractedText: string | null
  originalFilename: string | null
}): string {
  const summary = input.extractedText?.trim()
  if (summary) {
    return summary.length > 240 ? `${summary.slice(0, 237).trim()}...` : summary
  }

  const filename = input.originalFilename?.trim() || "unknown filename"
  return `Document identified as ${input.title}. Original uploaded filename: ${filename}.`
}

function comparePreparedDocuments(left: PreparedDocument, right: PreparedDocument): number {
  const leftRank = EVIDENCE_TYPE_RANK.get(left.evidenceType) ?? 999
  const rightRank = EVIDENCE_TYPE_RANK.get(right.evidenceType) ?? 999
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  const leftDate = left.extraction.documentDate ?? ""
  const rightDate = right.extraction.documentDate ?? ""
  if (leftDate !== rightDate) {
    return leftDate < rightDate ? -1 : 1
  }

  const leftUploaded = left.document.upload_date ?? ""
  const rightUploaded = right.document.upload_date ?? ""
  if (leftUploaded !== rightUploaded) {
    return leftUploaded < rightUploaded ? -1 : 1
  }

  return left.document.id < right.document.id ? -1 : left.document.id > right.document.id ? 1 : 0
}

function buildLinkContext(input: {
  assertions: CaseBankAssertionRow[]
  findings: CaseFindingRow[]
  links: CaseAssertionFindingLinkRow[]
  themeLinks: CaseThemeLinkRow[]
  evidenceRequests: CaseEvidenceRequestRow[]
}): LinkContext {
  const assertionsByDocumentId = new Map<string, CaseBankAssertionRow[]>()

  for (const assertion of input.assertions) {
    if (!assertion.source_document_id) continue
    const list = assertionsByDocumentId.get(assertion.source_document_id) ?? []
    list.push(assertion)
    assertionsByDocumentId.set(assertion.source_document_id, list)
  }

  return {
    assertionsByDocumentId,
    findingsById: new Map(input.findings.map((finding) => [finding.id, finding])),
    materialLinks: input.links.filter((link) => MATERIAL_RELATIONSHIPS.has(link.relationship)),
    themeLinks: input.themeLinks,
    evidenceRequests: input.evidenceRequests,
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function extractSupportingEvidenceStrings(finding: CaseFindingRow): string[] {
  if (!Array.isArray(finding.supporting_evidence)) {
    return []
  }

  return finding.supporting_evidence.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
}

function buildDocumentLinks(input: {
  documentId: string
  extractedText: string | null
  evidenceType: FidrecEvidenceType
  linkContext: LinkContext
}): {
  linkedFindingIds: string[]
  linkedThemeIds: string[]
  linkedEvidenceRequestIds: string[]
} {
  const linkedFindingIds = new Set<string>()
  const linkedThemeIds = new Set<string>()
  const linkedEvidenceRequestIds = new Set<string>()

  const relatedAssertions = input.linkContext.assertionsByDocumentId.get(input.documentId) ?? []
  const relatedAssertionIds = new Set(relatedAssertions.map((assertion) => assertion.id))

  for (const link of input.linkContext.materialLinks) {
    if (!relatedAssertionIds.has(link.bank_assertion_id)) continue
    linkedFindingIds.add(link.finding_id)
  }

  const normalizedExtractedText = input.extractedText?.trim().toLowerCase() ?? ""
  if (normalizedExtractedText) {
    for (const finding of input.linkContext.findingsById.values()) {
      for (const evidenceText of extractSupportingEvidenceStrings(finding)) {
        const normalizedEvidence = evidenceText.trim().toLowerCase()
        if (normalizedEvidence.length >= 24 && normalizedExtractedText.includes(normalizedEvidence)) {
          linkedFindingIds.add(finding.id)
        }
      }
    }
  }

  for (const themeLink of input.linkContext.themeLinks) {
    if (themeLink.finding_id && linkedFindingIds.has(themeLink.finding_id)) {
      linkedThemeIds.add(themeLink.theme_id)
    }
    if (themeLink.bank_assertion_id && relatedAssertionIds.has(themeLink.bank_assertion_id)) {
      linkedThemeIds.add(themeLink.theme_id)
    }
  }

  for (const request of input.linkContext.evidenceRequests) {
    const mappedTypes = EVIDENCE_CATEGORY_TO_TYPES[request.evidence_category] ?? ["other"]
    if (mappedTypes.includes(input.evidenceType)) {
      linkedEvidenceRequestIds.add(request.id)
    }
  }

  return {
    linkedFindingIds: uniqueStrings([...linkedFindingIds]),
    linkedThemeIds: uniqueStrings([...linkedThemeIds]),
    linkedEvidenceRequestIds: uniqueStrings([...linkedEvidenceRequestIds]),
  }
}

export function matchEvidenceLabelToRequest(input: {
  evidenceLabels: EvidenceLabel[]
  request: CaseEvidenceRequestRow
  assignedDocumentIds: Set<string>
}): EvidenceLabel | null {
  const compatibleTypes = EVIDENCE_CATEGORY_TO_TYPES[input.request.evidence_category] ?? ["other"]
  const candidates = input.evidenceLabels.filter(
    (label) =>
      compatibleTypes.includes(label.evidence_type) &&
      !input.assignedDocumentIds.has(label.case_document_id),
  )

  if (candidates.length !== 1) {
    return null
  }

  return candidates[0] ?? null
}

async function loadDocumentExtractions(caseId: string): Promise<Map<string, DocumentExtractionContext>> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("case_document_extractions")
    .select("document_id, extracted_text, extracted_json, confidence, extraction_type, created_at")
    .eq("case_id", caseId)
    .in("extraction_type", ["doc_summary_v3", "transactions_v1"])
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to load case_document_extractions rows: ${error.message}`)
  }

  const byDocumentId = new Map<string, DocumentExtractionContext>()

  for (const row of data ?? []) {
    const documentId = row.document_id as string
    const existing = byDocumentId.get(documentId) ?? {
      predictedProcessedType: null,
      extractedText: null,
      extractionConfidence: null,
      verificationDecision: null,
      documentDate: null,
    }

    const extractedJson =
      row.extracted_json && typeof row.extracted_json === "object" && !Array.isArray(row.extracted_json)
        ? (row.extracted_json as Record<string, unknown>)
        : null

    if (row.extraction_type === "doc_summary_v3") {
      const predicted = extractedJson?.predicted_document_type
      existing.predictedProcessedType =
        typeof predicted === "string" ? predicted : existing.predictedProcessedType
      existing.extractedText =
        typeof row.extracted_text === "string" && row.extracted_text.trim()
          ? row.extracted_text.trim()
          : existing.extractedText
      existing.extractionConfidence =
        typeof row.confidence === "number" ? row.confidence : existing.extractionConfidence
      existing.verificationDecision =
        typeof extractedJson?.verification_decision === "string"
          ? extractedJson.verification_decision
          : existing.verificationDecision
    }

    if (row.extraction_type === "transactions_v1") {
      existing.documentDate =
        parseDocumentDateFromTransactions(extractedJson?.transactions) ?? existing.documentDate
    }

    byDocumentId.set(documentId, existing)
  }

  return byDocumentId
}

export async function generateEvidenceLabels(
  input: GenerateEvidenceLabelsInput,
): Promise<GenerateEvidenceLabelsResult> {
  const supabase = createServiceClient()

  const [documentsResult, assertionsResult, findingsResult, linksResult, themeLinksResult, evidenceRequestsResult, extractionsByDocumentId] =
    await Promise.all([
      supabase
        .from("case_documents")
        .select(
          "id, case_id, filename, original_filename, file_size, mime_type, document_type, exhibit_label, upload_date, file_url, is_processed, sha256, processing_status, processing_error, verified_document_type, verification_status, verification_confidence, content_latest_id, storage_provider, storage_bucket, storage_path",
        )
        .eq("case_id", input.caseId)
        .order("upload_date", { ascending: true }),
      supabase
        .from("case_bank_assertions")
        .select("id, case_id, source_document_id, assertion_text, assertion_type, bank_conclusion_supported")
        .eq("case_id", input.caseId),
      supabase
        .from("case_findings")
        .select("id, case_id, finding_text, finding_type, supporting_evidence, confidence")
        .eq("case_id", input.caseId),
      supabase
        .from("case_assertion_finding_links")
        .select("id, case_id, bank_assertion_id, finding_id, relationship")
        .eq("case_id", input.caseId),
      supabase
        .from("case_theme_links")
        .select("id, case_id, theme_id, bank_assertion_id, finding_id, evidence_request_id")
        .eq("case_id", input.caseId),
      supabase
        .from("case_evidence_requests")
        .select("id, case_id, evidence_category, status, requested_from")
        .eq("case_id", input.caseId),
      loadDocumentExtractions(input.caseId),
    ])

  if (documentsResult.error) {
    throw new Error(`Failed to load case_documents rows: ${documentsResult.error.message}`)
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
  if (themeLinksResult.error) {
    throw new Error(`Failed to load case_theme_links rows: ${themeLinksResult.error.message}`)
  }
  if (evidenceRequestsResult.error) {
    throw new Error(`Failed to load case_evidence_requests rows: ${evidenceRequestsResult.error.message}`)
  }

  const documents = (documentsResult.data ?? []) as CaseDocumentRow[]
  const linkContext = buildLinkContext({
    assertions: (assertionsResult.data ?? []) as CaseBankAssertionRow[],
    findings: (findingsResult.data ?? []) as CaseFindingRow[],
    links: (linksResult.data ?? []) as CaseAssertionFindingLinkRow[],
    themeLinks: (themeLinksResult.data ?? []) as CaseThemeLinkRow[],
    evidenceRequests: (evidenceRequestsResult.data ?? []) as CaseEvidenceRequestRow[],
  })

  const preparedDocuments: PreparedDocument[] = documents.map((document) => {
    const extraction = extractionsByDocumentId.get(document.id) ?? {
      predictedProcessedType: null,
      extractedText: null,
      extractionConfidence: null,
      verificationDecision: null,
      documentDate: null,
    }

    const normalized = normalizeEvidenceType({
      verifiedDocumentType: document.verified_document_type,
      predictedDocumentType: extraction.predictedProcessedType,
      declaredDocumentType: document.document_type,
      filename: document.original_filename || document.filename,
      mimeType: document.mime_type,
    })

    const classificationCorpus = [
      document.verified_document_type,
      extraction.predictedProcessedType,
      extraction.extractedText,
      document.original_filename || document.filename,
    ]
      .filter(Boolean)
      .join(" ")

    const excludedType = detectExcludedEvidenceType(classificationCorpus)

    return {
      document,
      extraction,
      evidenceType: excludedType ?? normalized.evidenceType,
      sourceConfidence: normalized.sourceConfidence,
    }
  })

  preparedDocuments.sort(comparePreparedDocuments)
  const titlesByDocumentId = assignDistinctTitles(preparedDocuments)

  const evidenceLabels: EvidenceLabel[] = preparedDocuments.map((prepared, index) => {
    const title = titlesByDocumentId.get(prepared.document.id) ?? TITLE_TEMPLATES[prepared.evidenceType]
    const links = buildDocumentLinks({
      documentId: prepared.document.id,
      extractedText: prepared.extraction.extractedText,
      evidenceType: prepared.evidenceType,
      linkContext,
    })

    return {
      evidence_id: prepared.document.id,
      case_document_id: prepared.document.id,
      label: `E${index + 1}`,
      label_number: index + 1,
      title,
      evidence_type: prepared.evidenceType,
      original_filename: prepared.document.original_filename ?? prepared.document.filename ?? null,
      document_date: prepared.extraction.documentDate,
      uploaded_at: prepared.document.upload_date,
      short_description: buildShortDescription({
        title,
        extractedText: prepared.extraction.extractedText,
        originalFilename: prepared.document.original_filename ?? prepared.document.filename ?? null,
      }),
      source_confidence: prepared.sourceConfidence,
      linked_finding_ids: links.linkedFindingIds,
      linked_theme_ids: links.linkedThemeIds,
      linked_evidence_request_ids: links.linkedEvidenceRequestIds,
    }
  })

  return { evidence_labels: evidenceLabels }
}
