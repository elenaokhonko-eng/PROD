import { arbitrateExecutiveSummaryCriticalFacts } from "@/lib/server/fidrec/arbitrate-executive-summary-critical-facts"
import type { EvidencePresentationContext } from "@/lib/server/fidrec/build-evidence-links"
import type { CasePackTheme } from "@/lib/types/fidrec-case-pack"
import type { EvidenceLabel } from "@/lib/types/fidrec-evidence-labels"
import type { ChronologyEvent } from "@/lib/types/fidrec-chronology"
import type {
  ExecutiveSummaryBankDecisionEvent,
  ExecutiveSummaryCaseOverviewDiagnostics,
  ExecutiveSummaryCriticalFactDiagnostics,
  ExecutiveSummaryCustomerNotificationEvent,
  ExecutiveSummaryDisputedAmount,
  ExecutiveSummaryFactConfidence,
  ExecutiveSummaryFacts,
  FactValue,
} from "@/lib/types/fidrec-submission-pack"
import type { CaseBankAssertionRow, CaseFindingRow } from "@/lib/types/fidrec"

/**
 * EXECUTIVE SUMMARY FACT PRIORITY
 *
 * Claimant Name:
 * 1. cases.primary_narrative
 * 2. police report
 * 3. statutory declaration
 * 4. extract json
 *
 * Loss Amount:
 * 1. primary_narrative
 * 2. police report
 * 3. bank-confirmed loss amount
 * 4. cases.claim_amount
 * 5. extract_json
 *
 * IMPORTANT:
 * Never allow server-computed extract totals
 * to override an explicit loss amount stated
 * in primary_narrative, police reports,
 * or bank-confirmed correspondence.
 */

export type BuildExecutiveSummaryNarrativeInput = {
  findings: CaseFindingRow[]
  assertions: CaseBankAssertionRow[]
  keyThemes: CasePackTheme[]
  evidenceLabels: EvidenceLabel[]
  documentPresentationById: Map<string, EvidencePresentationContext>
  documentChunkTextById?: Map<string, string>
  chronologyEvents: ChronologyEvent[]
  extractJson?: Record<string, unknown> | null
  claimAmount?: string | number | null
  claimCurrency?: string | null
  institutionName?: string | null
  customerName?: string | null
  primaryNarrative?: string | null
}

export type ExecutiveSummaryLossBreakdownComponent = {
  amount: number
  currency: string
  description: string
  source: string | null
  confidence: ExecutiveSummaryFactConfidence
}

export type BuildExecutiveSummaryNarrativeResult = {
  narrative: string
  facts: ExecutiveSummaryFacts
  criticalFactDiagnostics: ExecutiveSummaryCriticalFactDiagnostics
  caseOverviewDiagnostics: ExecutiveSummaryCaseOverviewDiagnostics
}

const BANK_NAME_PATTERN =
  /\b(DBS|OCBC|UOB|HSBC|Standard Chartered|Citibank|Maybank|CIMB|Bank of China|ANZ)\b/i

const MERCHANT_STOPWORDS =
  /\b(DBS(?:\s*\/\s*POSB)?\s*BANK|DBS BANK|PAYNOW|FAST(?:\s+PAYMENT)?|RECEIPT)\b/gi

const PRODUCT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bvisa\s+debit\b/i, label: "Visa Debit card" },
  { pattern: /\bvisa\s+credit\b/i, label: "Visa Credit card" },
  { pattern: /\bmastercard\s+debit\b/i, label: "Mastercard Debit card" },
  { pattern: /\bmastercard\s+credit\b/i, label: "Mastercard Credit card" },
  { pattern: /\bsavings\s+account\b/i, label: "savings account" },
  { pattern: /\bcurrent\s+account\b/i, label: "current account" },
  { pattern: /\bcredit\s+card\b/i, label: "Visa Credit card" },
  { pattern: /\bdebit\s+card\b/i, label: "Visa Debit card" },
  { pattern: /\bbank\s+account\b/i, label: "bank account" },
  { pattern: /\bcard\s+account\b/i, label: "card account" },
]

const ALLOWED_PRINCIPAL_ISSUES = [
  "the transactions were genuinely authorised",
  "the transaction pattern should reasonably have triggered fraud detection or intervention",
  "the bank's response following customer notification was timely and appropriate",
  "the bank provided sufficient reasons and evidence for declining the dispute",
] as const

const NUMBER_TO_WORD: Record<number, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
}

