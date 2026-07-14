import { z } from "zod"

import { zodEnum } from "@/lib/server/fidrec/zod-enums"
import {
  consolidateCaseFindings,
  type CaseFindingCandidate,
} from "@/lib/server/fidrec/consolidate-case-findings"
import { generateJson, getOpenAiModel } from "@/lib/server/ai/generate-json"
import { logger } from "@/lib/logger"
import { createServiceClient } from "@/lib/supabase/service"
import type { CaseFindingRow, FindingConfidence, FindingType } from "@/lib/types/fidrec"

const modelName = getOpenAiModel()
const log = logger.withContext({ module: "fidrec-generate-case-findings", model: modelName })

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

const caseFindingSchema = z.object({
  finding_text: z.string().trim().min(1, "finding_text is required"),
  finding_type: zodEnum(FINDING_TYPES),
  supporting_evidence: z.array(z.string().trim().min(1)).default([]),
  confidence: zodEnum(FINDING_CONFIDENCE).default("medium"),
  missing_information: z.array(z.string().trim().min(1)).default([]),
  human_review_required: z.boolean().default(true),
})

const caseFindingsPayloadSchema = z.object({
  case_findings: z.array(caseFindingSchema).min(1, "No case findings extracted"),
})

export type GenerateAndPersistCaseFindingsInput = {
  caseId: string
  processedEvidenceJson: unknown
  customerNarrative?: string
}

export type GenerateAndPersistCaseFindingsResult = {
  case_findings: CaseFindingRow[]
}

function buildCaseFindingsPrompt(processedEvidenceJson: unknown, customerNarrative?: string): string {
  const narrative = customerNarrative?.trim() || null

  return `You are analysing processed evidence JSONB and customer narrative in a Singapore phishing-scam dispute.

Task:
- Generate neutral evidence-backed findings only.
- Each finding must be factual, neutral, evidence-supported, and independent of legal conclusion.
- Do not infer facts not present in the evidence or narrative.
- Do not state legal fault or liability conclusions.

Do NOT say statements like:
- bank failed
- customer negligent
- bank liable
- customer innocent

Allowed finding examples:
- "Customer states they did not authorise the disputed transactions."
- "Customer reported the incident to police."
- "A new digital token was registered before disputed transactions."
- "Transactions continued after a temporary freeze expired."
- "The transaction sequence shows multiple transfers within a short period."

Allowed finding_type values:
- core_claim
- chronology
- authentication
- transaction_pattern
- notification
- customer_behaviour
- fi_behaviour
- containment

Return JSON only in this exact shape:
{
  "case_findings": [
    {
      "finding_text": "...",
      "finding_type": "chronology",
      "supporting_evidence": ["..."],
      "confidence": "high",
      "missing_information": [],
      "human_review_required": true
    }
  ]
}

Processed evidence JSON:
${JSON.stringify(processedEvidenceJson, null, 2)}

Customer narrative:
${narrative ? narrative : "null"}

JSON Output:`
}

export async function generateAndPersistCaseFindings(
  input: GenerateAndPersistCaseFindingsInput,
): Promise<GenerateAndPersistCaseFindingsResult> {
  const prompt = buildCaseFindingsPrompt(input.processedEvidenceJson, input.customerNarrative)

  log.info("Calling model to generate neutral case findings", {
    caseId: input.caseId,
    hasCustomerNarrative: Boolean(input.customerNarrative?.trim()),
  })

  const parsedJson = await generateJson({
    prompt,
    schemaName: "case findings generation",
  })

  const parsed = caseFindingsPayloadSchema.parse(parsedJson)
  if (parsed.case_findings.length === 0) {
    throw new Error("No findings extracted from processed evidence")
  }

  const caseFindingCandidates: CaseFindingCandidate[] = parsed.case_findings.map((finding) => ({
    finding_text: finding.finding_text,
    finding_type: finding.finding_type,
    supporting_evidence: finding.supporting_evidence,
    confidence: finding.confidence,
    missing_information: finding.missing_information,
    human_review_required: finding.human_review_required,
  }))

  const consolidatedFindings = await consolidateCaseFindings({
    caseId: input.caseId,
    candidates: caseFindingCandidates,
  })
  if (consolidatedFindings.length === 0) {
    throw new Error("No findings extracted from processed evidence")
  }

  log.info("Prepared consolidated case findings for insert", {
    caseId: input.caseId,
    rawFindingCount: parsed.case_findings.length,
    consolidatedFindingCount: consolidatedFindings.length,
  })

  const insertRows = consolidatedFindings.map((finding) => ({
    case_id: input.caseId,
    finding_text: finding.finding_text,
    finding_type: finding.finding_type,
    supporting_evidence: finding.supporting_evidence,
    confidence: finding.confidence,
    missing_information: finding.missing_information,
    human_review_required: finding.human_review_required,
    raw_model_output: {
      finding_text: finding.finding_text,
      finding_type: finding.finding_type,
      supporting_evidence: finding.supporting_evidence,
      confidence: finding.confidence,
      missing_information: finding.missing_information,
      human_review_required: finding.human_review_required,
      merged_findings: finding.merged_findings,
    },
  }))

  const supabase = createServiceClient()

  const { error: deleteError } = await supabase.from("case_findings").delete().eq("case_id", input.caseId)
  if (deleteError) {
    throw new Error(`Failed to clear existing case_findings rows: ${deleteError.message}`)
  }

  const { data, error } = await supabase
    .from("case_findings")
    .insert(insertRows)
    .select(
      "id, case_id, finding_text, finding_type, supporting_evidence, confidence, missing_information, human_review_required, raw_model_output, created_at, updated_at",
    )

  if (error) {
    throw new Error(`Failed to insert case_findings rows: ${error.message}`)
  }

  return { case_findings: (data ?? []) as CaseFindingRow[] }
}
