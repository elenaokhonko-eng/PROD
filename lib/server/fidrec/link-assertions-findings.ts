import { z } from "zod"

import { zodEnum } from "@/lib/server/fidrec/zod-enums"
import { selectCanonicalCaseFindings } from "@/lib/server/fidrec/load-canonical-case-findings"
import { sanitizeNullableSourceId } from "@/lib/server/fidrec/normalize-source-id"
import { generateJson, getOpenAiModel } from "@/lib/server/ai/generate-json"
import { logger } from "@/lib/logger"
import { createServiceClient } from "@/lib/supabase/service"
import type { AssertionFindingRelationship, CaseAssertionFindingLinkRow, FindingConfidence } from "@/lib/types/fidrec"

const modelName = getOpenAiModel()
const log = logger.withContext({ module: "fidrec-link-assertions-findings", model: modelName })

const RELATIONSHIPS: readonly AssertionFindingRelationship[] = [
  "supports_bank_assertion",
  "rebuts_bank_assertion",
  "partially_rebuts",
  "requires_particulars",
  "irrelevant",
] as const

const CONFIDENCE: readonly FindingConfidence[] = ["low", "medium", "high"] as const

const RELATIONSHIP_PRIORITY: Record<AssertionFindingRelationship, number> = {
  rebuts_bank_assertion: 5,
  partially_rebuts: 4,
  requires_particulars: 3,
  supports_bank_assertion: 2,
  irrelevant: 1,
}

const rawLinkSchema = z.object({
  bank_assertion_id: z.string().nullish(),
  finding_id: z.string().nullish(),
  relationship: zodEnum(RELATIONSHIPS),
  explanation: z.string().trim().min(1, "explanation is required"),
  confidence: zodEnum(CONFIDENCE).default("medium"),
  next_question: z.string().nullable().optional(),
})

type SanitizedLink = {
  bank_assertion_id: string
  finding_id: string
  relationship: AssertionFindingRelationship
  explanation: string
  confidence: FindingConfidence
  next_question?: string | null | undefined
}

const linksPayloadSchema = z.object({
  links: z.array(rawLinkSchema).min(1, "No assertion-finding links generated"),
})

export type LinkAssertionsAndFindingsInput = {
  caseId: string
}

export type LinkAssertionsAndFindingsResult = {
  links: CaseAssertionFindingLinkRow[]
}