function fact<T>(
  value: T | null,
  source: string | null,
  confidence: ExecutiveSummaryFactConfidence,
): FactValue<T> {
  return { value, source, confidence }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function formatCount(count: number): string {
  return NUMBER_TO_WORD[count] ?? String(count)
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

function formatCurrencyDisplay(amount: number, currency: string): string {
  const formatted = amount.toLocaleString("en-SG", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
  if (currency === "SGD") return `S$${formatted}`
  return `${currency} ${formatted}`
}

function formatAmount(amount: number, currency: string): string {
  return formatCurrencyDisplay(amount, currency)
}

function findingsCorpus(findings: CaseFindingRow[]): string {
  return findings.map((finding) => finding.finding_text).join(" ")
}

function assertionsCorpus(assertions: CaseBankAssertionRow[]): string {
  return assertions
    .flatMap((assertion) => [assertion.assertion_text, assertion.bank_conclusion_supported ?? ""])
    .join(" ")
}

function documentSummaries(input: BuildExecutiveSummaryNarrativeInput): string {
  const parts: string[] = []
  for (const label of input.evidenceLabels) {
    const presentation = input.documentPresentationById.get(label.case_document_id)
    if (presentation?.extractedText) parts.push(presentation.extractedText)
    const spans = presentation?.extractedJson?.evidence_spans
    if (Array.isArray(spans)) {
      for (const span of spans) {
        if (!span || typeof span !== "object" || Array.isArray(span)) continue
        const quote = (span as Record<string, unknown>).quote
        if (typeof quote === "string" && quote.trim()) parts.push(quote.trim())
      }
    }
  }
  return parts.join(" ")
}

function buildAuthoritativeCorpus(input: BuildExecutiveSummaryNarrativeInput): string {
  return [
    input.primaryNarrative ?? "",
    assertionsCorpus(input.assertions),
    documentSummaries(input),
    findingsCorpus(input.findings),
    JSON.stringify(input.extractJson ?? {}),
  ].join(" ")
}

function extractionSpanCorpusFromPresentation(
  presentation: EvidencePresentationContext | undefined,
): string {
  const spans = presentation?.extractedJson?.evidence_spans
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

function maskCardNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  if (digits.length < 8) return null
  return `card ending ${digits.slice(-4)}`
}

function extractLossBreakdown(corpus: string): ExecutiveSummaryLossBreakdownComponent[] {
  const components: ExecutiveSummaryLossBreakdownComponent[] = []

  const depositMatch = corpus.match(
    /Deposit Account\s*\((?:FAST\/Paynow|FAST\/PayNow)[^)]*\)[^$\d]{0,20}\$?\s*([\d,]+(?:\.\d{2})?)/i,
  )
  if (depositMatch?.[1]) {
    const amount = safeNumber(depositMatch[1])
    if (amount !== null) {
      components.push({
        amount,
        currency: "SGD",
        description: "FAST/PayNow transfers from her deposit account",
        source: "bank_correspondence.loss_breakdown",
        confidence: "high",
      })
    }
  }

  const cardMatch = corpus.match(/Credit Card Transactions:\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)
  if (cardMatch?.[1]) {
    const amount = safeNumber(cardMatch[1])
    if (amount !== null) {
      components.push({
        amount,
        currency: "SGD",
        description: "fraudulent credit card transactions",
        source: "bank_correspondence.loss_breakdown",
        confidence: "high",
      })
    }
  }

  return components
}

function resolveClaimantHonorific(corpus: string, claimantName: string | null): "Ms" | "Mr" | "Mrs" | null {
  if (!claimantName) return null
  const nameParts = claimantName.split(/\s+/)
  for (const part of nameParts) {
    if (new RegExp(`Dear\\s+Ms\\.?\\s+${part}`, "i").test(corpus)) return "Ms"
    if (new RegExp(`Dear\\s+Mr\\.?\\s+${part}`, "i").test(corpus)) return "Mr"
    if (new RegExp(`Dear\\s+Mrs\\.?\\s+${part}`, "i").test(corpus)) return "Mrs"
  }
  if (/\bMs\.?\s+[A-Z]/i.test(corpus) && nameParts.some((part) => corpus.includes(part))) return "Ms"
  return null
}

function resolveScamTypePhrase(input: BuildExecutiveSummaryNarrativeInput, corpus: string): FactValue<string> {
  if (/phishing/i.test(corpus) || input.extractJson?.case_meta) {
    const claimType =
      input.extractJson?.case_meta && typeof input.extractJson.case_meta === "object"
        ? (input.extractJson.case_meta as Record<string, unknown>).claim_type
        : null
    if (typeof claimType === "string" && /phishing/i.test(claimType)) {
      return fact("phishing scam", "extract_json.case_meta.claim_type", "high")
    }
    if (/phishing/i.test(corpus)) {
      return fact("phishing scam", "cases.primary_narrative", "high")
    }
  }
  return fact(null, null, "low")
}

function resolveProducts(input: BuildExecutiveSummaryNarrativeInput, corpus: string): FactValue<string[]> {
  const products = new Set<string>()
  const institution = resolveInstitutionName(input).value ?? "DBS"

  if (/\bdeposit account\b/i.test(corpus) || /\bsavings plus account\b/i.test(corpus) || /\bpaynow\b/i.test(corpus)) {
    products.add(`${institution} deposit account`)
  }
  if (/\bcredit card\b/i.test(corpus)) {
    products.add(`${institution} credit card`)
  }
  if (/\bDBS Savings Plus Account\b/i.test(corpus)) {
    products.add("DBS Savings Plus Account")
  }
  if (/\bDBS Altitude Visa Signature Card\b/i.test(corpus)) {
    products.add("DBS Altitude Visa Signature Card")
  }

  const cardEndingMatch = corpus.match(/\bcard ending\s+(\d{4})\b/i)
  if (cardEndingMatch?.[1]) {
    products.add(`card ending ${cardEndingMatch[1]}`)
  }

  const fullCardMatch = corpus.match(/\b(?:CARD|Card)\s+NO\.?:?\s*([\d ]{12,22})/i)
  if (fullCardMatch?.[1]) {
    const masked = maskCardNumber(fullCardMatch[1])
    if (masked) products.add(masked)
  }

  const deduped = uniqueStrings([...products])
  if (!deduped.length) return fact(null, null, "low")

  const source = input.primaryNarrative?.trim()
    ? "cases.primary_narrative_and_documents"
    : "document_extractions"
  return fact(deduped, source, "high")
}

function normalizeInstitutionLabel(value: string | null | undefined): string {
  if (!value?.trim()) return "The bank"
  if (/^DBS/i.test(value.trim())) return "DBS"
  return value.trim()
}

function resolveBankRejectionBasis(
  input: BuildExecutiveSummaryNarrativeInput,
  corpus: string,
): FactValue<string> {
  const institution = normalizeInstitutionLabel(resolveInstitutionName(input).value)
  const authBasis = resolveBankAuthenticationBasis(input)

  if (
    /unable to compensate|cannot be disputed|unsuccessful|rejected the restitution|declined the dispute|not applicable in your case/i.test(
      corpus,
    )
  ) {
    if (authBasis.value?.length) {
      return fact(
        `${institution} rejected the dispute on the basis that the transactions were authenticated using ${formatAuthenticationBasis(authBasis.value)}.`,
        "bank_correspondence_or_assertions",
        "high",
      )
    }
    return fact(
      `${institution} rejected the dispute on the basis that the transactions were authenticated.`,
      "bank_correspondence_or_assertions",
      "high",
    )
  }

  return fact(null, null, "low")
}

function formatProductsPhrase(products: string[]): string {
  const accountProducts = products.filter((product) => /deposit account|credit card/i.test(product))
  if (accountProducts.length >= 2) {
    return `involving her ${accountProducts.join(" and ")}`
  }
  if (accountProducts.length === 1) {
    return `involving her ${accountProducts[0]}`
  }
  if (products.length === 1) return `involving her ${products[0]}`
  if (products.length === 2) return `involving her ${products[0]} and ${products[1]}`
  if (products.length > 2) {
    return `involving her ${products.slice(0, -1).join(", ")}, and ${products[products.length - 1]}`
  }
  return ""
}

function buildCaseOverviewDiagnostics(input: {
  claimantName: FactValue<string>
  honorific: "Ms" | "Mr" | "Mrs" | null
  totalLoss: FactValue<ExecutiveSummaryDisputedAmount>
  lossBreakdown: ExecutiveSummaryLossBreakdownComponent[]
  products: FactValue<string[]>
  bankRejectionBasis: FactValue<string>
  criticalFactDiagnostics: ExecutiveSummaryCriticalFactDiagnostics
}): ExecutiveSummaryCaseOverviewDiagnostics {
  const claimantCandidates = input.criticalFactDiagnostics.customer_name_candidates.map((line) => {
    const [name] = line.split(" | source:")
    return name.trim()
  })

  const lossCandidates = input.criticalFactDiagnostics.loss_amount_candidates

  return {
    claimant_name_candidates: claimantCandidates,
    selected_claimant_name: input.claimantName.value,
    selected_claimant_name_reason: input.criticalFactDiagnostics.selected_customer_name_reason,
    loss_amount_candidates: lossCandidates,
    selected_loss_amount: input.totalLoss.value
      ? formatCurrencyDisplay(input.totalLoss.value.amount, input.totalLoss.value.currency)
      : null,
    selected_loss_amount_reason: input.criticalFactDiagnostics.selected_loss_amount_reason,
    loss_breakdown: input.lossBreakdown.map(
      (item) => `${formatCurrencyDisplay(item.amount, item.currency)} | ${item.description}`,
    ),
    products: input.products.value ?? [],
    bank_rejection_basis: input.bankRejectionBasis.value
      ? [input.bankRejectionBasis.value.replace(/\.$/, "")]
      : [],
  }
}

function parseCountToken(token: string): number | null {
  const numeric = Number(token)
  if (!Number.isNaN(numeric)) return numeric
  const wordToNumber: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  }
  return wordToNumber[token.toLowerCase()] ?? null
}

function resolveInstitutionName(input: BuildExecutiveSummaryNarrativeInput): FactValue<string> {
  if (input.institutionName?.trim()) {
    return fact(input.institutionName.trim(), "cases.institution_name", "high")
  }

  const primaryMatch = input.primaryNarrative?.match(BANK_NAME_PATTERN)
  if (primaryMatch?.[1]) {
    return fact(primaryMatch[1], "cases.primary_narrative", "high")
  }

  if (input.primaryNarrative && /\bDBS(?:\s*\/\s*POSB)?\b/i.test(input.primaryNarrative)) {
    return fact("DBS", "cases.primary_narrative", "high")
  }

  const assertionMatch = assertionsCorpus(input.assertions).match(BANK_NAME_PATTERN)
  if (assertionMatch?.[1]) {
    return fact(assertionMatch[1], "case_bank_assertions", "high")
  }

  const findingMatch = findingsCorpus(input.findings).match(BANK_NAME_PATTERN)
  if (findingMatch?.[1]) {
    return fact(findingMatch[1], "case_findings", "medium")
  }

  const labelCorpus = input.evidenceLabels
    .flatMap((label) => [label.original_filename ?? "", label.short_description])
    .join(" ")
  const labelMatch = labelCorpus.match(BANK_NAME_PATTERN)
  if (labelMatch?.[1]) {
    return fact(labelMatch[1], "evidence_labels", "medium")
  }

  const caseMeta =
    input.extractJson?.case_meta && typeof input.extractJson.case_meta === "object"
      ? (input.extractJson.case_meta as Record<string, unknown>)
      : null
  const institution = caseMeta?.institution_name
  if (typeof institution === "string" && institution.trim()) {
    return fact(institution.trim(), "extract_json.case_meta.institution_name", "medium")
  }

  return fact("the bank", "fallback", "low")
}

function resolveProductDescription(input: BuildExecutiveSummaryNarrativeInput): FactValue<string> {
  const corpus = [
    JSON.stringify(input.extractJson?.product ?? ""),
    JSON.stringify(input.extractJson?.account ?? ""),
    JSON.stringify(input.extractJson?.card ?? ""),
    documentSummaries(input),
  ].join(" ")

  for (const entry of PRODUCT_PATTERNS) {
    if (entry.pattern.test(corpus)) {
      return fact(entry.label, "extract_json_or_document_summary", "medium")
    }
  }

  return fact(null, null, "low")
}

function resolveTransactionCount(input: BuildExecutiveSummaryNarrativeInput): FactValue<number> {
  const extractCount = safeNumber(input.extractJson?.transaction_count)
  if (extractCount && extractCount > 0) {
    return fact(extractCount, "extract_json.transaction_count", "high")
  }

  const transactions = input.extractJson?.transactions
  if (Array.isArray(transactions) && transactions.length > 0) {
    return fact(transactions.length, "extract_json.transactions.length", "high")
  }

  for (const finding of input.findings) {
    if (/numerous\s+(?:successful\s+)?(?:paynow|fast payment|transactions?)/i.test(finding.finding_text)) {
      return fact(null, "case_findings.numerous_transactions", "medium")
    }

    const wordMatch = finding.finding_text.match(/(\w+)\s+disputed transactions/i)
    if (wordMatch) {
      const count = parseCountToken(wordMatch[1])
      if (count && count > 0) {
        return fact(count, "case_findings.word_count", "high")
      }
    }

    const numericMatch = finding.finding_text.match(/\b(\d+)\s+(?:disputed\s+)?transactions?\b/i)
    if (numericMatch) {
      return fact(Number(numericMatch[1]), "case_findings.numeric_count", "high")
    }
  }

  const losses = input.extractJson?.losses
  if (Array.isArray(losses) && losses.length > 1) {
    return fact(losses.length, "extract_json.losses.length", "medium")
  }

  return fact(null, null, "low")
}

function parseIsoDatePhrase(value: string): string | null {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString("en-SG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

function resolveTransactionDatePhrase(input: BuildExecutiveSummaryNarrativeInput): FactValue<string> {
  const transactions = input.extractJson?.transactions
  if (Array.isArray(transactions) && transactions.length) {
    const dates = transactions
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
        const date = (entry as Record<string, unknown>).date
        return typeof date === "string" ? date : null
      })
      .filter((value): value is string => Boolean(value))

    const uniqueDates = uniqueStrings(dates)
    if (uniqueDates.length === 1) {
      const phrase = parseIsoDatePhrase(uniqueDates[0])
      if (phrase) return fact(`on ${phrase}`, "extract_json.transactions.date", "high")
    }
    if (uniqueDates.length > 1) {
      const first = parseIsoDatePhrase(uniqueDates[0])
      const last = parseIsoDatePhrase(uniqueDates[uniqueDates.length - 1])
      if (first && last) {
        return fact(`between ${first} and ${last}`, "extract_json.transactions.date_range", "high")
      }
    }
  }

  const disputedEvent = input.chronologyEvents.find(
    (event) => event.event_type === "fraud_transactions",
  )
  if (disputedEvent?.event_datetime) {
    const parsed = new Date(disputedEvent.event_datetime)
    if (!Number.isNaN(parsed.getTime())) {
      const phrase = parsed.toLocaleDateString("en-SG", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
      return fact(`on ${phrase}`, "chronology.fraud_transactions", "high")
    }
  }
  if (disputedEvent?.event_text) {
    const match = disputedEvent.event_text.match(/\bon\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/i)
    if (match?.[1]) {
      return fact(`on ${match[1]}`, "chronology.fraud_transactions", "medium")
    }
  }

  for (const finding of input.findings) {
    if (!/transaction|disputed|paynow|fast payment/i.test(finding.finding_text)) continue
    const match = finding.finding_text.match(/(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/i)
    if (!match) continue
    const phrase = `${match[1]} ${match[2]}${match[3] ? ` ${match[3]}` : ""}`
    return fact(`on ${phrase}`, "case_findings.transaction_date", "medium")
  }

  return fact(null, null, "low")
}

function normalizeMerchantName(raw: string): string | null {
  let merchant = raw.replace(MERCHANT_STOPWORDS, "").replace(/\s+/g, " ").trim()
  merchant = merchant.replace(/\s+(LIMITED|LTD|INC)\.?$/i, "").trim()
  merchant = merchant.replace(/^['"]|['"]$/g, "").trim()
  if (merchant.length < 3) return null
  if (/^DBS\b/i.test(merchant)) return null
  return merchant
}

function resolveMerchants(input: BuildExecutiveSummaryNarrativeInput): FactValue<string[]> {
  const merchants: string[] = []
  const findingsText = findingsCorpus(input.findings)

  const pairedMatch = findingsText.match(
    /\bto\s+([A-Z][A-Za-z0-9\s\-&.'()]+?(?:LIMITED|LTD|INC)?)\s+and\s+([A-Z][A-Z0-9\-]+(?:\s+[A-Z][A-Z0-9\-]+)*)\b/,
  )
  if (pairedMatch) {
    const first = normalizeMerchantName(pairedMatch[1])
    const second = normalizeMerchantName(pairedMatch[2])
    if (first) merchants.push(first)
    if (second) merchants.push(second)
    if (merchants.length) {
      return fact(uniqueStrings(merchants).slice(0, 3), "case_findings.merchant_pair", "high")
    }
  }

  const transaction = input.extractJson?.transaction
  if (transaction && typeof transaction === "object" && !Array.isArray(transaction)) {
    const disputedMerchant = (transaction as Record<string, unknown>).disputed_merchant
    if (typeof disputedMerchant === "string" && disputedMerchant.trim()) {
      merchants.push(disputedMerchant.trim())
    }
  }

  const transactions = input.extractJson?.transactions
  if (Array.isArray(transactions)) {
    for (const entry of transactions) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      const record = entry as Record<string, unknown>
      const merchant =
        typeof record.merchant === "string"
          ? record.merchant
          : typeof record.payee === "string"
            ? record.payee
            : null
      if (merchant?.trim()) merchants.push(merchant.trim())
    }
  }

  const losses = input.extractJson?.losses
  if (Array.isArray(losses)) {
    for (const entry of losses) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      const record = entry as Record<string, unknown>
      const merchant =
        typeof record.merchant === "string"
          ? record.merchant
          : typeof record.payee === "string"
            ? record.payee
            : null
      if (merchant?.trim()) merchants.push(merchant.trim())
    }
  }

  const deduped = uniqueStrings(merchants)
    .map((merchant) => normalizeMerchantName(merchant) ?? merchant)
    .filter((merchant) => merchant.length >= 3)
    .slice(0, 3)

  if (deduped.length) {
    const source = pairedMatch ? "case_findings.merchant_pair" : "extract_json.merchants"
    return fact(deduped, source, "high")
  }

  return fact(null, null, "low")
}

function resolveTokenRegistrationEvent(input: BuildExecutiveSummaryNarrativeInput): FactValue<boolean> {
  const corpus = [
    findingsCorpus(input.findings),
    JSON.stringify(input.extractJson ?? {}),
    documentSummaries(input),
  ].join(" ")

  if (/new digital token|token registered|token binding|mobile wallet binding|device binding/i.test(corpus)) {
    return fact(true, "findings_or_extract_json.token_signal", "high")
  }

  return fact(false, null, "low")
}

function resolveCustomerNotificationEvent(
  input: BuildExecutiveSummaryNarrativeInput,
): FactValue<ExecutiveSummaryCustomerNotificationEvent> {
  for (const finding of input.findings) {
    const text = finding.finding_text
    if (!/fraud hotline|called the bank|contacted the bank|reported.*bank|notified bank/i.test(text)) {
      continue
    }

    const timeAndDateMatch = text.match(
      /at\s+(\d{1,2}:\d{2})\s+on\s+(\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?)/i,
    )
    const dateOnlyMatch = text.match(/on\s+(\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?)/i)
    const dateTimeDisplay = timeAndDateMatch
      ? `${timeAndDateMatch[1]} on ${timeAndDateMatch[2]}`
      : dateOnlyMatch?.[1] ?? null

    return fact(
      {
        channel: /fraud hotline|hotline/i.test(text) ? "fraud_hotline" : "unknown",
        date_time_display: dateTimeDisplay,
      },
      "case_findings.notification",
      "high",
    )
  }

  const chronologyNotification = input.chronologyEvents.find(
    (event) => event.event_type === "hotline_call",
  )
  if (chronologyNotification) {
    const dateTimeDisplay = chronologyNotification.event_datetime
      ? new Date(chronologyNotification.event_datetime).toLocaleString("en-SG", {
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
        })
      : null
    return fact(
      {
        channel: "fraud_hotline",
        date_time_display: dateTimeDisplay || null,
      },
      "chronology.fraud_notification",
      "medium",
    )
  }

  return fact(null, null, "low")
}

function resolveBankDecisionEvent(
  input: BuildExecutiveSummaryNarrativeInput,
): FactValue<ExecutiveSummaryBankDecisionEvent> {
  const corpus = [
    assertionsCorpus(input.assertions),
    documentSummaries(input),
  ].join(" ")

  const dateMatch = corpus.match(/(\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?)/i)
  const dateDisplay = dateMatch?.[1] ?? null

  if (/restitution request is rejected|rejects the restitution|rejected the restitution/i.test(corpus)) {
    return fact({ decision: "rejected_restitution", date_display: dateDisplay }, "case_bank_assertions", "high")
  }

  if (/unsuccessful|cannot be disputed|declined|rejected|not upheld|denied/i.test(corpus)) {
    return fact({ decision: "declined", date_display: dateDisplay }, "case_bank_assertions", "high")
  }

  return fact(null, null, "low")
}

function resolveBankAuthenticationBasis(input: BuildExecutiveSummaryNarrativeInput): FactValue<string[]> {
  const corpus = [
    assertionsCorpus(input.assertions),
    ...input.evidenceLabels.flatMap((label) => {
      if (
        label.evidence_type !== "bank_final_response" &&
        label.evidence_type !== "bank_investigation_report" &&
        label.evidence_type !== "bank_email_or_letter"
      ) {
        return []
      }
      const presentation = input.documentPresentationById.get(label.case_document_id)
      return [presentation?.extractedText ?? "", extractionSpanCorpusFromPresentation(presentation)].filter(Boolean)
    }),
  ].join(" ")

  const basis: string[] = []
  if (/3d\s*secure|\b3ds\b/i.test(corpus)) basis.push("3D Secure")
  if (/\botp\b/i.test(corpus) && /authenticated|authentication/i.test(corpus)) basis.push("OTP")
  if (/contactless/i.test(corpus) && /authenticated|authentication|cannot be disputed/i.test(corpus)) {
    basis.push("contactless")
  }
  if (/\bemv\b|\bchip\b/i.test(corpus) && /authenticated|authentication|cannot be disputed/i.test(corpus)) {
    basis.push("EMV")
  }
  if (/card present/i.test(corpus)) basis.push("card present")
  if (/mobile wallet/i.test(corpus) && /contactless/i.test(corpus)) basis.push("mobile wallet")

  const deduped = uniqueStrings(basis)
  if (deduped.length) {
    return fact(deduped, "case_bank_assertions_or_bank_correspondence", "high")
  }

  return fact(null, null, "low")
}

function issueFromTheme(theme: CasePackTheme): string | null {
  const type = theme.theme_type.toLowerCase()
  const issue = (theme.issue ?? "").toLowerCase()

  if (/authenticat|authoris|token|3ds|compromise/.test(type) || /authenticat|authoris|token/.test(issue)) {
    return ALLOWED_PRINCIPAL_ISSUES[0]
  }
  if (/transaction|monitor|pattern|fraud|velocity|anomal/.test(type) || /pattern|monitor|fraud/.test(issue)) {
    return ALLOWED_PRINCIPAL_ISSUES[1]
  }
  if (/notification|hotline|containment|response|communication/.test(type) || /notification|hotline|timely/.test(issue)) {
    return ALLOWED_PRINCIPAL_ISSUES[2]
  }
  if (/bank|decision|evidential|restitution|investigation/.test(type) || /decision|evidential|restitution/.test(issue)) {
    return ALLOWED_PRINCIPAL_ISSUES[3]
  }

  return null
}

function resolvePrincipalIssues(input: BuildExecutiveSummaryNarrativeInput): FactValue<string[]> {
  const issues: string[] = []
  for (const theme of input.keyThemes) {
    const issue = issueFromTheme(theme)
    if (issue) issues.push(issue)
  }

  const deduped = uniqueStrings(issues).slice(0, 3)
  if (deduped.length) {
    return fact(deduped, "theme_type_category_mapping", "medium")
  }

  return fact(null, null, "low")
}

function factFromCandidate<T>(
  candidate: { value: T; source_label: string | null; confidence: ExecutiveSummaryFactConfidence } | null,
): FactValue<T> {
  if (!candidate) return fact(null, null, "low")
  return fact(candidate.value, candidate.source_label, candidate.confidence)
}

export function buildExecutiveSummaryFacts(
  input: BuildExecutiveSummaryNarrativeInput,
): { facts: ExecutiveSummaryFacts; criticalFactDiagnostics: ExecutiveSummaryCriticalFactDiagnostics } {
  const critical = arbitrateExecutiveSummaryCriticalFacts({
    findings: input.findings,
    evidenceLabels: input.evidenceLabels,
    documentPresentationById: input.documentPresentationById,
    documentChunkTextById: input.documentChunkTextById,
    extractJson: input.extractJson,
    claimAmount: input.claimAmount,
    claimCurrency: input.claimCurrency,
    customerName: input.customerName,
    primaryNarrative: input.primaryNarrative,
  })

  let disputedAmount = factFromCandidate<ExecutiveSummaryDisputedAmount>(critical.disputedAmount)
  if (
    disputedAmount.value &&
    !disputedAmount.value.currency &&
    input.claimCurrency
  ) {
    disputedAmount = fact(
      {
        amount: disputedAmount.value.amount,
        currency: normalizeCurrency(input.claimCurrency) ?? "SGD",
      },
      disputedAmount.source,
      disputedAmount.confidence,
    )
  }

  return {
    facts: {
      customer_name: factFromCandidate(critical.customerName),
      institution_name: resolveInstitutionName(input),
      product_description: resolveProductDescription(input),
      masked_account_or_card: factFromCandidate(critical.accountOrCard),
      transaction_count: resolveTransactionCount(input),
      disputed_amount: disputedAmount,
      transaction_date_phrase: resolveTransactionDatePhrase(input),
      merchants: resolveMerchants(input),
      token_registration_event: resolveTokenRegistrationEvent(input),
      customer_notification_event: resolveCustomerNotificationEvent(input),
      bank_decision_event: resolveBankDecisionEvent(input),
      bank_authentication_basis: resolveBankAuthenticationBasis(input),
      principal_issues: resolvePrincipalIssues(input),
    },
    criticalFactDiagnostics: critical.diagnostics,
  }
}

function formatMerchants(merchants: string[]): string {
  if (merchants.length === 1) return merchants[0]
  if (merchants.length === 2) return `${merchants[0]} and ${merchants[1]}`
  return `${merchants.slice(0, -1).join(", ")}, and ${merchants[merchants.length - 1]}`
}

function formatAuthenticationBasis(basis: string[]): string {
  if (!basis.length) return "standard card authentication methods"
  if (basis.length === 1) return basis[0]
  if (basis.length === 2) return `${basis[0]} and ${basis[1]}`
  return `${basis.slice(0, -1).join(", ")}, and ${basis[basis.length - 1]}`
}

function renderCaseOverviewParagraph(input: {
  facts: ExecutiveSummaryFacts
  honorific: "Ms" | "Mr" | "Mrs" | null
  scamType: FactValue<string>
  lossBreakdown: ExecutiveSummaryLossBreakdownComponent[]
  products: FactValue<string[]>
  bankRejectionBasis: FactValue<string>
}): string {
  const { facts } = input
  const sentences: string[] = []

  let opening = ""
  if (facts.customer_name.value) {
    const honorificPrefix = input.honorific ? `${input.honorific}. ` : ""
    opening = `The Claimant, ${honorificPrefix}${facts.customer_name.value}, seeks full restitution`
  } else {
    opening = "The Claimant seeks full restitution"
  }

  if (facts.disputed_amount.value) {
    opening += ` for a ${formatCurrencyDisplay(
      facts.disputed_amount.value.amount,
      facts.disputed_amount.value.currency,
    )} loss`
  } else {
    opening += " for losses"
  }

  if (input.scamType.value) {
    opening += ` arising from a ${input.scamType.value}`
  }

  const productsPhrase = formatProductsPhrase(input.products.value ?? [])
  if (productsPhrase) {
    opening += ` ${productsPhrase}`
  }

  opening += "."
  sentences.push(opening)

  if (input.lossBreakdown.length >= 2) {
    const breakdownParts = input.lossBreakdown.map(
      (item, index) =>
        `${index === 0 ? "approximately " : ""}${formatCurrencyDisplay(item.amount, item.currency)} from ${item.description}`,
    )
    sentences.push(
      `The available materials indicate that the loss comprised ${breakdownParts[0]} and ${breakdownParts[1]}.`,
    )
  } else if (input.lossBreakdown.length === 1) {
    const item = input.lossBreakdown[0]
    sentences.push(
      `The available materials indicate that the loss comprised approximately ${formatCurrencyDisplay(item.amount, item.currency)} from ${item.description}.`,
    )
  }

  if (input.bankRejectionBasis.value) {
    sentences.push(input.bankRejectionBasis.value.endsWith(".") ? input.bankRejectionBasis.value : `${input.bankRejectionBasis.value}.`)
  }

  const issues = facts.principal_issues.value ?? []
  if (issues.length) {
    const formatted = issues.map((issue) => {
      if (issue === "the bank's response following customer notification was timely and appropriate") {
        const institution = facts.institution_name.value ?? "the bank"
        const possessive =
          institution === "the bank" ? "the bank's" : `${institution}'s`
        return `whether ${issue.replace("the bank's", possessive)}`
      }
      return `whether ${issue}`
    })
    if (formatted.length === 1) {
      sentences.push(`The principal issues for determination are ${formatted[0]}.`)
    } else {
      sentences.push(
        `The principal issues for determination are ${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}.`,
      )
    }
  } else {
    sentences.push("The principal issues for determination are set out below.")
  }

  return sentences.join(" ")
}

export function buildExecutiveSummaryNarrative(
  input: BuildExecutiveSummaryNarrativeInput,
): BuildExecutiveSummaryNarrativeResult {
  const { facts, criticalFactDiagnostics } = buildExecutiveSummaryFacts(input)
  const corpus = buildAuthoritativeCorpus(input)
  const honorific = resolveClaimantHonorific(corpus, facts.customer_name.value)
  const scamType = resolveScamTypePhrase(input, corpus)
  const lossBreakdown = extractLossBreakdown(corpus)
  const products = resolveProducts(input, corpus)
  const bankRejectionBasis = resolveBankRejectionBasis(input, corpus)
  const caseOverviewDiagnostics = buildCaseOverviewDiagnostics({
    claimantName: facts.customer_name,
    honorific,
    totalLoss: facts.disputed_amount,
    lossBreakdown,
    products,
    bankRejectionBasis,
    criticalFactDiagnostics,
  })

  return {
    narrative: renderCaseOverviewParagraph({
      facts,
      honorific,
      scamType,
      lossBreakdown,
      products,
      bankRejectionBasis,
    }),
    facts,
    criticalFactDiagnostics,
    caseOverviewDiagnostics,
  }
}

export type { ExecutiveSummaryFacts }
