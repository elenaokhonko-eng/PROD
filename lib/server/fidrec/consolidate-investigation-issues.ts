import { z } from "zod"

import { zodEnum } from "@/lib/server/fidrec/zod-enums"
import { generateJson } from "@/lib/server/ai/generate-json"
import { logger } from "@/lib/logger"
import type {
  EvidenceRequestCategory,
  EvidenceRequestPriority,
  EvidenceRequestRequestedFrom,
  InvestigationQuestionPriority,
  InvestigationQuestionType,
} from "@/lib/types/fidrec"

const log = logger.withContext({ module: "fidrec-consolidate-investigation-issues" })

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

const PRIORITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export type InvestigationIssueCandidate = {
  source_assertion_id: string | null
  source_finding_id: string | null
  source_link_id: string | null
  question_text: string
  question_type: InvestigationQuestionType
  priority: InvestigationQuestionPriority
  evidence_requested: string[]
}

export type InvestigationIssue = {
  issue_text: string
  question_text: string
  question_type: InvestigationQuestionType
  priority: InvestigationQuestionPriority
  source_assertion_id: string | null
  source_finding_id: string | null
  source_link_id: string | null
  evidence_requested: string[]
  merged_question_texts: string[]
}

export type EvidenceRequestCandidate = {
  source_question_id: string | null
  source_assertion_id: string | null
  source_finding_id: string | null
  source_link_id: string | null
  request_text: string
  request_reason: string | null
  evidence_category: EvidenceRequestCategory
  requested_from: EvidenceRequestRequestedFrom
  priority: EvidenceRequestPriority
  suggested_file_types: string[]
  example_documents: string[]
}

const investigationIssueSchema = z.object({
  issue_text: z.string().trim().min(1),
  question_text: z.string().trim().min(1),
  question_type: zodEnum(QUESTION_TYPES),
  priority: zodEnum(PRIORITIES),
  source_assertion_id: z.string().nullable().optional(),
  source_finding_id: z.string().nullable().optional(),
  source_link_id: z.string().nullable().optional(),
  evidence_requested: z.array(z.string().trim().min(1)).default([]),
  merged_question_texts: z.array(z.string().trim().min(1)).min(1),
})

type ParsedInvestigationIssue = z.infer<typeof investigationIssueSchema>

function toInvestigationIssue(
  issue: ParsedInvestigationIssue,
  sources: Pick<InvestigationIssue, "source_assertion_id" | "source_finding_id" | "source_link_id">,
  evidenceRequested: string[],
): InvestigationIssue {
  return {
    issue_text: issue.issue_text,
    question_text: issue.question_text,
    question_type: issue.question_type,
    priority: issue.priority,
    source_assertion_id: sources.source_assertion_id,
    source_finding_id: sources.source_finding_id,
    source_link_id: sources.source_link_id,
    evidence_requested: evidenceRequested,
    merged_question_texts: uniqueStrings(issue.merged_question_texts),
  }
}

const consolidationPayloadSchema = z.object({
  investigation_issues: z.array(investigationIssueSchema).min(1),
})

export function normalizeSemanticText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
}

function inferTopicBucket(text: string): string | null {
  const normalized = text.toLowerCase()
  if (
    /\b(3ds|3d secure|authentication|authenticated|acs|token|device binding|digital token|otp|wallet binding)\b/.test(
      normalized,
    )
  ) {
    return "authentication_chain"
  }
  if (/\b(hotline|reported|reporting|containment|freeze|blocked|fraud report)\b/.test(normalized)) {
    return "reporting_containment"
  }
  return null
}

function buildIssueClusterKey(candidate: InvestigationIssueCandidate): string {
  const topic = inferTopicBucket(candidate.question_text) ?? normalizeSemanticText(candidate.question_text).slice(0, 96)
  return [
    candidate.source_link_id ?? candidate.source_assertion_id ?? "unlinked",
    candidate.source_finding_id ?? "no-finding",
    candidate.question_type,
    topic,
  ].join("::")
}

