import type {
  CasePackRegulatoryReference,
  CasePackTheme,
} from "@/lib/types/fidrec-case-pack"
import type { EvidenceLabel } from "@/lib/types/fidrec-evidence-labels"
import type { EvidenceReviewModel, EvidenceStrength } from "@/lib/types/fidrec-evidence-review"
import { buildBankPositionNarrative } from "@/lib/server/fidrec/build-bank-position-narrative"
import { buildChronologyOfEvents } from "@/lib/server/fidrec/build-chronology-of-events"
import type { EvidencePresentationContext } from "@/lib/server/fidrec/build-evidence-links"
import { buildExecutiveSummaryNarrative } from "@/lib/server/fidrec/build-executive-summary-narrative"
import type {
  BankPositionBuildDiagnostics,
  ChronologyBuildDiagnostics,
  ExecutiveSummaryBuildDiagnostics,
  ExecutiveSummaryCaseOverviewDiagnostics,
  ExecutiveSummaryCriticalFactDiagnostics,
  FidrecSubmissionPack,
  SubmissionChronologyEvent,
  SubmissionAnnexure,
  SubmissionBankPosition,
  SubmissionCustomerPosition,
  SubmissionEvidenceBundleItem,
  SubmissionEvidenceImportance,
  SubmissionIssueInDispute,
  SubmissionOutstandingEvidence,
  SubmissionPositionPoint,
  SubmissionRegulatoryFramework,
} from "@/lib/types/fidrec-submission-pack"
import type {
  AssertionFindingRelationship,
  CaseAssertionFindingLinkRow,
  CaseBankAssertionRow,
  CaseEvidenceRequestRow,
  CaseFindingRow,
} from "@/lib/types/fidrec"

export const SUBMISSION_PACK_VERSION = "fidrec_submission_pack_v1" as const

const MATERIAL_BANK_RELATIONSHIPS = new Set<AssertionFindingRelationship>([
  "supports_bank_assertion",
  "requires_particulars",
  "partially_rebuts",
  "rebuts_bank_assertion",
])

const CUSTOMER_FINDING_TYPES = new Set([
  "core_claim",
  "chronology",
  "customer_behaviour",
  "notification",
  "authentication",
  "transaction_pattern",
  "containment",
])

export type BuildFidrecSubmissionPackInput = {
  caseId: string
  findings: CaseFindingRow[]
  assertions: CaseBankAssertionRow[]
  links: CaseAssertionFindingLinkRow[]
  keyThemes: CasePackTheme[]
  openEvidenceRequests: CaseEvidenceRequestRow[]
  evidenceRequestsByThemeId: Map<string, string[]>
  evidenceLabels: EvidenceLabel[]
  evidenceReviewModel: EvidenceReviewModel
  regulatoryReferences: CasePackRegulatoryReference[]
  documentPresentationById: Map<string, EvidencePresentationContext>
  documentChunkTextById?: Map<string, string>
  extractJson?: Record<string, unknown> | null
  claimAmount?: string | number | null
  claimCurrency?: string | null
  institutionName?: string | null
  customerName?: string | null
  primaryNarrative?: string | null
}

