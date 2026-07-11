import { z } from "zod"

import { zodEnum } from "@/lib/server/fidrec/zod-enums"
import { normalizeSemanticText } from "@/lib/server/fidrec/consolidate-investigation-issues"
import { generateJson } from "@/lib/server/ai/generate-json"
import { logger } from "@/lib/logger"
import type { FindingConfidence, FindingType } from "@/lib/types/fidrec"

const log = logger.withContext({ module: "fidrec-consolidate-case-findings" })

const FINDING_TYPES: readonly FindingType[] = [
  "core_claim",
  "chronology",
  "authentication",
  "transaction_pattern",
  "notification",
  "customer_behaviour",
  "fi_behaviour",
  "containment",
] as const

const FINDING_CONFIDENCE: readonly FindingConfidence[] = ["low", "medium", "high"] as const

const CONFIDENCE_RANK: Record<FindingConfidence, number> = {
  low: 1,
  medium: 2,
  high: 3,
}

export type CaseFindingCandidate = {
  finding_text: string
  finding_type: FindingType
  supporting_evidence: string[]
  confidence: FindingConfidence
  missing_information: string[]
  human_review_required: boolean
}

export type ConsolidatedCaseFinding = CaseFindingCandidate & {
  merged_findings: CaseFindingCandidate[]
}

const consolidatedFindingSchema = z.object({
  finding_text: z.string().trim().min(1),
  finding_type: zodEnum(FINDING_TYPES),
  supporting_evidence: z.array(z.string().trim().min(1)).default([]),
  confidence: zodEnum(FINDING_CONFIDENCE).default("medium"),
  missing_information: z.array(z.string().trim().min(1)).default([]),
  human_review_required: z.boolean().default(true),
  merged_finding_texts: z.array(z.string().trim().min(1)).min(1),
})

type ParsedConsolidatedFinding = z.infer<typeof consolidatedFindingSchema>

const consolidationPayloadSchema = z.object({
  case_findings: z.array(consolidatedFindingSchema).min(1),
})

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function maxConfidence(left: FindingConfidence, right: FindingConfidence): FindingConfidence {
  return CONFIDENCE_RANK[left] >= CONFIDENCE_RANK[right] ? left : right
}

function pickRepresentativeFinding(candidates: CaseFindingCandidate[]): CaseFindingCandidate {
  return candidates.reduce((best, current) =>
    current.finding_text.length > best.finding_text.length ? current : best,
  )
}

function inferFindingTopicBucket(text: string, findingType: FindingType): string | null {
  const normalized = text.toLowerCase()
  if (
    findingType === "authentication" ||
    /\b(3ds|3d secure|authentication|authenticated|acs|token|digital token|otp|wallet binding)\b/.test(
      normalized,
    )
  ) {
    return "authentication"
  }
  if (
    (findingType === "chronology" || findingType === "containment") &&
    /\b(police|reported|report|hotline|fraud report)\b/.test(normalized)
  ) {
    return "reporting"
  }
  if (
    findingType === "transaction_pattern" ||
    /\b(transfer|transaction|payment|withdrawal)\b/.test(normalized)
  ) {
    return "transaction_activity"
  }
  if (findingType === "core_claim" && /\b(did not authori[sz]e|unauthorised|unauthorized|dispute)\b/.test(normalized)) {
    return "customer_denial"
  }
  return null
}

function buildFindingClusterKey(candidate: CaseFindingCandidate): string {
  const topic =
    inferFindingTopicBucket(candidate.finding_text, candidate.finding_type) ??
    normalizeSemanticText(candidate.finding_text).slice(0, 96)
  return `${candidate.finding_type}::${topic}`
}

function toConsolidatedFinding(
  finding: ParsedConsolidatedFinding,
  mergedFindings: CaseFindingCandidate[],
): ConsolidatedCaseFinding {
  return {
    finding_text: finding.finding_text,
    finding_type: finding.finding_type,
    supporting_evidence: uniqueStrings([
      ...finding.supporting_evidence,
      ...mergedFindings.flatMap((item) => item.supporting_evidence),
    ]),
    confidence: mergedFindings.reduce(
      (confidence, item) => maxConfidence(confidence, item.confidence),
      finding.confidence,
    ),
    missing_information: uniqueStrings([
      ...finding.missing_information,
      ...mergedFindings.flatMap((item) => item.missing_information),
    ]),
    human_review_required: mergedFindings.some((item) => item.human_review_required),
    merged_findings: mergedFindings,
  }
}

