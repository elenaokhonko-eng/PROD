/**
 * WARNING: Local dev dry-run only.
 *
 * This script uses server-side helpers and service-role database access.
 * Do not run this in production environments.
 *
 * Required env:
 * - TEST_CASE_ID
 * - OPENAI_API_KEY
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 * - TEST_SOURCE_DOCUMENT_ID
 * - REGRESSION_OUTPUT_PATH — write JSON snapshot after run
 * - REGRESSION_BASELINE_PATH — compare run output against baseline JSON (review-only)
 */

import "./load-local-env.ts"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { extractAndPersistBankAssertions } from "../lib/server/fidrec/extract-bank-assertions.ts"
import { generateAndPersistCaseFindings } from "../lib/server/fidrec/generate-case-findings.ts"
import { generateAndPersistCaseThemes } from "../lib/server/fidrec/generate-case-themes.ts"
import { generateAndPersistEvidenceRequests } from "../lib/server/fidrec/generate-evidence-requests.ts"
import { generateAndPersistInvestigationQuestions } from "../lib/server/fidrec/generate-investigation-questions.ts"
import { linkAssertionsAndFindings } from "../lib/server/fidrec/link-assertions-findings.ts"
import { retrieveThemeRegulatoryClauses } from "../lib/server/fidrec/retrieve-theme-regulatory-clauses.ts"
import type { ThemeRegulatoryRetrievalResult } from "../lib/server/fidrec/retrieve-theme-regulatory-clauses.ts"
import {
  buildThemeRegulatoryCitations,
  type ThemeRegulatoryCitation,
} from "../lib/server/fidrec/build-theme-regulatory-citations.ts"
import { generateCasePackJson } from "../lib/server/fidrec/generate-case-pack-json.ts"
import type { FidrecCasePackGenerationResult } from "../lib/types/fidrec-case-pack.ts"
import type {
  BankPositionBuildDiagnostics,
  ChronologyBuildDiagnostics,
  ExecutiveSummaryBuildDiagnostics,
  ExecutiveSummaryCaseOverviewDiagnostics,
  ExecutiveSummaryCriticalFactDiagnostics,
  ExecutiveSummaryFacts,
  FactValue,
  FidrecSubmissionPack,
} from "../lib/types/fidrec-submission-pack.ts"
import type { EvidenceLabel } from "../lib/types/fidrec-evidence-labels.ts"
import type { EvidenceCoverageMatrix, EvidenceReviewModel } from "../lib/types/fidrec-evidence-review.ts"
import { createServiceClient } from "../lib/supabase/service.ts"

type AssertionRow = {
  id: string
  assertion_text: string
  assertion_type: string
  bank_conclusion_supported: string | null
  created_at: string
}

type FindingRow = {
  id: string
  finding_text: string
  finding_type: string
  confidence: string
  created_at: string
}

type LinkRow = {
  id: string
  bank_assertion_id: string
  finding_id: string
  relationship: string
  confidence: string
  explanation: string | null
  created_at: string
}

type QuestionRow = {
  id: string
  source_assertion_id: string | null
  source_finding_id: string | null
  source_link_id: string | null
  question_text: string
  question_type: string
  priority: string
  raw_model_output: Record<string, unknown> | null
  created_at: string
}

type EvidenceRequestRow = {
  id: string
  source_question_id: string | null
  source_assertion_id: string | null
  request_text: string
  requested_from: string
  evidence_category: string
  priority: string
  created_at: string
}

type RegressionSnapshot = {
  caseId: string
  generatedAt: string
  counts: {
    bankAssertions: number
    caseFindings: number
    links: number
    investigationQuestions: number
    evidenceRequests: number
  }
  bankAssertions: Array<{
    assertion_text: string
    assertion_type: string
    bank_conclusion_supported: string | null
  }>
  caseFindings: Array<{
    finding_text: string
    finding_type: string
    confidence: string
  }>
  links: Array<{
    bank_assertion_text: string
    finding_text: string
    relationship: string
    confidence: string
  }>
  investigationQuestions: Array<{
    question_text: string
    question_type: string
    priority: string
  }>
  evidenceRequests: Array<{
    request_text: string
    evidence_category: string
    requested_from: string
    priority: string
  }>
  submission_pack?: FidrecSubmissionPack
}

const MATERIAL_RELATIONSHIPS = new Set([
  "supports_bank_assertion",
  "requires_particulars",
  "partially_rebuts",
  "rebuts_bank_assertion",
])

const SAMPLE_BANK_FINAL_RESPONSE = `Dear Sir / Madam
Your recent dispute request(s) on your card transaction is/are unsuccessful following our investigation.
The transaction(s) you indicated cannot be disputed as it falls under one of the following descriptions:
1. 3D Secure transactions are authenticated during the purchase.
2. Contactless transactions require physical or digital cards (mobile wallet device) to be presented during the purchase.
3. EMV Chip transactions require physical cards to be presented during the purchase.
Thank you for banking with us.
Yours faithfully
DBS Bank Ltd`

