import { z } from "zod"

import { zodEnum } from "@/lib/server/fidrec/zod-enums"
import { generateJson, getOpenAiModel } from "@/lib/server/ai/generate-json"
import { logger } from "@/lib/logger"
import { createServiceClient } from "@/lib/supabase/service"
import type { BankAssertionType, CaseBankAssertionRow } from "@/lib/types/fidrec"

const modelName = getOpenAiModel()
const log = logger.withContext({ module: "fidrec-extract-bank-assertions", model: modelName })

const ASSERTION_TYPES: readonly BankAssertionType[] = ["factual", "technical", "procedural", "liability"] as const

const bankAssertionSchema = z.object({
  assertion_text: z.string().trim().min(1, "assertion_text is required"),
  assertion_type: zodEnum(ASSERTION_TYPES),
  bank_conclusion_supported: z.string().trim().min(1).nullable().optional(),
  particulars_needed: z.array(z.string().trim().min(1)).default([]),
  evidence_needed: z.array(z.string().trim().min(1)).default([]),
})

const bankAssertionsPayloadSchema = z.object({
  bank_assertions: z.array(bankAssertionSchema).min(1, "No bank assertions extracted"),
})

export type ExtractAndPersistBankAssertionsInput = {
  caseId: string
  sourceDocumentId?: string | null
  bankFinalResponseText: string
}

export type ExtractAndPersistBankAssertionsResult = {
  bank_assertions: CaseBankAssertionRow[]
}

function buildBankAssertionPrompt(bankFinalResponseText: string): string {
  return `You are analysing a bank final response in a Singapore phishing-scam dispute.

Task:
- Extract only the bank's assertions from the text.
- Do not rebut the bank.
- Do not decide whether the bank is right.
- Do not infer facts not stated in the text.
- Classify each assertion_type as exactly one of:
  - factual
  - technical
  - procedural
  - liability
- If the bank gives only a conclusion without reasoning, clearly populate particulars_needed for that assertion.
- Return JSON only.

Return this exact JSON shape:
{
  "bank_assertions": [
    {
      "assertion_text": "...",
      "assertion_type": "technical",
      "bank_conclusion_supported": "...",
      "particulars_needed": ["..."],
      "evidence_needed": ["..."]
    }
  ]
}

Bank final response text:
"""
${bankFinalResponseText}
"""

JSON Output:`
}

function normalizeAssertionText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ")
}

function dedupeBankAssertions(assertions: z.output<typeof bankAssertionSchema>[]): z.output<typeof bankAssertionSchema>[] {
  const seen = new Set<string>()
  const deduped: z.output<typeof bankAssertionSchema>[] = []

  for (const assertion of assertions) {
    const key = `${assertion.assertion_type}::${normalizeAssertionText(assertion.assertion_text)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(assertion)
  }

  return deduped
}

export async function extractAndPersistBankAssertions(
  input: ExtractAndPersistBankAssertionsInput,
): Promise<ExtractAndPersistBankAssertionsResult> {
  const bankFinalResponseText = input.bankFinalResponseText?.trim()
  if (!bankFinalResponseText) {
    throw new Error("bankFinalResponseText is required")
  }

  const prompt = buildBankAssertionPrompt(bankFinalResponseText)

  log.info("Calling model to extract bank assertions", {
    caseId: input.caseId,
    sourceDocumentId: input.sourceDocumentId ?? null,
  })

  const parsedJson = await generateJson({
    prompt,
    schemaName: "bank assertions extraction",
  })

  const parsed = bankAssertionsPayloadSchema.parse(parsedJson)
  const dedupedAssertions = dedupeBankAssertions(parsed.bank_assertions)
  if (dedupedAssertions.length === 0) {
    throw new Error("No assertions extracted from bank final response")
  }

  const sourceDocumentId = input.sourceDocumentId ?? null
  const supabase = createServiceClient()

  let deleteQuery = supabase.from("case_bank_assertions").delete().eq("case_id", input.caseId)
  deleteQuery = sourceDocumentId
    ? deleteQuery.eq("source_document_id", sourceDocumentId)
    : deleteQuery.is("source_document_id", null)

  const { error: deleteError } = await deleteQuery
  if (deleteError) {
    throw new Error(`Failed to clear existing case_bank_assertions rows: ${deleteError.message}`)
  }

  log.info("Cleared existing bank assertions before insert", {
    caseId: input.caseId,
    sourceDocumentId,
    dedupedAssertionCount: dedupedAssertions.length,
    rawAssertionCount: parsed.bank_assertions.length,
  })

  const insertRows = dedupedAssertions.map((assertion) => ({
    case_id: input.caseId,
    source_document_id: sourceDocumentId,
    assertion_text: assertion.assertion_text,
    assertion_type: assertion.assertion_type,
    bank_conclusion_supported: assertion.bank_conclusion_supported ?? null,
    particulars_needed: assertion.particulars_needed,
    evidence_needed: assertion.evidence_needed,
    raw_model_output: assertion,
  }))

  const { data, error } = await supabase
    .from("case_bank_assertions")
    .insert(insertRows)
    .select(
      "id, case_id, source_document_id, assertion_text, assertion_type, bank_conclusion_supported, particulars_needed, evidence_needed, raw_model_output, created_at, updated_at",
    )

  if (error) {
    throw new Error(`Failed to insert case_bank_assertions rows: ${error.message}`)
  }

  return { bank_assertions: (data ?? []) as CaseBankAssertionRow[] }
}