export type BuildFidrecSubmissionPackResult = {
  pack: FidrecSubmissionPack
  chronologyDiagnostics: ChronologyBuildDiagnostics
  bankPositionDiagnostics: BankPositionBuildDiagnostics
  executiveSummaryDiagnostics: ExecutiveSummaryBuildDiagnostics
  executiveSummaryCriticalFactDiagnostics: ExecutiveSummaryCriticalFactDiagnostics
  executiveSummaryCaseOverviewDiagnostics: ExecutiveSummaryCaseOverviewDiagnostics
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, maxLength - 3).trim()}...`
}

function mapImportance(strength: EvidenceStrength): SubmissionEvidenceImportance {
  if (strength === "high") return "high"
  if (strength === "low") return "low"
  return "medium"
}

function shortenRequestText(requestText: string): string {
  const trimmed = requestText.trim()
  const firstSentence = trimmed.split(/[.!?]/)[0]?.trim()
  if (!firstSentence || firstSentence.length < 12) {
    return trimmed.length > 120 ? truncateText(trimmed, 120) : trimmed
  }
  return firstSentence.length > 120 ? truncateText(firstSentence, 120) : firstSentence
}

function buildDocumentIdToLabel(evidenceLabels: EvidenceLabel[]): Map<string, string> {
  return new Map(evidenceLabels.map((label) => [label.case_document_id, label.label]))
}

function buildCustomerPoints(input: BuildFidrecSubmissionPackInput): SubmissionPositionPoint[] {
  const documentIdToLabel = buildDocumentIdToLabel(input.evidenceLabels)
  const findingToLabels = new Map<string, string[]>()

  for (const item of input.evidenceReviewModel.evidence_items) {
    for (const findingText of item.related_findings) {
      const list = findingToLabels.get(findingText) ?? []
      list.push(item.evidence_label)
      findingToLabels.set(findingText, list)
    }
  }

  const rebutsFindingIds = new Set(
    input.links
      .filter((link) => link.relationship === "rebuts_bank_assertion" || link.relationship === "partially_rebuts")
      .map((link) => link.finding_id),
  )

  const points: SubmissionPositionPoint[] = []

  for (const finding of input.findings) {
    if (!CUSTOMER_FINDING_TYPES.has(finding.finding_type) && !rebutsFindingIds.has(finding.id)) {
      continue
    }

    points.push({
      statement: finding.finding_text,
      evidence_labels: uniqueStrings(findingToLabels.get(finding.finding_text) ?? []),
    })
  }

  return points
}

function buildCustomerPosition(input: BuildFidrecSubmissionPackInput): SubmissionCustomerPosition {
  const points = buildCustomerPoints(input)
  const narrative = points.length
    ? points.map((point) => point.statement).join(" ")
    : "The customer's position is set out in the evidence bundle and chronology below."

  return { narrative, points }
}

function buildBankPosition(input: BuildFidrecSubmissionPackInput): {
  position: SubmissionBankPosition
  diagnostics: BankPositionBuildDiagnostics
} {
  return buildBankPositionNarrative({
    assertions: input.assertions,
    evidenceLabels: input.evidenceLabels,
  })
}

function buildIssueCustomerPosition(themeId: string, input: BuildFidrecSubmissionPackInput): string {
  const statements = input.evidenceReviewModel.evidence_items
    .filter((item) =>
      item.theme_relationships.some(
        (relationship) => relationship.theme_id === themeId && relationship.ownership === "primary",
      ),
    )
    .flatMap((item) => item.related_findings)

  return uniqueStrings(statements).join(" ") || "The customer's position on this issue is supported by the evidence listed below."
}

function buildIssueBankPosition(
  themeId: string,
  input: BuildFidrecSubmissionPackInput,
): string {
  const themeFindingTexts = new Set(
    input.evidenceReviewModel.evidence_items
      .filter((item) =>
        item.theme_relationships.some(
          (relationship) => relationship.theme_id === themeId && relationship.ownership === "primary",
        ),
      )
      .flatMap((item) => item.related_findings),
  )

  const findingsById = new Map(input.findings.map((finding) => [finding.id, finding.finding_text]))

  const relevantAssertions = input.assertions.filter((assertion) =>
    input.links.some(
      (link) =>
        link.bank_assertion_id === assertion.id &&
        MATERIAL_BANK_RELATIONSHIPS.has(link.relationship) &&
        themeFindingTexts.has(findingsById.get(link.finding_id) ?? ""),
    ),
  )

  if (relevantAssertions.length) {
    return relevantAssertions.map((assertion) => assertion.assertion_text).join(" ")
  }

  return input.assertions.map((assertion) => assertion.assertion_text).join(" ") || "The bank's position on this issue is not yet recorded."
}

function buildIssuesInDispute(input: BuildFidrecSubmissionPackInput): SubmissionIssueInDispute[] {
  return input.keyThemes.map((theme) => {
    const evidenceAvailable = uniqueStrings(
      input.evidenceReviewModel.evidence_items
        .filter((item) =>
          item.theme_relationships.some(
            (relationship) =>
              relationship.theme_id === theme.theme_id &&
              relationship.ownership === "primary" &&
              relationship.supports_coverage,
          ),
        )
        .map((item) => item.evidence_label),
    )

    return {
      issue_title: theme.issue?.trim() || theme.theme_title,
      explanation: theme.theme_summary?.trim() || theme.theme_title,
      customer_position: buildIssueCustomerPosition(theme.theme_id, input),
      bank_position: buildIssueBankPosition(theme.theme_id, input),
      evidence_available: evidenceAvailable,
      evidence_required: input.evidenceRequestsByThemeId.get(theme.theme_id) ?? [],
    }
  })
}

function buildEvidenceBundle(input: BuildFidrecSubmissionPackInput): SubmissionEvidenceBundleItem[] {
  return input.evidenceReviewModel.evidence_items.map((item) => {
    const supportsIssues = uniqueStrings(
      item.theme_relationships
        .filter((relationship) => relationship.ownership === "primary")
        .map((relationship) => relationship.theme_title),
    )

    const whyItMatters =
      item.related_findings[0]?.trim() ||
      (supportsIssues.length
        ? `Supports: ${supportsIssues.join(", ")}.`
        : "Relevant supporting document for the dispute.")

    return {
      evidence_label: item.evidence_label,
      title: item.title,
      summary: truncateText(item.description, 240),
      why_it_matters: truncateText(whyItMatters, 240),
      supports_issues: supportsIssues,
      importance: mapImportance(item.evidence_strength),
    }
  })
}

function buildOutstandingEvidence(input: BuildFidrecSubmissionPackInput): SubmissionOutstandingEvidence {
  const requestedFromBank: string[] = []
  const requestedFromCustomer: string[] = []

  for (const request of input.openEvidenceRequests) {
    const text = shortenRequestText(request.request_text)
    if (request.requested_from === "bank") {
      requestedFromBank.push(text)
    } else if (request.requested_from === "customer") {
      requestedFromCustomer.push(text)
    }
  }

  return {
    requested_from_bank: uniqueStrings(requestedFromBank),
    requested_from_customer: uniqueStrings(requestedFromCustomer),
  }
}

function buildRegulatoryFramework(
  regulatoryReferences: CasePackRegulatoryReference[],
): SubmissionRegulatoryFramework {
  const seen = new Set<string>()
  const provisions = regulatoryReferences
    .filter((reference) => {
      const key = `${reference.document_name}::${reference.clause_number}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((reference) => ({
      document_name: reference.document_name,
      clause_reference: reference.clause_number,
      clause_title: reference.clause_title,
    }))

  return {
    introductory_text:
      "The following regulatory and industry framework provisions may be relevant to the issues in dispute. This section identifies applicable guidance only and does not state breaches or allocate liability.",
    provisions,
  }
}