const SAMPLE_PROCESSED_EVIDENCE_JSON = {
  evidence: [
    {
      type: "hotline_call_log",
      summary: "Customer called the bank fraud hotline at 09:21 on 23 October after discovering disputed transactions.",
    },
    {
      type: "transaction_statement",
      summary: "Five disputed transactions occurred within 18 minutes.",
    },
    {
      type: "sms_token_binding",
      summary: "A new digital token was registered before the disputed transactions.",
    },
  ],
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function printEnvPresence(name: string) {
  const value = process.env[name]?.trim()
  console.log(`${name}: ${value ? "present" : "missing"}`)
}

type ThemeRow = {
  id: string
  theme_type: string
  theme_title: string
  theme_summary: string | null
  priority: string
}

function getQuestionThemeId(question: QuestionRow): string | null {
  const themeId = question.raw_model_output?.source_theme_id
  return typeof themeId === "string" && themeId.trim() ? themeId.trim() : null
}

function isThemeLevelQuestion(question: QuestionRow): boolean {
  return getQuestionThemeId(question) !== null
}

function questionMatchesAssertionForCompactSummary(question: QuestionRow, assertionId: string): boolean {
  if (isThemeLevelQuestion(question)) {
    return false
  }
  return question.source_assertion_id === assertionId
}

function isMaterialLink(link: LinkRow): boolean {
  return MATERIAL_RELATIONSHIPS.has(link.relationship)
}

function getMaterialLinks(links: LinkRow[]): LinkRow[] {
  return links.filter(isMaterialLink)
}

function formatRelationshipLabel(relationship: string): string {
  return relationship.replaceAll("_", " ")
}

function getQuestionIssueText(question: QuestionRow): string | null {
  const investigationIssue = question.raw_model_output?.investigation_issue
  if (!investigationIssue || typeof investigationIssue !== "object") return null
  const issueText = (investigationIssue as Record<string, unknown>).issue_text
  return typeof issueText === "string" ? issueText : null
}

function evidenceRequestMatchesAssertion(
  request: EvidenceRequestRow,
  assertionId: string,
  relatedQuestionIds: Set<string>,
): boolean {
  if (request.source_question_id && relatedQuestionIds.has(request.source_question_id)) {
    return true
  }
  if (request.source_assertion_id === assertionId && !request.source_question_id) {
    return true
  }
  return false
}

function countMultiset(items: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return counts
}

function diffMultiset(
  baseline: string[],
  current: string[],
): { added: string[]; removed: string[] } {
  const baselineCounts = countMultiset(baseline)
  const currentCounts = countMultiset(current)
  const added: string[] = []
  const removed: string[] = []

  for (const [value, count] of currentCounts) {
    const baselineCount = baselineCounts.get(value) ?? 0
    for (let i = 0; i < count - baselineCount; i += 1) {
      added.push(value)
    }
  }

  for (const [value, count] of baselineCounts) {
    const currentCount = currentCounts.get(value) ?? 0
    for (let i = 0; i < count - currentCount; i += 1) {
      removed.push(value)
    }
  }

  return { added, removed }
}

function buildRegressionSnapshot(
  caseId: string,
  assertions: AssertionRow[],
  findings: FindingRow[],
  links: LinkRow[],
  questions: QuestionRow[],
  evidenceRequests: EvidenceRequestRow[],
): RegressionSnapshot {
  const assertionById = new Map(assertions.map((row) => [row.id, row]))
  const findingById = new Map(findings.map((row) => [row.id, row]))

  return {
    caseId,
    generatedAt: new Date().toISOString(),
    counts: {
      bankAssertions: assertions.length,
      caseFindings: findings.length,
      links: links.length,
      investigationQuestions: questions.length,
      evidenceRequests: evidenceRequests.length,
    },
    bankAssertions: assertions.map((row) => ({
      assertion_text: row.assertion_text,
      assertion_type: row.assertion_type,
      bank_conclusion_supported: row.bank_conclusion_supported,
    })),
    caseFindings: findings.map((row) => ({
      finding_text: row.finding_text,
      finding_type: row.finding_type,
      confidence: row.confidence,
    })),
    links: links.map((row) => ({
      bank_assertion_text:
        assertionById.get(row.bank_assertion_id)?.assertion_text ?? "(missing assertion)",
      finding_text: findingById.get(row.finding_id)?.finding_text ?? "(missing finding)",
      relationship: row.relationship,
      confidence: row.confidence,
    })),
    investigationQuestions: questions.map((row) => ({
      question_text: row.question_text,
      question_type: row.question_type,
      priority: row.priority,
    })),
    evidenceRequests: evidenceRequests.map((row) => ({
      request_text: row.request_text,
      evidence_category: row.evidence_category,
      requested_from: row.requested_from,
      priority: row.priority,
    })),
  }
}

function printThemeRegulatoryRetrieval(results: ThemeRegulatoryRetrievalResult[]) {
  console.log("\n=== Tier-3 Theme Regulatory Retrieval ===")
  if (!results.length) {
    console.log("(no open themes)")
    return
  }

  for (const result of results) {
    console.log(`\nTheme:\n${result.theme_title}`)
    console.log("\nRetrieved clauses:")
    if (!result.clauses.length) {
      console.log("(none)")
      console.log("\nSimilarity scores:")
      console.log("(none)")
      continue
    }

    for (const clause of result.clauses) {
      console.log(`• ${clause.display_label}`)
    }

    console.log("\nSimilarity scores:")
    for (const clause of result.clauses) {
      console.log(`- ${clause.similarity.toFixed(3)} — ${clause.display_label}`)
    }
  }
}

function printRegulatoryCitations(citations: ThemeRegulatoryCitation[]) {
  console.log("\n====================================")
  console.log("\n=== Regulatory Citations ===")
  if (!citations.length) {
    console.log("(no open themes)")
    return
  }

  for (const theme of citations) {
    console.log(`\nTheme:\n${theme.theme_title}`)
    console.log("\nRelevant regulatory references:")
    if (!theme.citations.length) {
      console.log("(none)")
      continue
    }

    for (const citation of theme.citations) {
      console.log(`\n• ${citation.document_name}`)
      console.log(`Clause: ${citation.clause_number ?? "(none)"}`)
      console.log(`Title: ${citation.clause_title ?? "(none)"}`)
      console.log(`Summary: ${citation.clause_summary}`)
    }
  }
}

function getThemeQuestions(themeId: string, questions: QuestionRow[]): QuestionRow[] {
  return questions.filter((question) => getQuestionThemeId(question) === themeId)
}

function getThemeEvidenceRequests(
  themeQuestions: QuestionRow[],
  evidenceRequests: EvidenceRequestRow[],
): EvidenceRequestRow[] {
  const themeQuestionIds = new Set(themeQuestions.map((question) => question.id))
  return evidenceRequests.filter(
    (request) => request.source_question_id && themeQuestionIds.has(request.source_question_id),
  )
}

function getThemeCitationBlock(themeId: string, citations: ThemeRegulatoryCitation[]): ThemeRegulatoryCitation | undefined {
  return citations.find((theme) => theme.theme_id === themeId)
}

function printThemeRegulatoryReferences(citations: ThemeRegulatoryCitation["citations"]): void {
  if (!citations.length) {
    console.log("(none)")
    return
  }

  for (const citation of citations) {
    console.log(`\n• ${citation.document_name}`)
    console.log(`  Clause: ${citation.clause_number ?? "(none)"}`)
    console.log(`  Title: ${citation.clause_title ?? "(none)"}`)
    console.log(`  Summary: ${citation.clause_summary}`)
  }
}

function formatChronologyDateTime(eventDatetime: string | null): string {
  if (!eventDatetime) return "Undated"
  const parsed = new Date(eventDatetime)
  if (Number.isNaN(parsed.getTime())) return eventDatetime
  return parsed.toLocaleString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })
}

