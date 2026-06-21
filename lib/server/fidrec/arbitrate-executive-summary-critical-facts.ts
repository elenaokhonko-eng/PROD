import type { EvidencePresentationContext } from "@/lib/server/fidrec/build-evidence-links"
import type { EvidenceLabel, FidrecEvidenceType } from "@/lib/types/fidrec-evidence-labels"
import type {
  ExecutiveSummaryCriticalFactDiagnostics,
  ExecutiveSummaryDisputedAmount,
  ExecutiveSummaryFactConfidence,
} from "@/lib/types/fidrec-submission-pack"
import type { CaseFindingRow } from "@/lib/types/fidrec"

export type FactCandidateSourceType =
  | "primary_narrative"
  | "case_metadata"
  | "starting_narrative"
  | "police_report"
  | "statutory_declaration"
  | "bank_final_response"
  | "bank_statement"
  | "case_extract_json"
  | "case_finding"
  | "document_chunk"
  | "evidence_label"

export type FactCandidate<T> = {
  value: T
  source_type: FactCandidateSourceType
  source_label: string | null
  confidence: ExecutiveSummaryFactConfidence
  evidence_ref?: string | null
  is_approximate?: boolean
}

export type ArbitrateCriticalFactsInput = {
  findings: CaseFindingRow[]
  evidenceLabels: EvidenceLabel[]
  documentPresentationById: Map<string, EvidencePresentationContext>
  documentChunkTextById?: Map<string, string>
  extractJson?: Record<string, unknown> | null
  claimAmount?: string | number | null
  claimCurrency?: string | null
  customerName?: string | null
  primaryNarrative?: string | null
}

export type ArbitrateCriticalFactsResult = {
  customerName: FactCandidate<string> | null
  disputedAmount: FactCandidate<ExecutiveSummaryDisputedAmount> | null
  accountOrCard: FactCandidate<string> | null
  diagnostics: ExecutiveSummaryCriticalFactDiagnostics
}

const LOSS_SOURCE_PRIORITY: Record<FactCandidateSourceType, number> = {
  primary_narrative: 0,
  case_metadata: 1,
  starting_narrative: 2,
  police_report: 3,
  statutory_declaration: 4,
  bank_final_response: 5,
  bank_statement: 6,
  case_extract_json: 7,
  case_finding: 8,
  document_chunk: 9,
  evidence_label: 10,
}

const CUSTOMER_NAME_PRIORITY: Record<FactCandidateSourceType, number> = {
  primary_narrative: 0,
  case_metadata: 1,
  starting_narrative: 2,
  police_report: 3,
  statutory_declaration: 4,
  bank_final_response: 5,
  bank_statement: 6,
  case_extract_json: 7,
  case_finding: 8,
  document_chunk: 9,
  evidence_label: 10,
}

const ACCOUNT_SOURCE_PRIORITY: Record<FactCandidateSourceType, number> = {
  case_extract_json: 1,
  bank_final_response: 2,
  bank_statement: 3,
  document_chunk: 4,
  evidence_label: 5,
  case_metadata: 6,
  starting_narrative: 7,
  police_report: 8,
  statutory_declaration: 9,
  case_finding: 10,
}

const NAME_BLOCKLIST = new Set(
  [
    "Police Report",
    "Singapore Police",
    "United Arab",
    "New York",
    "Hong Kong",
    "October",
    "November",
    "December",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "PayNow",
    "Fast Payment",
    "Mobile Wallet",
    "Digital Token",
    "Customer Service",
    "Fraud Hotline",
    "Bank Statement",
    "Standard Chartered",
    "DBS Bank",
  ].map((value) => value.toLowerCase()),
)

const EVIDENCE_TYPE_TO_LOSS_SOURCE: Partial<Record<FidrecEvidenceType, FactCandidateSourceType>> = {
  customer_narrative: "starting_narrative",
  police_report: "police_report",
  statutory_declaration: "statutory_declaration",
  bank_final_response: "bank_final_response",
  bank_investigation_report: "bank_final_response",
  bank_email_or_letter: "bank_final_response",
  transaction_history: "bank_statement",
}