function buildLinkingPrompt(
  assertions: Array<{
    id: string
    assertion_text: string
    assertion_type: string
    bank_conclusion_supported: string | null
    particulars_needed: unknown
    evidence_needed: unknown
  }>,
  findings: Array<{
    id: string
    finding_text: string
    finding_type: string
    supporting_evidence: unknown
    confidence: string
    missing_information: unknown
    human_review_required: boolean
  }>,
): string {
  return `You are comparing bank assertions and neutral evidence-backed findings.

Do not make legal conclusions.
Do not determine liability.
Do not determine negligence.
Do not apply SRF, UPG or ABS.

Only determine the logical relationship between each bank assertion and each finding.

Relationship rules:
- Use supports_bank_assertion only when the finding directly confirms the bank assertion without needing further particulars.
- If the relationship is uncertain, prefer requires_particulars over supports_bank_assertion.
- These are persisted canonical case findings only (one row per distinct finding).
- Create at most one link per bank_assertion_id and finding_id pair.
- A finding that a new token, device, or digital wallet was registered before disputed transactions should NOT be treated as supporting authentication conclusively.
- That finding should usually be requires_particulars against assertions such as:
  - "transaction was authenticated"
  - "3D Secure transactions are authenticated"
  - "contactless requires digital wallet"
  because it raises whether authentication occurred after compromise or credential/token takeover.
- Token or device registration before transactions raises authentication-chain questions; it does not by itself prove the bank's authentication assertion.

Allowed relationship values:
- supports_bank_assertion
- rebuts_bank_assertion
- partially_rebuts
- requires_particulars
- irrelevant

Examples:

Assertion:
"Customer delayed reporting."

Finding:
"Customer contacted the bank hotline 18 minutes after discovery."

Relationship:
rebuts_bank_assertion

---

Assertion:
"Bank complied with SRF."

Finding:
"Transactions continued after a temporary freeze expired."

Relationship:
requires_particulars

because the finding does not prove non-compliance but creates questions requiring further explanation.

---

Assertion:
"3D Secure transactions are authenticated during the purchase."

Finding:
"A new digital token was registered before the disputed transactions."

Relationship:
requires_particulars

because token registration before transactions raises authentication-chain questions rather than directly confirming 3DS authentication for the disputed transactions.

Return JSON only in this exact shape:
{
  "links": [
    {
      "bank_assertion_id": "...",
      "finding_id": "...",
      "relationship": "rebuts_bank_assertion",
      "explanation": "...",
      "confidence": "high",
      "next_question": "..." | null
    }
  ]
}

Bank assertions:
${JSON.stringify(assertions, null, 2)}

Case findings:
${JSON.stringify(findings, null, 2)}

JSON Output:`
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function dedupeLinks(links: SanitizedLink[]): SanitizedLink[] {
  const byPair = new Map<string, SanitizedLink[]>()

  for (const link of links) {
    const pairKey = `${link.bank_assertion_id}::${link.finding_id}`
    const group = byPair.get(pairKey) ?? []
    group.push(link)
    byPair.set(pairKey, group)
  }

  const deduped: SanitizedLink[] = []
  for (const group of byPair.values()) {
    if (group.length === 1) {
      deduped.push(group[0])
      continue
    }

    let best = group[0]
    let bestPriority = RELATIONSHIP_PRIORITY[best.relationship]
    for (let index = 1; index < group.length; index += 1) {
      const candidate = group[index]
      const candidatePriority = RELATIONSHIP_PRIORITY[candidate.relationship]
      if (candidatePriority > bestPriority) {
        best = candidate
        bestPriority = candidatePriority
      }
    }
    deduped.push(best)
  }

  return deduped
}

function sanitizeLinks(
  links: z.output<typeof rawLinkSchema>[],
  validAssertionIds: Set<string>,
  validFindingIds: Set<string>,
  caseId: string,
): SanitizedLink[] {
  const sanitized: SanitizedLink[] = []

  for (const link of links) {
    const explanationPreview = link.explanation.slice(0, 80)

    const bankAssertionId = sanitizeNullableSourceId({
      caseId,
      field: "bank_assertion_id",
      rawValue: link.bank_assertion_id,
      validIds: validAssertionIds,
      preview: explanationPreview,
      previewField: "explanationPreview",
      logOnMissing: true,
      log,
    })

    if (!bankAssertionId) {
      continue
    }

    const findingId = sanitizeNullableSourceId({
      caseId,
      field: "finding_id",
      rawValue: link.finding_id,
      validIds: validFindingIds,
      preview: explanationPreview,
      previewField: "explanationPreview",
      logOnMissing: true,
      log,
    })

    if (!findingId) {
      continue
    }

    sanitized.push({
      bank_assertion_id: bankAssertionId,
      finding_id: findingId,
      relationship: link.relationship,
      explanation: link.explanation,
      confidence: link.confidence,
      next_question: link.next_question,
    })
  }

  return sanitized
}

export async function linkAssertionsAndFindings(
  input: LinkAssertionsAndFindingsInput,
): Promise<LinkAssertionsAndFindingsResult> {
  const supabase = createServiceClient()

  const { data: assertions, error: assertionsError } = await supabase
    .from("case_bank_assertions")
    .select(
      "id, assertion_text, assertion_type, bank_conclusion_supported, particulars_needed, evidence_needed, created_at",
    )
    .eq("case_id", input.caseId)
    .order("created_at", { ascending: true })

  if (assertionsError) {
    throw new Error(`Failed to load case_bank_assertions rows: ${assertionsError.message}`)
  }

  const { data: findings, error: findingsError } = await supabase
    .from("case_findings")
    .select(
      "id, finding_text, finding_type, supporting_evidence, confidence, missing_information, human_review_required, created_at",
    )
    .eq("case_id", input.caseId)
    .order("created_at", { ascending: true })

  if (findingsError) {
    throw new Error(`Failed to load case_findings rows: ${findingsError.message}`)
  }

  if (!assertions?.length) {
    throw new Error("No persisted bank assertions found for this case")
  }
  if (!findings?.length) {
    throw new Error("No persisted case findings found for this case")
  }

  const canonicalFindings = selectCanonicalCaseFindings(findings)
  if (canonicalFindings.length === 0) {
    throw new Error("No persisted case findings found for this case")
  }

  const validAssertionIds = new Set(assertions.map((row) => row.id))
  const validFindingIds = new Set(canonicalFindings.map((row) => row.id))

  if (canonicalFindings.length < findings.length) {
    log.info("Using canonical case findings for link generation", {
      caseId: input.caseId,
      loadedFindingCount: findings.length,
      canonicalFindingCount: canonicalFindings.length,
    })
  }

  const prompt = buildLinkingPrompt(assertions, canonicalFindings)

  log.info("Calling model to link assertions and findings", {
    caseId: input.caseId,
    assertionsCount: assertions.length,
    findingsCount: canonicalFindings.length,
  })

  const parsedJson = await generateJson({
    prompt,
    schemaName: "assertion-finding linking",
  })

  const parsed = linksPayloadSchema.parse(parsedJson)
  const sanitizedLinks = sanitizeLinks(parsed.links, validAssertionIds, validFindingIds, input.caseId)
  const dedupedLinks = dedupeLinks(sanitizedLinks)
  if (dedupedLinks.length === 0) {
    throw new Error("No assertion-finding links generated")
  }

  log.info("Prepared assertion-finding links for insert", {
    caseId: input.caseId,
    rawLinkCount: parsed.links.length,
    sanitizedLinkCount: sanitizedLinks.length,
    dedupedLinkCount: dedupedLinks.length,
  })

  const insertRows = dedupedLinks.map((link) => ({
    case_id: input.caseId,
    bank_assertion_id: link.bank_assertion_id,
    finding_id: link.finding_id,
    relationship: link.relationship,
    explanation: link.explanation,
    confidence: link.confidence,
    next_question: normalizeNullableString(link.next_question),
  }))

  const { error: deleteError } = await supabase
    .from("case_assertion_finding_links")
    .delete()
    .eq("case_id", input.caseId)

  if (deleteError) {
    throw new Error(`Failed to clear existing case_assertion_finding_links rows: ${deleteError.message}`)
  }

  const { data, error } = await supabase
    .from("case_assertion_finding_links")
    .insert(insertRows)
    .select(
      "id, case_id, bank_assertion_id, finding_id, relationship, explanation, confidence, next_question, created_at, updated_at",
    )

  if (error) {
    throw new Error(`Failed to insert case_assertion_finding_links rows: ${error.message}`)
  }

  return { links: (data ?? []) as CaseAssertionFindingLinkRow[] }
}