function formatChronologyTable(events: FidrecSubmissionPack["chronology_of_events"]): void {
  console.log("Date / Time\tType\tStatus\tEvent\tEvidence\tQuestions")
  for (const event of events) {
    const evidence = event.supporting_evidence.length ? event.supporting_evidence.join(", ") : "(none)"
    const questions = event.claimant_questions.length ? event.claimant_questions.join("; ") : "(none)"
    console.log(
      `${formatChronologyDateTime(event.event_datetime)}\t${event.event_type}\t${event.status}\t${event.event_text}\t${evidence}\t${questions}`,
    )
  }
}

function printBankPositionDiagnostics(diagnostics: BankPositionBuildDiagnostics): void {
  console.log("\n=== Bank Position Diagnostics ===")
  console.log(`Raw bank assertions: ${diagnostics.raw_bank_assertions}`)
  console.log("Grouped assertions:")
  console.log(`- authentication: ${diagnostics.grouped_assertions.authentication}`)
  console.log(`- rejection: ${diagnostics.grouped_assertions.rejection}`)
  console.log(`- customer responsibility: ${diagnostics.grouped_assertions.customer_responsibility}`)
  console.log(
    `Evidence refs used: ${diagnostics.evidence_refs_used.length ? diagnostics.evidence_refs_used.join(", ") : "(none)"}`,
  )
  console.log(`Duplicate assertions merged: ${diagnostics.duplicate_assertions_merged}`)
}