const EVIDENCE_TYPE_TO_NAME_SOURCE: Partial<Record<FidrecEvidenceType, FactCandidateSourceType>> = {
  customer_narrative: "starting_narrative",
  police_report: "police_report",
  statutory_declaration: "statutory_declaration",
  bank_email_or_letter: "bank_final_response",
  bank_final_response: "bank_final_response",
}

type DocumentTextRef = {
  text: string
  evidenceRef: string
  evidenceType: FidrecEvidenceType
  sourceType: FactCandidateSourceType
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.\-]/g, "")
    if (!cleaned) return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeCurrency(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim().toUpperCase()
  if (!normalized) return null
  if (normalized === "S$" || normalized === "S") return "SGD"
  return normalized
}

function formatLossDisplay(amount: number, currency: string): string {
  const formatted = amount.toLocaleString("en-SG", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${currency} ${formatted}`
}

const ORG_NAME_PATTERN =
  /\b(police|force|bank|framework|department|ministry|authority|limited|ltd|inc|corp|corporation|company|pte|services|republic|government|commission|office|division|unit|hotline|scam|fraud|shared responsibility)\b/i

function normalizePersonName(value: string): string {
  const trimmed = value.trim()
  if (/^[A-Z]{2,}(?:\s+[A-Z]{2,})+$/.test(trimmed)) {
    return trimmed
      .split(/\s+/)
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(" ")
  }
  return trimmed
}

function isPersonName(value: string): boolean {
  const trimmed = normalizePersonName(value)
  if (/\n/.test(value)) return false
  if (
    /\b(dispute|status|update|formal|demand|investigation|report|contact|gmail|police|bank|framework|shared|responsibility)\b/i.test(
      trimmed,
    )
  ) {
    return false
  }
  if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,5}$/.test(trimmed)) return false
  if (ORG_NAME_PATTERN.test(trimmed)) return false
  const lower = trimmed.toLowerCase()
  if (NAME_BLOCKLIST.has(lower)) return false
  for (const token of trimmed.split(/\s+/)) {
    if (NAME_BLOCKLIST.has(token.toLowerCase())) return false
    if (ORG_NAME_PATTERN.test(token)) return false
  }
  return true
}

function extractPersonNames(text: string): string[] {
  const names = new Set<string>()
  const patterns = [
    /\bI,\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+)+),?\s/gi,
    /Dear\s+(?:Ms|Mr|Mrs|Miss|Dr)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){0,3})/g,
    /(?:complainant(?:'s)?\s+name|name\s+of\s+(?:the\s+)?complainant|reported by|name[:\s]+)\s*[:.]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,4})/gi,
    /\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,4})\b/g,
    /\b([A-Z]{2,})\s+([A-Z]{2,}(?:\s+[A-Z]{2,}){1,4})\b/g,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){2,4})\s*<\s*[a-z0-9._%+-]+@/g,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const rawCandidate = match[2] ? `${match[1]} ${match[2]}` : match[1]
      const candidate = normalizePersonName(rawCandidate?.trim() ?? "")
      if (candidate && isPersonName(candidate)) names.add(candidate)
    }
  }

  return [...names]
}

function extractMoneyFromText(text: string): Array<{ amount: number; currency: string }> {
  const results: Array<{ amount: number; currency: string }> = []
  const patterns = [
    /\b(AED|SGD|USD|EUR)\s*([\d,]+(?:\.\d{2})?)\b/gi,
    /\bS\$\s*([\d,]+(?:\.\d{2})?)\b/gi,
    /\b([\d,]+(?:\.\d{2})?)\s*(AED|SGD|USD|EUR)\b/gi,
    /total\s+(?:loss|disputed|amount)[^.\n]{0,40}?(AED|SGD|USD|EUR|S\$)\s*([\d,]+(?:\.\d{2})?)/gi,
    /loss(?:\s+of)?\s+(AED|SGD|USD|EUR|S\$)\s*([\d,]+(?:\.\d{2})?)/gi,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      let currency: string | null = null
      let amountRaw: string | null = null

      if (match[1] && /[A-Z$]/i.test(match[1]) && match[2]) {
        currency = normalizeCurrency(match[1])
        amountRaw = match[2]
      } else if (match[2] && /[A-Z]/i.test(match[2]) && match[1]) {
        currency = normalizeCurrency(match[2])
        amountRaw = match[1]
      } else if (match[1] && !match[2]) {
        currency = "SGD"
        amountRaw = match[1]
      }

      const amount = safeNumber(amountRaw)
      if (amount !== null && currency) {
        results.push({ amount, currency })
      }
    }
  }

  return results
}

function extractionSpanCorpus(json: Record<string, unknown> | null | undefined): string {
  if (!json) return ""
  const spans = json.evidence_spans
  if (!Array.isArray(spans)) return ""
  return spans
    .map((span) => {
      if (!span || typeof span !== "object" || Array.isArray(span)) return ""
      const quote = (span as Record<string, unknown>).quote
      return typeof quote === "string" ? quote : ""
    })
    .filter(Boolean)
    .join("\n")
}

function getDocumentTexts(input: ArbitrateCriticalFactsInput): DocumentTextRef[] {
  const refs: DocumentTextRef[] = []

  for (const label of input.evidenceLabels) {
    const presentation = input.documentPresentationById.get(label.case_document_id)
    const chunkText = input.documentChunkTextById?.get(label.case_document_id)?.trim()
    const summaryText = presentation?.extractedText?.trim()
    const spanText = extractionSpanCorpus(presentation?.extractedJson).trim()
    const text = [chunkText, summaryText, spanText].filter(Boolean).join("\n")
    if (!text) continue

    const sourceType =
      EVIDENCE_TYPE_TO_LOSS_SOURCE[label.evidence_type] ??
      EVIDENCE_TYPE_TO_NAME_SOURCE[label.evidence_type] ??
      "document_chunk"

    refs.push({
      text,
      evidenceRef: label.label,
      evidenceType: label.evidence_type,
      sourceType,
    })
  }

  return refs
}

function extractPrimaryNarrativeClaimantName(text: string): string | null {
  const match = text.match(/\bI,\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+)+)\b/)
  if (!match?.[1]) return null
  const name = normalizePersonName(match[1].trim())
  return isPersonName(name) ? name : name
}

function buildCustomerNameCandidates(input: ArbitrateCriticalFactsInput): FactCandidate<string>[] {
  const candidates: FactCandidate<string>[] = []

  if (input.primaryNarrative?.trim()) {
    const primaryName = extractPrimaryNarrativeClaimantName(input.primaryNarrative)
    if (primaryName) {
      candidates.push({
        value: primaryName,
        source_type: "primary_narrative",
        source_label: "cases.primary_narrative",
        confidence: "high",
      })
    }

    for (const name of extractPersonNames(input.primaryNarrative)) {
      if (name === primaryName) continue
      candidates.push({
        value: name,
        source_type: "primary_narrative",
        source_label: "cases.primary_narrative",
        confidence: "high",
      })
    }
  }

  if (input.customerName?.trim()) {
    candidates.push({
      value: input.customerName.trim(),
      source_type: "case_metadata",
      source_label: "cases.customer_name",
      confidence: "high",
    })
  }

  const customer = input.extractJson?.customer
  if (customer && typeof customer === "object" && !Array.isArray(customer)) {
    const name = (customer as Record<string, unknown>).name
    if (typeof name === "string" && name.trim() && isPersonName(name.trim())) {
      candidates.push({
        value: name.trim(),
        source_type: "case_extract_json",
        source_label: "extract_json.customer.name",
        confidence: "high",
      })
    }
  }

  const caseMeta =
    input.extractJson?.case_meta && typeof input.extractJson.case_meta === "object"
      ? (input.extractJson.case_meta as Record<string, unknown>)
      : null
  const metaName = caseMeta?.customer_name
  if (typeof metaName === "string" && metaName.trim() && isPersonName(metaName.trim())) {
    candidates.push({
      value: metaName.trim(),
      source_type: "case_extract_json",
      source_label: "extract_json.case_meta.customer_name",
      confidence: "medium",
    })
  }

  for (const doc of getDocumentTexts(input)) {
    const nameSource = EVIDENCE_TYPE_TO_NAME_SOURCE[doc.evidenceType]
    if (!nameSource) continue

    for (const name of extractPersonNames(doc.text)) {
      candidates.push({
        value: name,
        source_type: nameSource,
        source_label: `${nameSource} chunk`,
        confidence: nameSource === "police_report" ? "high" : "medium",
        evidence_ref: doc.evidenceRef,
      })
    }
  }

  return candidates
}

function moneyContext(text: string, amount: number): string {
  const formatted = amount.toLocaleString("en-SG", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
  const compact = String(amount)
  const idx = Math.max(text.indexOf(formatted), text.indexOf(compact))
  if (idx < 0) return text.slice(0, 120)
  return text.slice(Math.max(0, idx - 60), idx + 60)
}

function buildLossAmountCandidates(input: ArbitrateCriticalFactsInput): FactCandidate<ExecutiveSummaryDisputedAmount>[] {
  const candidates: FactCandidate<ExecutiveSummaryDisputedAmount>[] = []

  if (input.primaryNarrative?.trim()) {
    for (const money of extractMoneyFromText(input.primaryNarrative)) {
      const context = moneyContext(input.primaryNarrative, money.amount)
      if (/\b(?:daily\s+)?(?:transfer|transaction)\s+limit\b/i.test(context)) continue
      const isApproximate = /\b(approx(?:\.|imately)?|about|around)\b/i.test(context)
      const isTotalLabel = /total\s+loss/i.test(context)
      if (!isTotalLabel && !isApproximate) continue
      candidates.push({
        value: money,
        source_type: "primary_narrative",
        source_label: isTotalLabel ? "cases.primary_narrative.total_loss" : "cases.primary_narrative.amount",
        confidence: isApproximate ? "medium" : "high",
        is_approximate: isApproximate,
      })
    }
  }

  if (input.claimAmount !== null && input.claimAmount !== undefined) {
    const amount = safeNumber(input.claimAmount)
    const currency = normalizeCurrency(input.claimCurrency) ?? "SGD"
    if (amount !== null) {
      candidates.push({
        value: { amount, currency },
        source_type: "case_metadata",
        source_label: "cases.claim_amount",
        confidence: "high",
      })
    }
  }

  for (const doc of getDocumentTexts(input)) {
    const lossSource = EVIDENCE_TYPE_TO_LOSS_SOURCE[doc.evidenceType]
    if (!lossSource || lossSource === "case_extract_json") continue

    const isTotalLabel = /total\s+(?:loss|disputed)|disputed\s+total|loss\s+of|total\s+loss\s+amount/i.test(doc.text)
    if (lossSource === "bank_statement" && !isTotalLabel) continue

    for (const money of extractMoneyFromText(doc.text)) {
      candidates.push({
        value: money,
        source_type: lossSource,
        source_label: isTotalLabel ? `${lossSource}.total_loss` : `${lossSource}.amount`,
        confidence: isTotalLabel ? "high" : "medium",
        is_approximate: /\b(approx(?:\.|imately)?|about|around)\b/i.test(doc.text),
        evidence_ref: doc.evidenceRef,
      })
    }
  }

  const reportedLoss =
    input.extractJson?.reported_loss && typeof input.extractJson.reported_loss === "object"
      ? (input.extractJson.reported_loss as Record<string, unknown>)
      : null
  const reportedAmount = safeNumber(reportedLoss?.amount)
  const reportedCurrency = normalizeCurrency(reportedLoss?.currency)
  if (reportedAmount !== null) {
    candidates.push({
      value: { amount: reportedAmount, currency: reportedCurrency ?? "SGD" },
      source_type: "case_extract_json",
      source_label: "case_extract_json.server_computed_total",
      confidence: "medium",
    })
  }

  if (Array.isArray(input.extractJson?.losses)) {
    let lossSum = 0
    let currency: string | null = null
    let hasServerComputed = false
    for (const loss of input.extractJson.losses) {
      if (!loss || typeof loss !== "object" || Array.isArray(loss)) continue
      const record = loss as Record<string, unknown>
      const lossAmount = safeNumber(record.amount)
      if (lossAmount !== null) lossSum += lossAmount
      if (!currency) currency = normalizeCurrency(record.currency)
      if (typeof record.description === "string" && /server-computed/i.test(record.description)) {
        hasServerComputed = true
      }
    }
    if (lossSum > 0) {
      candidates.push({
        value: { amount: lossSum, currency: currency ?? "SGD" },
        source_type: "case_extract_json",
        source_label: hasServerComputed
          ? "case_extract_json.losses.server_computed_sum"
          : "case_extract_json.losses.sum",
        confidence: hasServerComputed ? "medium" : "low",
      })
    }
  }

  for (const finding of input.findings) {
    for (const money of extractMoneyFromText(finding.finding_text)) {
      candidates.push({
        value: money,
        source_type: "case_finding",
        source_label: "case_findings.amount",
        confidence: "medium",
      })
    }
  }

  return candidates
}

function formatAccountOrCard(kind: "account" | "card", lastFour: string): string {
  return `${kind} ending ${lastFour}`
}

function extractAccountCardFromText(text: string): Array<{ value: string; kind: "account" | "card" }> {
  const results: Array<{ value: string; kind: "account" | "card" }> = []
  const patterns: Array<{ pattern: RegExp; kind: "account" | "card" }> = [
    { pattern: /\b(card)\s+ending\s+(?:\*{2,4}|•{2,4}|x{4})?(\d{4})\b/i, kind: "card" },
    { pattern: /\b(account)\s+ending\s+(?:\*{2,4}|•{2,4}|x{4})?(\d{4})\b/i, kind: "account" },
    { pattern: /\b(card)\s+(?:no\.?|number)?\s*(?:\*{4}|•{4}|x{4})(\d{4})\b/i, kind: "card" },
    { pattern: /\b(account)\s+(?:no\.?|number)?\s*(?:\*{4}|•{4}|x{4})(\d{4})\b/i, kind: "account" },
    { pattern: /\bending\s+(?:\*{2,4}|•{2,4}|x{4})(\d{4})\b/i, kind: "account" },
  ]

  for (const entry of patterns) {
    const match = text.match(entry.pattern)
    if (!match) continue
    const lastFour = match[match.length - 1]
    if (lastFour) {
      results.push({ value: formatAccountOrCard(entry.kind, lastFour), kind: entry.kind })
    }
  }

  const contextualFullNumber = text.match(/\b(?:card|account)\s+(?:no\.?|number)?\s*[:#]?\s*(\d{12,19})\b/i)
  if (contextualFullNumber?.[1]) {
    const kind = /card/i.test(contextualFullNumber[0]) ? "card" : "account"
    results.push({
      value: formatAccountOrCard(kind, contextualFullNumber[1].slice(-4)),
      kind,
    })
  }

  return results
}

function buildAccountCardCandidates(input: ArbitrateCriticalFactsInput): FactCandidate<string>[] {
  const candidates: FactCandidate<string>[] = []

  const jsonCorpus = JSON.stringify({
    account: input.extractJson?.account ?? null,
    card: input.extractJson?.card ?? null,
  })
  for (const entry of extractAccountCardFromText(jsonCorpus)) {
    candidates.push({
      value: entry.value,
      source_type: "case_extract_json",
      source_label: "extract_json.account_or_card",
      confidence: "high",
    })
  }

  for (const doc of getDocumentTexts(input)) {
    const label = input.evidenceLabels.find((entry) => entry.label === doc.evidenceRef)
    const sourceType =
      label?.evidence_type === "transaction_history"
        ? "bank_statement"
        : label?.evidence_type === "bank_email_or_letter" ||
            label?.evidence_type === "bank_final_response" ||
            label?.evidence_type === "bank_investigation_report"
          ? "bank_final_response"
          : "document_chunk"

    for (const entry of extractAccountCardFromText(doc.text)) {
      candidates.push({
        value: entry.value,
        source_type: sourceType,
        source_label: `${sourceType} chunk`,
        confidence: "high",
        evidence_ref: doc.evidenceRef,
      })
    }
  }

  for (const label of input.evidenceLabels) {
    const corpus = [label.short_description, label.original_filename ?? ""].join(" ")
    for (const entry of extractAccountCardFromText(corpus)) {
      candidates.push({
        value: entry.value,
        source_type: "evidence_label",
        source_label: "evidence_label.summary",
        confidence: "low",
        evidence_ref: label.label,
      })
    }
  }

  return candidates
}

function selectByPriority<T>(
  candidates: FactCandidate<T>[],
  priorityMap: Record<FactCandidateSourceType, number>,
): { selected: FactCandidate<T> | null; reason: string | null } {
  if (!candidates.length) return { selected: null, reason: null }

  const sorted = candidates.slice().sort((left, right) => {
    const leftPriority = priorityMap[left.source_type] ?? 99
    const rightPriority = priorityMap[right.source_type] ?? 99
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    const confidenceRank = { high: 0, medium: 1, low: 2 }
    return confidenceRank[left.confidence] - confidenceRank[right.confidence]
  })

  const primaryNarrativeCandidate = sorted.find(
    (candidate) => candidate.source_type === "primary_narrative" && candidate.confidence === "high",
  )
  if (primaryNarrativeCandidate) {
    return {
      selected: primaryNarrativeCandidate,
      reason: "selected cases.primary_narrative as highest-priority available source",
    }
  }

  const selected = sorted[0]
  const runnerUp = sorted[1]

  if (!runnerUp) {
    return { selected, reason: `selected ${selected.source_type} as highest-priority available source` }
  }

  if (
    selected.source_type !== runnerUp.source_type &&
    selected.value &&
    runnerUp.value &&
    JSON.stringify(selected.value) !== JSON.stringify(runnerUp.value)
  ) {
    return {
      selected,
      reason: `selected ${selected.source_type} over ${runnerUp.source_type}`,
    }
  }

  return { selected, reason: `selected ${selected.source_type} as highest-priority available source` }
}

function isStatedLossSource(sourceType: FactCandidateSourceType): boolean {
  return (LOSS_SOURCE_PRIORITY[sourceType] ?? 99) < LOSS_SOURCE_PRIORITY.case_extract_json
}

function isServerComputedLossCandidate(candidate: FactCandidate<ExecutiveSummaryDisputedAmount>): boolean {
  return candidate.source_type === "case_extract_json"
}

function sortLossCandidates(
  candidates: FactCandidate<ExecutiveSummaryDisputedAmount>[],
): FactCandidate<ExecutiveSummaryDisputedAmount>[] {
  return candidates.slice().sort((left, right) => {
    const leftPriority = LOSS_SOURCE_PRIORITY[left.source_type] ?? 99
    const rightPriority = LOSS_SOURCE_PRIORITY[right.source_type] ?? 99
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    const confidenceRank = { high: 0, medium: 1, low: 2 }
    return confidenceRank[left.confidence] - confidenceRank[right.confidence]
  })
}

function lossCandidateScore(candidate: FactCandidate<ExecutiveSummaryDisputedAmount>): number {
  let score = 0
  if (candidate.source_label?.includes("total_loss")) score += 100
  if (!candidate.is_approximate) score += 50
  score -= LOSS_SOURCE_PRIORITY[candidate.source_type] ?? 99
  const confidenceRank = { high: 0, medium: 1, low: 2 }
  score -= confidenceRank[candidate.confidence]
  return score
}

function selectLossAmount(
  candidates: FactCandidate<ExecutiveSummaryDisputedAmount>[],
): { selected: FactCandidate<ExecutiveSummaryDisputedAmount> | null; reason: string | null } {
  if (!candidates.length) return { selected: null, reason: null }

  const sorted = candidates.slice().sort((left, right) => lossCandidateScore(right) - lossCandidateScore(left))
  const stated = sorted.filter((candidate) => isStatedLossSource(candidate.source_type))
  const extractJson = sorted.filter((candidate) => isServerComputedLossCandidate(candidate))

  if (stated.length) {
    const selected = stated[0]
    const reason = extractJson.length
      ? `selected stated ${selected.source_label ?? selected.source_type} over ${extractJson[0].source_label ?? "server-computed extract JSON"}`
      : `selected ${selected.source_label ?? selected.source_type} over approximate or lower-priority sources`
    return { selected, reason }
  }

  const selected = sorted[0]
  return {
    selected,
    reason: selected ? `selected ${selected.source_type} as highest-priority available source` : null,
  }
}

function formatCandidateLine<T>(candidate: FactCandidate<T>): string {
  const evidence = candidate.evidence_ref ? ` | evidence: ${candidate.evidence_ref}` : ""
  const sourceLabel =
    candidate.source_type === "primary_narrative"
      ? "cases.primary_narrative"
      : candidate.source_type === "case_metadata"
        ? "cases.claim_amount"
        : candidate.source_type === "bank_final_response"
          ? candidate.source_label?.includes("total_loss")
            ? "police acknowledgement / bank correspondence"
            : "bank correspondence"
          : candidate.source_type === "case_extract_json"
            ? candidate.source_label?.includes("server")
              ? "extract_json server-computed total"
              : "extract_json"
            : candidate.source_type
  if (typeof candidate.value === "object" && candidate.value && "amount" in candidate.value) {
    const money = candidate.value as ExecutiveSummaryDisputedAmount
    return `${formatLossDisplay(money.amount, money.currency)} | source: ${sourceLabel} | confidence: ${candidate.confidence}${evidence}`
  }
  return `${String(candidate.value)} | source: ${sourceLabel} | confidence: ${candidate.confidence}${evidence}`
}

export function arbitrateExecutiveSummaryCriticalFacts(
  input: ArbitrateCriticalFactsInput,
): ArbitrateCriticalFactsResult {
  const customerNameCandidates = buildCustomerNameCandidates(input)
  const lossAmountCandidates = buildLossAmountCandidates(input)
  const accountCardCandidates = buildAccountCardCandidates(input)

  const customerSelection = selectByPriority(customerNameCandidates, CUSTOMER_NAME_PRIORITY)
  const lossSelection = selectLossAmount(lossAmountCandidates)
  const accountSelection = selectByPriority(accountCardCandidates, ACCOUNT_SOURCE_PRIORITY)

  return {
    customerName: customerSelection.selected,
    disputedAmount: lossSelection.selected,
    accountOrCard: accountSelection.selected,
    diagnostics: {
      customer_name_candidates: customerNameCandidates.map(formatCandidateLine),
      selected_customer_name: customerSelection.selected?.value ?? null,
      selected_customer_name_reason: customerSelection.reason,
      loss_amount_candidates: lossAmountCandidates.map(formatCandidateLine),
      selected_loss_amount: lossSelection.selected
        ? formatLossDisplay(lossSelection.selected.value.amount, lossSelection.selected.value.currency)
        : null,
      selected_loss_amount_reason: lossSelection.reason,
      account_card_candidates: accountCardCandidates.map(formatCandidateLine),
      selected_account_or_card: accountSelection.selected?.value ?? null,
      selected_account_or_card_reason: accountSelection.reason,
    },
  }
}