function buildAnnexures(evidenceLabels: EvidenceLabel[]): SubmissionAnnexure[] {
  return evidenceLabels.map((label, index) => ({
    annexure_label: `A${index + 1}`,
    evidence_label: label.label,
    title: label.title,
  }))
}

function buildExecutiveSummary(
  input: BuildFidrecSubmissionPackInput,
  chronologyEvents: SubmissionChronologyEvent[],
) {
  const result = buildExecutiveSummaryNarrative({
    findings: input.findings,
    assertions: input.assertions,
    keyThemes: input.keyThemes,
    evidenceLabels: input.evidenceLabels,
    documentPresentationById: input.documentPresentationById,
    documentChunkTextById: input.documentChunkTextById,
    chronologyEvents,
    extractJson: input.extractJson,
    claimAmount: input.claimAmount,
    claimCurrency: input.claimCurrency,
    institutionName: input.institutionName,
    customerName: input.customerName,
    primaryNarrative: input.primaryNarrative,
  })

  return {
    narrative: result.narrative,
    diagnostics: result.facts,
    criticalFactDiagnostics: result.criticalFactDiagnostics,
    caseOverviewDiagnostics: result.caseOverviewDiagnostics,
  }
}

export function buildFidrecSubmissionPack(input: BuildFidrecSubmissionPackInput): BuildFidrecSubmissionPackResult {
  const chronology = buildChronologyOfEvents({
    findings: input.findings,
    assertions: input.assertions,
    evidenceLabels: input.evidenceLabels,
    evidenceReviewModel: input.evidenceReviewModel,
    documentPresentationById: input.documentPresentationById,
  })

  const bankPosition = buildBankPosition(input)
  const executiveSummary = buildExecutiveSummary(input, chronology.events)

  return {
    pack: {
      case_id: input.caseId,
      generated_at: new Date().toISOString(),
      pack_version: SUBMISSION_PACK_VERSION,
      executive_summary: { narrative: executiveSummary.narrative },
      chronology_of_events: chronology.events,
      customer_position: buildCustomerPosition(input),
      bank_position: bankPosition.position,
      issues_in_dispute: buildIssuesInDispute(input),
      evidence_bundle: buildEvidenceBundle(input),
      outstanding_evidence: buildOutstandingEvidence(input),
      applicable_regulatory_framework: buildRegulatoryFramework(input.regulatoryReferences),
      annexures: buildAnnexures(input.evidenceLabels),
    },
    chronologyDiagnostics: chronology.diagnostics,
    bankPositionDiagnostics: bankPosition.diagnostics,
    executiveSummaryDiagnostics: executiveSummary.diagnostics,
    executiveSummaryCriticalFactDiagnostics: executiveSummary.criticalFactDiagnostics,
    executiveSummaryCaseOverviewDiagnostics: executiveSummary.caseOverviewDiagnostics,
  }
}