function resolveMergedFindings(
  finding: ParsedConsolidatedFinding,
  candidates: CaseFindingCandidate[],
): CaseFindingCandidate[] {
  const mergedTexts = new Set(finding.merged_finding_texts.map((text) => text.trim()))
  const matchingCandidates = candidates.filter((candidate) => mergedTexts.has(candidate.finding_text.trim()))

  if (matchingCandidates.length > 0) {
    return matchingCandidates
  }

  const normalizedMatch = candidates.filter((candidate) =>
    mergedTexts.has(normalizeSemanticText(candidate.finding_text)),
  )
  if (normalizedMatch.length > 0) {
    return normalizedMatch
  }

  return [pickRepresentativeFinding(candidates)]
}

function heuristicConsolidateCaseFindings(candidates: CaseFindingCandidate[]): ConsolidatedCaseFinding[] {
  const groups = new Map<string, CaseFindingCandidate[]>()

  for (const candidate of candidates) {
    const key = buildFindingClusterKey(candidate)
    const group = groups.get(key) ?? []
    group.push(candidate)
    groups.set(key, group)
  }

  return [...groups.values()].map((group) => {
    const representative = pickRepresentativeFinding(group)
    return {
      finding_text: representative.finding_text,
      finding_type: representative.finding_type,
      supporting_evidence: uniqueStrings(group.flatMap((item) => item.supporting_evidence)),
      confidence: group.reduce((confidence, item) => maxConfidence(confidence, item.confidence), group[0].confidence),
      missing_information: uniqueStrings(group.flatMap((item) => item.missing_information)),
      human_review_required: group.some((item) => item.human_review_required),
      merged_findings: group,
    }
  })
}

function buildConsolidationPrompt(candidates: CaseFindingCandidate[]): string {
  return `You are consolidating candidate neutral case findings for a Singapore phishing-scam dispute.

Rules:
- Merge semantically equivalent findings into one canonical finding.
- Keep one finding_text per merged group; prefer the clearest, most complete wording.
- Merge supporting_evidence and missing_information without duplicates.
- Use the highest confidence among merged findings.
- Set human_review_required to true if any merged finding requires human review.
- Keep finding_type from the merged group when they agree; otherwise prefer the type of the clearest finding.
- Do not infer new facts or assign liability.

Semantically equivalent examples to merge:
- "Customer reported the incident to police."
- "Customer made a police report."
-> finding_text: "Customer reported the incident to police."
- "A new digital token was registered before disputed transactions."
- "Digital token registration occurred prior to disputed transactions."
-> finding_text: "A new digital token was registered before disputed transactions."

Return JSON only in this exact shape:
{
  "case_findings": [
    {
      "finding_text": "...",
      "finding_type": "chronology",
      "supporting_evidence": ["..."],
      "confidence": "high",
      "missing_information": [],
      "human_review_required": true,
      "merged_finding_texts": ["...", "..."]
    }
  ]
}

Candidate case findings:
${JSON.stringify(candidates, null, 2)}

JSON Output:`
}

export async function consolidateCaseFindings(input: {
  caseId: string
  candidates: CaseFindingCandidate[]
}): Promise<ConsolidatedCaseFinding[]> {
  if (input.candidates.length === 0) return []
  if (input.candidates.length === 1) {
    const [candidate] = input.candidates
    return [{ ...candidate, merged_findings: [candidate] }]
  }

  try {
    const parsedJson = await generateJson({
      prompt: buildConsolidationPrompt(input.candidates),
      schemaName: "case findings consolidation",
    })
    const parsed = consolidationPayloadSchema.parse(parsedJson)

    const findings = parsed.case_findings.map((finding) =>
      toConsolidatedFinding(finding, resolveMergedFindings(finding, input.candidates)),
    )

    log.info("Consolidated case findings", {
      caseId: input.caseId,
      candidateCount: input.candidates.length,
      findingCount: findings.length,
      method: "model",
    })

    return findings
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Case findings model consolidation failed; using heuristic fallback", {
      caseId: input.caseId,
      error: message,
    })

    const findings = heuristicConsolidateCaseFindings(input.candidates)
    log.info("Consolidated case findings", {
      caseId: input.caseId,
      candidateCount: input.candidates.length,
      findingCount: findings.length,
      method: "heuristic",
    })
    return findings
  }
}
