import type { EvidenceLabel } from "@/lib/types/fidrec-evidence-labels"
import type {
  BankPositionBuildDiagnostics,
  SubmissionBankPosition,
} from "@/lib/types/fidrec-submission-pack"
import type { CaseBankAssertionRow } from "@/lib/types/fidrec"

export type BuildBankPositionNarrativeInput = {
  assertions: CaseBankAssertionRow[]
  evidenceLabels: EvidenceLabel[]
}

const BANK_NAME_PATTERN =
  /\b(DBS|OCBC|UOB|HSBC|Standard Chartered|Citibank|Maybank|CIMB|Bank of China|ANZ)\b/i

const BANK_EVIDENCE_TYPES = new Set<EvidenceLabel["evidence_type"]>([
  "bank_final_response",
  "bank_investigation_report",
  "bank_email_or_letter",
])

type AssertionGroup = "authentication" | "rejection" | "customer_responsibility" | "other"

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function sortEvidenceRefs(refs: string[]): string[] {
  return uniqueStrings(refs).sort((left, right) => {
    const leftNumber = Number(left.replace(/^E/i, ""))
    const rightNumber = Number(right.replace(/^E/i, ""))
    if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) {
      return left.localeCompare(right)
    }
    return leftNumber - rightNumber
  })
}

function normalizeAssertionText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

function detectBankName(assertions: CaseBankAssertionRow[], evidenceLabels: EvidenceLabel[]): string {
  const corpus = [
    ...assertions.map((assertion) => assertion.assertion_text),
    ...assertions.map((assertion) => assertion.bank_conclusion_supported ?? ""),
    ...evidenceLabels.map((label) => label.original_filename ?? ""),
  ].join(" ")

  const match = corpus.match(BANK_NAME_PATTERN)
  return match?.[1] ?? "the bank"
}

function bankLabelForSentence(bankName: string): string {
  return bankName === "the bank" ? "The bank" : bankName
}

function bankLabelForMidSentence(bankName: string): string {
  return bankName === "the bank" ? "the bank" : bankName
}

function isAuthenticationAssertion(text: string): boolean {
  return /3d\s*secure|\b3ds\b|contactless|\bemv\b|\bchip\b|authenticated|authori[sz]ed|card present|digital card|mobile wallet/i.test(
    text,
  )
}

function isRejectionAssertion(text: string): boolean {
  return /unsuccessful|declined|rejected|not liable|cannot be disputed|investigation completed|not upheld|denied/i.test(
    text,
  )
}

function isCustomerResponsibilityAssertion(text: string): boolean {
  return /customer authori[sz]ed|disclosed credentials|failed to protect|negligen|\botp\b|\bpin\b|password|scam link/i.test(
    text,
  )
}

function classifyAssertionGroups(assertions: CaseBankAssertionRow[]): Record<AssertionGroup, CaseBankAssertionRow[]> {
  const groups: Record<AssertionGroup, CaseBankAssertionRow[]> = {
    authentication: [],
    rejection: [],
    customer_responsibility: [],
    other: [],
  }

  for (const assertion of assertions) {
    const combinedText = [assertion.assertion_text, assertion.bank_conclusion_supported ?? ""].join(" ")

    if (isAuthenticationAssertion(assertion.assertion_text)) {
      groups.authentication.push(assertion)
    } else if (isCustomerResponsibilityAssertion(combinedText)) {
      groups.customer_responsibility.push(assertion)
    } else if (isRejectionAssertion(combinedText)) {
      groups.rejection.push(assertion)
    } else {
      groups.other.push(assertion)
    }

    if (
      assertion.bank_conclusion_supported &&
      isRejectionAssertion(assertion.bank_conclusion_supported) &&
      !groups.rejection.includes(assertion)
    ) {
      groups.rejection.push(assertion)
    }
  }

  return groups
}

function dedupeAssertions(assertions: CaseBankAssertionRow[]): {
  deduped: CaseBankAssertionRow[]
  duplicateCount: number
} {
  const seen = new Set<string>()
  const deduped: CaseBankAssertionRow[] = []

  for (const assertion of assertions) {
    const key = normalizeAssertionText(assertion.assertion_text)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(assertion)
  }

  return {
    deduped,
    duplicateCount: Math.max(0, assertions.length - deduped.length),
  }
}