function maxPriority(
  left: InvestigationQuestionPriority,
  right: InvestigationQuestionPriority,
): InvestigationQuestionPriority {
  return PRIORITY_RANK[left] >= PRIORITY_RANK[right] ? left : right
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function pickRepresentativeQuestion(candidates: InvestigationIssueCandidate[]): InvestigationIssueCandidate {
  return candidates.reduce((best, current) =>
    current.question_text.length > best.question_text.length ? current : best,
  )
}

function buildHeuristicIssueText(candidates: InvestigationIssueCandidate[]): string {
  const topic = inferTopicBucket(candidates.map((candidate) => candidate.question_text).join(" "))
  if (topic === "authentication_chain") {
    return "Whether 3DS authentication completed successfully for the disputed transactions."
  }
  if (topic === "reporting_containment") {
    return "Whether timely fraud reporting and containment steps were taken."
  }
  return pickRepresentativeQuestion(candidates).question_text
}

function heuristicConsolidateInvestigationIssues(
  candidates: InvestigationIssueCandidate[],
): InvestigationIssue[] {
  const groups = new Map<string, InvestigationIssueCandidate[]>()

  for (const candidate of candidates) {
    const key = buildIssueClusterKey(candidate)
    const group = groups.get(key) ?? []
    group.push(candidate)
    groups.set(key, group)
  }

  return [...groups.values()].map((group) => {
    const representative = pickRepresentativeQuestion(group)
    return {
      issue_text: buildHeuristicIssueText(group),
      question_text: representative.question_text,
      question_type: representative.question_type,
      priority: group.reduce((priority, candidate) => maxPriority(priority, candidate.priority), group[0].priority),
      source_assertion_id: representative.source_assertion_id,
      source_finding_id: representative.source_finding_id,
      source_link_id: representative.source_link_id,
      evidence_requested: uniqueStrings(group.flatMap((candidate) => candidate.evidence_requested)),
      merged_question_texts: group.map((candidate) => candidate.question_text),
    }
  })
}

function buildConsolidationPrompt(candidates: InvestigationIssueCandidate[]): string {
  return `You are consolidating candidate investigation questions into investigation issues for a Singapore phishing-scam dispute case.

Pipeline:
Assertion -> Finding -> Link -> Investigation Issue -> Question -> Evidence Requests

Rules:
- One investigation issue per unique factual uncertainty.
- One consolidated question per investigation issue.
- Merge semantically equivalent questions into the same issue.
- Semantically equivalent examples to merge:
  - "Was 3DS completed?"
  - "Was authentication successful?"
  - "Was authentication triggered?"
  -> issue_text: "Whether 3DS authentication completed successfully."
  -> question_text: "Can the bank demonstrate successful 3DS authentication for the disputed transactions?"
- Keep source_assertion_id, source_finding_id, and source_link_id from the merged group when they agree; otherwise prefer the link with the strongest investigative need.
- Merge evidence_requested lists without duplicates.
- Use the highest priority among merged questions.
- Do not assign liability or apply SRF, UPG, or ABS.

Return JSON only in this exact shape:
{
  "investigation_issues": [
    {
      "issue_text": "Whether 3DS authentication completed successfully.",
      "question_text": "Can the bank demonstrate successful 3DS authentication for the disputed transactions?",
      "question_type": "authentication_gap",
      "priority": "high",
      "source_assertion_id": "...",
      "source_finding_id": "...",
      "source_link_id": "...",
      "evidence_requested": ["3DS logs", "ACS logs"],
      "merged_question_texts": ["Was 3DS completed?", "Was authentication successful?"]
    }
  ]
}

Candidate investigation questions:
${JSON.stringify(candidates, null, 2)}

JSON Output:`
}

function resolveConsolidatedSources(
  issue: z.infer<typeof investigationIssueSchema>,
  candidates: InvestigationIssueCandidate[],
): Pick<InvestigationIssue, "source_assertion_id" | "source_finding_id" | "source_link_id"> {
  const mergedTexts = new Set(issue.merged_question_texts.map((text) => text.trim()))
  const matchingCandidates = candidates.filter((candidate) => mergedTexts.has(candidate.question_text.trim()))

  const sourcePool = matchingCandidates.length ? matchingCandidates : candidates
  const representative = pickRepresentativeQuestion(sourcePool)

  return {
    source_assertion_id: representative.source_assertion_id,
    source_finding_id: representative.source_finding_id,
    source_link_id: representative.source_link_id,
  }
}

export async function consolidateInvestigationIssues(input: {
  caseId: string
  candidates: InvestigationIssueCandidate[]
}): Promise<InvestigationIssue[]> {
  if (input.candidates.length === 0) return []
  if (input.candidates.length === 1) {
    const [candidate] = input.candidates
    return [
      {
        issue_text: buildHeuristicIssueText([candidate]),
        question_text: candidate.question_text,
        question_type: candidate.question_type,
        priority: candidate.priority,
        source_assertion_id: candidate.source_assertion_id,
        source_finding_id: candidate.source_finding_id,
        source_link_id: candidate.source_link_id,
        evidence_requested: uniqueStrings(candidate.evidence_requested),
        merged_question_texts: [candidate.question_text],
      },
    ]
  }

  try {
    const parsedJson = await generateJson({
      prompt: buildConsolidationPrompt(input.candidates),
      schemaName: "investigation issue consolidation",
    })
    const parsed = consolidationPayloadSchema.parse(parsedJson)

    const issues = parsed.investigation_issues.map((issue) => {
      const sources = resolveConsolidatedSources(issue, input.candidates)
      const mergedTexts = new Set(issue.merged_question_texts.map((text) => text.trim()))
      const matchingCandidates = input.candidates.filter((candidate) =>
        mergedTexts.has(candidate.question_text.trim()),
      )

      return toInvestigationIssue(
        issue,
        sources,
        uniqueStrings([
          ...issue.evidence_requested,
          ...matchingCandidates.flatMap((candidate) => candidate.evidence_requested),
        ]),
      )
    })

    log.info("Consolidated investigation issues", {
      caseId: input.caseId,
      candidateCount: input.candidates.length,
      issueCount: issues.length,
      method: "model",
    })

    return issues
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Investigation issue model consolidation failed; using heuristic fallback", {
      caseId: input.caseId,
      error: message,
    })

    const issues = heuristicConsolidateInvestigationIssues(input.candidates)
    log.info("Consolidated investigation issues", {
      caseId: input.caseId,
      candidateCount: input.candidates.length,
      issueCount: issues.length,
      method: "heuristic",
    })
    return issues
  }
}

export function consolidateEvidenceRequests<T extends EvidenceRequestCandidate>(requests: T[]): T[] {
  const merged = new Map<string, T>()

  for (const request of requests) {
    const key = [
      request.source_question_id ?? "no-question",
      request.evidence_category,
      request.requested_from,
      normalizeSemanticText(request.request_text),
    ].join("::")

    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...request })
      continue
    }

    merged.set(key, {
      ...existing,
      priority:
        PRIORITY_RANK[request.priority] > PRIORITY_RANK[existing.priority] ? request.priority : existing.priority,
      suggested_file_types: uniqueStrings([...existing.suggested_file_types, ...request.suggested_file_types]),
      example_documents: uniqueStrings([...existing.example_documents, ...request.example_documents]),
      request_reason: existing.request_reason ?? request.request_reason,
    })
  }

  return [...merged.values()]
}