function formatFactDiagnosticValue(value: unknown): string {
  if (value === null || value === undefined) return "(none)"
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function printExecutiveSummaryDiagnostics(diagnostics: ExecutiveSummaryBuildDiagnostics): void {
  console.log("\n=== Executive Summary Fact Diagnostics ===")
  for (const [key, entry] of Object.entries(diagnostics) as Array<[keyof ExecutiveSummaryFacts, FactValue<unknown>]>) {
    const fact = entry as FactValue<unknown>
    console.log(
      `${key}: ${formatFactDiagnosticValue(fact.value)} | source: ${fact.source ?? "(none)"} | confidence: ${fact.confidence}`,
    )
  }
}

function printExecutiveSummaryCaseOverviewDiagnostics(
  diagnostics: ExecutiveSummaryCaseOverviewDiagnostics,
): void {
  console.log("\n=== Executive Summary Case Overview Diagnostics ===")
  console.log("\nclaimant_name candidates:")
  if (!diagnostics.claimant_name_candidates.length) {
    console.log("- (none)")
  } else {
    for (const candidate of diagnostics.claimant_name_candidates) {
      console.log(`- ${candidate}`)
    }
  }
  console.log(`selected: ${diagnostics.selected_claimant_name ?? "(none)"}`)
  if (diagnostics.selected_claimant_name_reason) {
    console.log(`selection_reason: ${diagnostics.selected_claimant_name_reason}`)
  }

  console.log("\nloss_amount candidates:")
  if (!diagnostics.loss_amount_candidates.length) {
    console.log("- (none)")
  } else {
    for (const candidate of diagnostics.loss_amount_candidates) {
      console.log(`- ${candidate}`)
    }
  }
  console.log(`selected: ${diagnostics.selected_loss_amount ?? "(none)"}`)
  if (diagnostics.selected_loss_amount_reason) {
    console.log(`selection_reason: ${diagnostics.selected_loss_amount_reason}`)
  }

  console.log("\nloss_breakdown:")
  if (!diagnostics.loss_breakdown.length) {
    console.log("- (none)")
  } else {
    for (const item of diagnostics.loss_breakdown) {
      console.log(`- ${item}`)
    }
  }

  console.log("\nproducts:")
  if (!diagnostics.products.length) {
    console.log("- (none)")
  } else {
    for (const product of diagnostics.products) {
      console.log(`- ${product}`)
    }
  }

  console.log("\nbank_rejection_basis:")
  if (!diagnostics.bank_rejection_basis.length) {
    console.log("- (none)")
  } else {
    for (const basis of diagnostics.bank_rejection_basis) {
      console.log(`- ${basis}`)
    }
  }
}

function printExecutiveSummaryCriticalFactDiagnostics(
  diagnostics: ExecutiveSummaryCriticalFactDiagnostics,
): void {
  console.log("\n=== Executive Summary Critical Fact Diagnostics ===")
  console.log("customer_name candidates:")
  if (!diagnostics.customer_name_candidates.length) {
    console.log("- (none)")
  } else {
    for (const candidate of diagnostics.customer_name_candidates) {
      console.log(`- ${candidate}`)
    }
  }
  console.log(`selected_customer_name: ${diagnostics.selected_customer_name ?? "(none)"}`)
  if (diagnostics.selected_customer_name_reason) {
    console.log(`selection_reason: ${diagnostics.selected_customer_name_reason}`)
  }

  console.log("\nloss_amount candidates:")
  if (!diagnostics.loss_amount_candidates.length) {
    console.log("- (none)")
  } else {
    for (const candidate of diagnostics.loss_amount_candidates) {
      console.log(`- ${candidate}`)
    }
  }
  console.log(`selected_loss_amount: ${diagnostics.selected_loss_amount ?? "(none)"}`)
  if (diagnostics.selected_loss_amount_reason) {
    console.log(`selection_reason: ${diagnostics.selected_loss_amount_reason}`)
  }

  console.log("\naccount/card candidates:")
  if (!diagnostics.account_card_candidates.length) {
    console.log("- (none)")
  } else {
    for (const candidate of diagnostics.account_card_candidates) {
      console.log(`- ${candidate}`)
    }
  }
  console.log(`selected_account_or_card: ${diagnostics.selected_account_or_card ?? "(none)"}`)
  if (diagnostics.selected_account_or_card_reason) {
    console.log(`selection_reason: ${diagnostics.selected_account_or_card_reason}`)
  }
}

function printChronologyDiagnostics(diagnostics: ChronologyBuildDiagnostics): void {
  console.log("\n=== Chronology Diagnostics ===")
  console.log(`Raw chronology candidates: ${diagnostics.raw_chronology_candidates}`)
  console.log(`Merged chronology events: ${diagnostics.merged_chronology_events}`)
  console.log(`Confirmed events: ${diagnostics.confirmed_events}`)
  console.log(`Inferred events: ${diagnostics.inferred_events}`)
  console.log(`Requires confirmation events: ${diagnostics.requires_confirmation_events}`)
  console.log(`Dropped document-only rows: ${diagnostics.dropped_document_only_rows}`)
  console.log(`Duplicate events merged: ${diagnostics.duplicate_events_merged}`)
  console.log(`Undated events: ${diagnostics.undated_events}`)
}

function printSubmissionPackPreview(submissionPack: FidrecSubmissionPack): void {
  console.log("\n====================================")
  console.log("\n=== FIDReC Submission Pack Preview ===")

  console.log("\n1. Executive Summary")
  console.log(submissionPack.executive_summary.narrative)

  console.log("\n2. Chronology of Events")
  if (!submissionPack.chronology_of_events.length) {
    console.log("(none)")
  } else {
    formatChronologyTable(submissionPack.chronology_of_events)
  }

  console.log("\n3. Customer Position")
  console.log(submissionPack.customer_position.narrative)
  for (const point of submissionPack.customer_position.points) {
    const refs = point.evidence_labels.length ? `[${point.evidence_labels.join("] [")}]` : "(no evidence refs)"
    console.log(`- ${point.statement} ${refs}`)
  }

  console.log("\n4. Bank Position")
  console.log(submissionPack.bank_position.narrative)

  console.log("\n5. Issues in Dispute")
  if (!submissionPack.issues_in_dispute.length) {
    console.log("(none)")
  } else {
    for (const issue of submissionPack.issues_in_dispute) {
      console.log(`\nIssue: ${issue.issue_title}`)
      console.log(issue.explanation)
      console.log(`Customer position: ${issue.customer_position}`)
      console.log(`Bank position: ${issue.bank_position}`)
      console.log("Evidence available:")
      printListSection("", issue.evidence_available)
      console.log("Evidence required:")
      printListSection("", issue.evidence_required)
    }
  }

  console.log("\n6. Evidence Bundle")
  if (!submissionPack.evidence_bundle.length) {
    console.log("(none)")
  } else {
    for (const item of submissionPack.evidence_bundle) {
      console.log(`\n${item.evidence_label} ${item.title}`)
      console.log(`Summary: ${item.summary}`)
      console.log(`Why it matters: ${item.why_it_matters}`)
      console.log(`Supports: ${item.supports_issues.join(", ") || "(none)"}`)
      console.log(`Importance: ${capitalizeLabel(item.importance)}`)
    }
  }

  console.log("\n7. Outstanding Evidence")
  console.log("Requested from Bank:")
  printListSection("", submissionPack.outstanding_evidence.requested_from_bank)
  console.log("Requested from Customer:")
  printListSection("", submissionPack.outstanding_evidence.requested_from_customer)

  console.log("\n8. Applicable Regulatory Framework")
  console.log(submissionPack.applicable_regulatory_framework.introductory_text)
  console.log("Relevant provisions:")
  if (!submissionPack.applicable_regulatory_framework.provisions.length) {
    console.log("(none)")
  } else {
    for (const provision of submissionPack.applicable_regulatory_framework.provisions) {
      console.log(
        `- ${provision.document_name} ${provision.clause_reference}${provision.clause_title ? ` — ${provision.clause_title}` : ""}`,
      )
    }
  }

  console.log("\n9. Annexures")
  if (!submissionPack.annexures.length) {
    console.log("(none)")
  } else {
    for (const annexure of submissionPack.annexures) {
      console.log(`${annexure.annexure_label} ${annexure.evidence_label} ${annexure.title}`)
    }
  }
}

function printEvidenceLinkDiagnostics(reviewModel: EvidenceReviewModel): void {
  console.log("\n=== Evidence Link Diagnostics ===")
  if (!reviewModel.link_diagnostics.length) {
    console.log("(none)")
    return
  }

  for (const diagnostic of reviewModel.link_diagnostics) {
    console.log(`\n${diagnostic.evidence_label} ${diagnostic.title}`)
    console.log(`Linked findings: ${diagnostic.linked_finding_count}`)
    console.log(`Linked themes: ${diagnostic.linked_theme_count}`)
    console.log(`Link reason: ${diagnostic.link_reasons.join("; ")}`)
  }
}

function printEvidenceReview(reviewModel: EvidenceReviewModel): void {
  console.log("\n=== Evidence Review ===")
  if (!reviewModel.evidence_items.length) {
    console.log("(none)")
    return
  }

  for (const item of reviewModel.evidence_items) {
    console.log(`\n${item.evidence_label} ${item.title}`)
    console.log(`Strength: ${capitalizeLabel(item.evidence_strength)}`)
    console.log(`Supports coverage: ${item.supports_coverage ? "yes" : "no"}`)
    console.log("Supports:")
    if (!item.theme_relationships.length) {
      console.log("- (none)")
    } else {
      for (const relationship of item.theme_relationships) {
        const ownershipLabel =
          relationship.ownership === "primary" ? "primary" : "secondary"
        const coverageLabel = relationship.supports_coverage ? ", counts toward coverage" : ""
        console.log(
          `- ${relationship.theme_title} (${relationship.relationship_strength}, ${ownershipLabel}${coverageLabel})`,
        )
      }
    }
    console.log("Related findings:")
    if (!item.related_findings.length) {
      console.log("- (none)")
    } else {
      for (const finding of item.related_findings) {
        console.log(`- ${finding}`)
      }
    }
    if (item.related_questions.length) {
      console.log("Related questions:")
      for (const question of item.related_questions) {
        console.log(`- ${question}`)
      }
    }
    console.log(`Status: ${capitalizeLabel(item.evidence_status)}`)
  }
}

function printEvidenceCoverageMatrix(matrix: EvidenceCoverageMatrix): void {
  console.log("\n=== Evidence Coverage Matrix ===")
  if (!matrix.themes.length) {
    console.log("(none)")
    return
  }

  for (const row of matrix.themes) {
    console.log(`\n${row.theme_title}`)
    console.log(`Coverage: ${capitalizeLabel(row.coverage_status)}`)
    console.log(`Coverage score: ${row.coverage_score.toFixed(2)}`)
    console.log(`Weighted evidence: ${row.weighted_evidence_score.toFixed(2)}`)
    console.log(`Available: ${row.available_evidence_count}`)
    console.log(`Requested: ${row.requested_evidence_count}`)
    console.log(`Missing: ${row.missing_evidence_count}`)
  }
}

function capitalizeLabel(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function printEvidenceLabels(evidenceLabels: EvidenceLabel[]): void {
  console.log("\n=== Evidence Labels ===")
  if (!evidenceLabels.length) {
    console.log("(none)")
    return
  }

  for (const label of evidenceLabels) {
    console.log(`\n${label.label} — ${label.title}`)
    console.log(`Type: ${label.evidence_type}`)
    console.log(`Source confidence: ${label.source_confidence}`)
    console.log(`Description: ${label.short_description}`)
  }
}

function printCasePackJsonSummary(casePack: FidrecCasePackGenerationResult): void {
  const submission = casePack.submission_pack
  const internal = casePack.internal_debug
  const openEvidenceRequestCount = internal.outstanding_evidence_requests.reduce(
    (total, group) => total + group.requests.length,
    0,
  )

  console.log("\n=== Submission Pack Summary ===")
  console.log(`pack_version: ${submission.pack_version}`)
  console.log(`generated_at: ${submission.generated_at}`)
  console.log(`chronology event count: ${submission.chronology_of_events.length}`)
  console.log(`issue count: ${submission.issues_in_dispute.length}`)
  console.log(`evidence bundle count: ${submission.evidence_bundle.length}`)
  console.log(`outstanding bank requests: ${submission.outstanding_evidence.requested_from_bank.length}`)
  console.log(`outstanding customer requests: ${submission.outstanding_evidence.requested_from_customer.length}`)
  console.log(`regulatory provision count: ${submission.applicable_regulatory_framework.provisions.length}`)
  console.log(`annexure count: ${submission.annexures.length}`)

  console.log("\n=== Internal Pipeline Debug (dev only) ===")
  console.log(`internal pack_version: ${internal.pack_version}`)
  console.log(`theme count: ${internal.key_themes.length}`)
  console.log(`assertion count: ${internal.bank_assertions_and_material_findings.length}`)
  console.log(`open evidence request count: ${openEvidenceRequestCount}`)
  console.log(`evidence label count: ${internal.evidence_labels.length}`)
  console.log(`evidence review item count: ${internal.evidence_review_model.evidence_items.length}`)
}

function printListSection(title: string, items: string[]) {
  console.log(`\n${title}`)
  if (!items.length) {
    console.log("(none)")
    return
  }
  for (const item of items) {
    console.log(`- ${item}`)
  }
}

function compareRegressionSnapshots(baseline: RegressionSnapshot, current: RegressionSnapshot) {
  console.log("\n=== Regression Comparison ===")
  console.log(`Baseline generatedAt: ${baseline.generatedAt}`)
  console.log(`Current generatedAt: ${current.generatedAt}`)

  console.log("\nCount differences:")
  for (const key of Object.keys(current.counts) as Array<keyof RegressionSnapshot["counts"]>) {
    const baselineCount = baseline.counts[key]
    const currentCount = current.counts[key]
    const delta = currentCount - baselineCount
    const deltaLabel = delta === 0 ? "unchanged" : delta > 0 ? `+${delta}` : `${delta}`
    console.log(`- ${key}: baseline=${baselineCount}, current=${currentCount} (${deltaLabel})`)
  }

  const assertionDiff = diffMultiset(
    baseline.bankAssertions.map((row) => row.assertion_text),
    current.bankAssertions.map((row) => row.assertion_text),
  )
  printListSection("Added assertions", assertionDiff.added)
  printListSection("Removed assertions", assertionDiff.removed)

  const findingDiff = diffMultiset(
    baseline.caseFindings.map((row) => row.finding_text),
    current.caseFindings.map((row) => row.finding_text),
  )
  printListSection("Added findings", findingDiff.added)
  printListSection("Removed findings", findingDiff.removed)

  const relationshipDiff = diffMultiset(
    baseline.links.map((row) => row.relationship),
    current.links.map((row) => row.relationship),
  )
  printListSection("Added relationship types", relationshipDiff.added)
  printListSection("Removed relationship types", relationshipDiff.removed)

  const questionDiff = diffMultiset(
    baseline.investigationQuestions.map((row) => row.question_text),
    current.investigationQuestions.map((row) => row.question_text),
  )
  printListSection("Added questions", questionDiff.added)
  printListSection("Removed questions", questionDiff.removed)

  const evidenceRequestDiff = diffMultiset(
    baseline.evidenceRequests.map((row) => row.request_text),
    current.evidenceRequests.map((row) => row.request_text),
  )
  printListSection("Added evidence requests", evidenceRequestDiff.added)
  printListSection("Removed evidence requests", evidenceRequestDiff.removed)
}

async function writeRegressionSnapshot(path: string, snapshot: RegressionSnapshot) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
  console.log(`\nRegression snapshot written to ${path}`)
}

async function loadRegressionBaseline(path: string): Promise<RegressionSnapshot> {
  const raw = await readFile(path, "utf8")
  return JSON.parse(raw) as RegressionSnapshot
}

async function main() {
  console.log("Env presence (values not shown):")
  printEnvPresence("NEXT_PUBLIC_SUPABASE_URL")
  printEnvPresence("SUPABASE_SERVICE_ROLE_KEY")
  printEnvPresence("OPENAI_API_KEY")
  console.log("")

  requiredEnv("OPENAI_API_KEY")
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL")
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY")

  const caseId = requiredEnv("TEST_CASE_ID")
  const sourceDocumentId = optionalEnv("TEST_SOURCE_DOCUMENT_ID")

  console.log("Running Tier-2 helper dry-run (local dev only)...")
  console.log(`Case ID: ${caseId}`)

  const extract = await extractAndPersistBankAssertions({
    caseId,
    sourceDocumentId: sourceDocumentId ?? null,
    bankFinalResponseText: SAMPLE_BANK_FINAL_RESPONSE,
  })

  const findings = await generateAndPersistCaseFindings({
    caseId,
    processedEvidenceJson: SAMPLE_PROCESSED_EVIDENCE_JSON,
  })

  const links = await linkAssertionsAndFindings({ caseId })

  const themesResult = await generateAndPersistCaseThemes({ caseId })

  const questions = await generateAndPersistInvestigationQuestions({ caseId })

  const evidenceRequests = await generateAndPersistEvidenceRequests({ caseId })

  const themeRegulatoryRetrieval = await retrieveThemeRegulatoryClauses({ caseId })

  const themeRegulatoryCitations = buildThemeRegulatoryCitations(themeRegulatoryRetrieval)

  const service = createServiceClient()

  const { data: assertionsData, error: assertionsError } = await service
    .from("case_bank_assertions")
    .select("id, assertion_text, assertion_type, bank_conclusion_supported, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true })
  if (assertionsError) throw new Error(`Failed to load assertions: ${assertionsError.message}`)

  const { data: findingsData, error: findingsError } = await service
    .from("case_findings")
    .select("id, finding_text, finding_type, confidence, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true })
  if (findingsError) throw new Error(`Failed to load findings: ${findingsError.message}`)

  const { data: linksData, error: linksError } = await service
    .from("case_assertion_finding_links")
    .select("id, bank_assertion_id, finding_id, relationship, confidence, explanation, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true })
  if (linksError) throw new Error(`Failed to load links: ${linksError.message}`)

  const { data: questionsData, error: questionsError } = await service
    .from("case_investigation_questions")
    .select(
      "id, source_assertion_id, source_finding_id, source_link_id, question_text, question_type, priority, raw_model_output, created_at",
    )
    .eq("case_id", caseId)
    .order("created_at", { ascending: true })
  if (questionsError) throw new Error(`Failed to load investigation questions: ${questionsError.message}`)

  const { data: evidenceRequestsData, error: evidenceRequestsError } = await service
    .from("case_evidence_requests")
    .select(
      "id, source_question_id, source_assertion_id, request_text, requested_from, evidence_category, priority, created_at",
    )
    .eq("case_id", caseId)
    .order("created_at", { ascending: true })
  if (evidenceRequestsError) {
    throw new Error(`Failed to load evidence requests: ${evidenceRequestsError.message}`)
  }

  const assertions = (assertionsData ?? []) as AssertionRow[]
  const allFindings = (findingsData ?? []) as FindingRow[]
  const allLinks = (linksData ?? []) as LinkRow[]
  const allQuestions = (questionsData ?? []) as QuestionRow[]
  const allEvidenceRequests = (evidenceRequestsData ?? []) as EvidenceRequestRow[]

  const findingById = new Map(allFindings.map((f) => [f.id, f]))
  const linksByAssertion = new Map<string, LinkRow[]>()

  for (const link of allLinks) {
    const list = linksByAssertion.get(link.bank_assertion_id) ?? []
    list.push(link)
    linksByAssertion.set(link.bank_assertion_id, list)
  }

  console.log("\n=== Counts ===")
  console.log(`Bank assertions: ${extract.bank_assertions.length}`)
  console.log(`Case findings: ${findings.case_findings.length}`)
  console.log(`Links: ${links.links.length}`)
  console.log(`Investigation questions: ${questions.investigation_questions.length}`)
  console.log(`Evidence requests: ${evidenceRequests.evidence_requests.length}`)
  console.log(`Case themes: ${themesResult.themes.length}`)

  console.log("\n=== Case Themes ===")
  if (!themesResult.themes.length) {
    console.log("(none)")
  } else {
    for (const theme of themesResult.themes as ThemeRow[]) {
      const themeLinks = themesResult.theme_links.filter((link) => link.theme_id === theme.id)
      const linkedAssertions = themeLinks.filter((link) => link.bank_assertion_id).length
      const linkedFindings = themeLinks.filter((link) => link.finding_id).length
      const themeQuestions = allQuestions.filter((question) => getQuestionThemeId(question) === theme.id)
      const themeQuestionIds = new Set(themeQuestions.map((question) => question.id))
      const themeEvidenceRequests = allEvidenceRequests.filter(
        (request) => request.source_question_id && themeQuestionIds.has(request.source_question_id),
      )

      console.log(`\nTheme: ${theme.theme_title}`)
      console.log(`  theme_type: ${theme.theme_type}`)
      console.log(`  priority: ${theme.priority}`)
      console.log(`  theme_summary: ${theme.theme_summary ?? "(none)"}`)
      console.log(`  linked assertions: ${linkedAssertions}`)
      console.log(`  linked findings: ${linkedFindings}`)
      console.log(`  linked questions: ${themeQuestions.length}`)
      console.log(`  linked evidence requests: ${themeEvidenceRequests.length}`)
      if (themeQuestions.length) {
        for (const question of themeQuestions) {
          console.log(`  investigation question: ${question.question_text}`)
        }
      }
      if (themeEvidenceRequests.length) {
        for (const request of themeEvidenceRequests) {
          console.log(`  evidence request: ${request.request_text}`)
        }
      }
    }
  }

  console.log("\n=== Theme Investigation Summary ===")
  if (!themesResult.themes.length) {
    console.log("(none)")
  } else {
    for (const theme of themesResult.themes as ThemeRow[]) {
      const themeQuestions = allQuestions.filter((question) => getQuestionThemeId(question) === theme.id)
      const themeQuestionIds = new Set(themeQuestions.map((question) => question.id))
      const themeEvidenceRequests = allEvidenceRequests.filter(
        (request) => request.source_question_id && themeQuestionIds.has(request.source_question_id),
      )

      console.log(`\nTheme: ${theme.theme_title}`)
      if (!themeQuestions.length) {
        console.log("Question: (none)")
      } else {
        for (const question of themeQuestions) {
          const issueText = getQuestionIssueText(question)
          if (issueText) {
            console.log(`Issue: ${issueText}`)
          }
          console.log(`Question: ${question.question_text}`)
        }
      }
      if (!themeEvidenceRequests.length) {
        console.log("Evidence requests: (none)")
      } else {
        console.log("Evidence requests:")
        for (const request of themeEvidenceRequests) {
          console.log(`- ${request.request_text}`)
        }
      }
    }
  }

  const casePackResult = await generateCasePackJson({ caseId })

  printSubmissionPackPreview(casePackResult.submission_pack)

  printChronologyDiagnostics(casePackResult.internal_debug.chronology_diagnostics)

  printBankPositionDiagnostics(casePackResult.internal_debug.bank_position_diagnostics)

  printExecutiveSummaryDiagnostics(casePackResult.internal_debug.executive_summary_diagnostics)

  printExecutiveSummaryCriticalFactDiagnostics(
    casePackResult.internal_debug.executive_summary_critical_fact_diagnostics,
  )

  printExecutiveSummaryCaseOverviewDiagnostics(
    casePackResult.internal_debug.executive_summary_case_overview_diagnostics,
  )

  printEvidenceLinkDiagnostics(casePackResult.internal_debug.evidence_review_model)

  printEvidenceReview(casePackResult.internal_debug.evidence_review_model)

  printEvidenceCoverageMatrix(casePackResult.internal_debug.evidence_coverage_matrix)

  printCasePackJsonSummary(casePackResult)

  printEvidenceLabels(casePackResult.internal_debug.evidence_labels)

  printThemeRegulatoryRetrieval(themeRegulatoryRetrieval)

  printRegulatoryCitations(themeRegulatoryCitations)

  console.log("\n=== Tier-2 Compact Summary ===")

  const displayedQuestionIds = new Set<string>()
  const displayedEvidenceRequestIds = new Set<string>()

  for (const assertion of assertions) {
    console.log(`\nAssertion: ${assertion.assertion_text}`)

    const materialLinks = getMaterialLinks(linksByAssertion.get(assertion.id) ?? [])

    if (!materialLinks.length) {
      console.log("  No material finding links identified.")
    } else {
      for (const link of materialLinks) {
        const findingText = findingById.get(link.finding_id)?.finding_text ?? "(missing finding)"
        console.log(`  Finding: ${findingText}`)
        console.log(`  Relationship: ${formatRelationshipLabel(link.relationship)}`)
      }
    }

    const relatedQuestions = allQuestions.filter((question) =>
      questionMatchesAssertionForCompactSummary(question, assertion.id),
    )
    if (!relatedQuestions.length) {
      console.log("  Investigation questions: (none)")
    } else {
      for (const question of relatedQuestions) {
        displayedQuestionIds.add(question.id)
        console.log(`  Investigation question: ${question.question_text}`)
      }
    }

    const relatedQuestionIds = new Set(relatedQuestions.map((question) => question.id))
    const relatedEvidenceRequests = allEvidenceRequests.filter((request) =>
      evidenceRequestMatchesAssertion(request, assertion.id, relatedQuestionIds),
    )
    if (!relatedEvidenceRequests.length) {
      console.log("  Evidence requests: (none)")
    } else {
      for (const request of relatedEvidenceRequests) {
        displayedEvidenceRequestIds.add(request.id)
        console.log(`  Evidence request: ${request.request_text}`)
      }
    }
  }

  const unlinkedQuestions = allQuestions.filter(
    (question) => !isThemeLevelQuestion(question) && !displayedQuestionIds.has(question.id),
  )
  const unlinkedEvidenceRequests = allEvidenceRequests.filter((request) => {
    if (displayedEvidenceRequestIds.has(request.id)) {
      return false
    }
    if (!request.source_question_id) {
      return true
    }
    const linkedQuestion = allQuestions.find((question) => question.id === request.source_question_id)
    return linkedQuestion ? !isThemeLevelQuestion(linkedQuestion) : true
  })

  console.log("\n=== Unlinked investigation questions ===")
  if (!unlinkedQuestions.length) {
    console.log("(none)")
  } else {
    for (const question of unlinkedQuestions) {
      console.log(`- ${question.question_text}`)
    }
  }

  console.log("\n=== Unlinked evidence requests ===")
  if (!unlinkedEvidenceRequests.length) {
    console.log("(none)")
  } else {
    for (const request of unlinkedEvidenceRequests) {
      console.log(`- ${request.request_text}`)
    }
  }

  const snapshot = buildRegressionSnapshot(
    caseId,
    assertions,
    allFindings,
    allLinks,
    allQuestions,
    allEvidenceRequests,
  )

  const regressionOutputPath = optionalEnv("REGRESSION_OUTPUT_PATH")
  if (regressionOutputPath) {
    await writeRegressionSnapshot(regressionOutputPath, {
      ...snapshot,
      submission_pack: casePackResult.submission_pack,
    })
  }

  const regressionBaselinePath = optionalEnv("REGRESSION_BASELINE_PATH")
  if (regressionBaselinePath) {
    const baseline = await loadRegressionBaseline(regressionBaselinePath)
    compareRegressionSnapshots(baseline, snapshot)
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error("\nTier-2 helper dry-run failed:")
  console.error(message)
  process.exit(1)
})