function summarizeAuthenticationMechanismsForReliance(assertions: CaseBankAssertionRow[]): string {
  const corpus = assertions.map((assertion) => assertion.assertion_text).join(" ").toLowerCase()
  const parts: string[] = []

  if (/3d\s*secure|\b3ds\b/.test(corpus)) parts.push("3D Secure authentication")
  if (/contactless/.test(corpus)) parts.push("contactless card or mobile wallet presentation")
  if (/\bemv\b|\bchip\b/.test(corpus)) parts.push("EMV chip verification")

  if (!parts.length) {
    return "authentication mechanisms described in the bank correspondence"
  }
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`
}

function buildEvidenceLabelById(evidenceLabels: EvidenceLabel[]): Map<string, EvidenceLabel> {
  return new Map(evidenceLabels.map((label) => [label.case_document_id, label]))
}

function resolveEvidenceRefs(input: {
  assertions: CaseBankAssertionRow[]
  evidenceLabels: EvidenceLabel[]
}): string[] {
  const labelByDocumentId = buildEvidenceLabelById(input.evidenceLabels)
  const refs: string[] = []

  for (const assertion of input.assertions) {
    if (!assertion.source_document_id) continue
    const label = labelByDocumentId.get(assertion.source_document_id)
    if (!label || !BANK_EVIDENCE_TYPES.has(label.evidence_type)) continue
    refs.push(label.label)
  }

  return sortEvidenceRefs(refs)
}

function formatEvidenceRefsInline(refs: string[]): string {
  if (!refs.length) return ""
  return ` [${refs.join("] [")}]`
}

function buildCustomerResponsibilitySentence(
  bankName: string,
  assertions: CaseBankAssertionRow[],
): string | null {
  if (!assertions.length) return null

  const bankMid = bankLabelForMidSentence(bankName)
  return `${bankLabelForSentence(bankName)} also states that ${bankMid} relies on customer conduct or credential-related factors described in the bank correspondence.`
}

export function buildBankPositionNarrative(input: BuildBankPositionNarrativeInput): {
  position: SubmissionBankPosition
  diagnostics: BankPositionBuildDiagnostics
} {
  const rawCount = input.assertions.length

  if (!rawCount) {
    return {
      position: {
        narrative: "No clear bank position has been extracted from the available documents.",
        stated_grounds: [],
        evidence_refs: [],
      },
      diagnostics: {
        raw_bank_assertions: 0,
        grouped_assertions: {
          authentication: 0,
          rejection: 0,
          customer_responsibility: 0,
        },
        evidence_refs_used: [],
        duplicate_assertions_merged: 0,
      },
    }
  }

  const bankName = detectBankName(input.assertions, input.evidenceLabels)
  const groups = classifyAssertionGroups(input.assertions)
  const authDeduped = dedupeAssertions(groups.authentication)
  const duplicateCount =
    authDeduped.duplicateCount +
    dedupeAssertions(groups.customer_responsibility).duplicateCount +
    dedupeAssertions(groups.other).duplicateCount

  const evidenceRefs = resolveEvidenceRefs({
    assertions: [...authDeduped.deduped, ...groups.rejection],
    evidenceLabels: input.evidenceLabels,
  })

  const narrativeParts: string[] = []
  const bankSentence = bankLabelForSentence(bankName)
  const bankMid = bankLabelForMidSentence(bankName)

  if (authDeduped.deduped.length) {
    const mechanisms = summarizeAuthenticationMechanismsForReliance(authDeduped.deduped)
    narrativeParts.push(
      `${bankSentence} states that the disputed transactions were authenticated using recognised payment authentication mechanisms. In particular, the bank relies on ${mechanisms} as evidence that the transactions were authorised.`,
    )
  } else if (groups.other.length) {
    narrativeParts.push(
      `${bankSentence} maintains the position set out in the available bank correspondence.`,
    )
  }

  const customerSentence = buildCustomerResponsibilitySentence(bankName, groups.customer_responsibility)
  if (customerSentence) {
    narrativeParts.push(customerSentence)
  }

  if (groups.rejection.length) {
    narrativeParts.push(`On that basis, ${bankMid} declined the customer's dispute.`)
  }

  const narrative = `${narrativeParts.join(" ")}${formatEvidenceRefsInline(evidenceRefs)}`.trim()

  return {
    position: {
      narrative,
      stated_grounds: [],
      evidence_refs: evidenceRefs,
    },
    diagnostics: {
      raw_bank_assertions: rawCount,
      grouped_assertions: {
        authentication: authDeduped.deduped.length,
        rejection: groups.rejection.length > 0 ? 1 : 0,
        customer_responsibility: groups.customer_responsibility.length,
      },
      evidence_refs_used: evidenceRefs,
      duplicate_assertions_merged: duplicateCount,
    },
  }
}

export type { BankPositionBuildDiagnostics }
