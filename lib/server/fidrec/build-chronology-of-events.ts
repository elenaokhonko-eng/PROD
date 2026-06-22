import type { EvidencePresentationContext } from "@/lib/server/fidrec/build-evidence-links"
import type { EvidenceLabel } from "@/lib/types/fidrec-evidence-labels"
import type { EvidenceReviewModel } from "@/lib/types/fidrec-evidence-review"
import type {
  ChronologyBuildDiagnostics,
  ChronologyEventConfidence,
  ChronologyEventSource,
  SubmissionChronologyEvent,
} from "@/lib/types/fidrec-submission-pack"
import type { CaseBankAssertionRow, CaseFindingRow } from "@/lib/types/fidrec"

export type BuildChronologyOfEventsInput = {
  findings: CaseFindingRow[]
  assertions: CaseBankAssertionRow[]
  evidenceLabels: EvidenceLabel[]
  evidenceReviewModel: EvidenceReviewModel
  documentPresentationById: Map<string, EvidencePresentationContext>
}

export type { ChronologyBuildDiagnostics } from "@/lib/types/fidrec-submission-pack"

type ChronologyEventType =
  | "customer_travel"
  | "token_registration"
  | "disputed_transactions"
  | "fraud_notification"
  | "bank_acknowledgement"
  | "bank_rejection"
  | "bank_newsroom_statement"

type ParsedTiming = {
  eventDate: string | null
  eventTime: string | null
  dateDisplay: string
  sortOrder: number
}

type ChronologyCandidate = {
  eventType: ChronologyEventType
  eventText: string
  timing: ParsedTiming
  evidenceRefs: string[]
  source: ChronologyEventSource
  confidence: ChronologyEventConfidence
}

const MONTH_INDEX: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const GENERIC_TITLE_PATTERN =
  /^(bank email or letter(?:\s+\d+)?|device or ip record|screenshot(?:\s+\d+)?|supporting document|other|transaction history|bank correspondence)$/i

const BANK_NAME_PATTERN =
  /\b(DBS|OCBC|UOB|HSBC|Standard Chartered|Citibank|Maybank|CIMB|Bank of China|ANZ)\b/i

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

function normalizeFindingKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

function dedupeFindings(findings: CaseFindingRow[]): CaseFindingRow[] {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = normalizeFindingKey(finding.finding_text)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseMonthToken(token: string): number | null {
  return MONTH_INDEX[token.toLowerCase()] ?? null
}

function buildSortOrder(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return year * 1_000_000_000 + month * 10_000_000 + day * 100_000 + hour * 1_000 + minute
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function formatDateDisplay(year: number | null, month: number, day: number, time: string | null): string {
  const monthLabel = MONTH_SHORT[month - 1] ?? "Unknown"
  const datePart = year ? `${day} ${monthLabel} ${year}` : `${day} ${monthLabel}`
  return time ? `${datePart} ${time}` : datePart
}

function inferCaseYear(input: BuildChronologyOfEventsInput): number {
  for (const label of input.evidenceLabels) {
    if (label.document_date) {
      const parsed = new Date(label.document_date)
      if (!Number.isNaN(parsed.getTime())) return parsed.getUTCFullYear()
    }
  }

  const corpus = [
    ...input.findings.map((finding) => finding.finding_text),
    ...input.evidenceLabels.map((label) => label.original_filename ?? ""),
    ...input.evidenceLabels.map((label) => label.short_description),
  ].join(" ")

  const match = corpus.match(/\b(20\d{2})\b/)
  return match ? Number(match[1]) : new Date().getFullYear()
}

function parseTimingFromParts(input: {
  day: number
  month: number
  year: number | null
  hour?: number
  minute?: number
  fallbackYear: number
}): ParsedTiming {
  const year = input.year ?? input.fallbackYear
  const hour = input.hour ?? 0
  const minute = input.minute ?? 0
  const eventTime =
    input.hour !== undefined && input.minute !== undefined
      ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
      : null

  return {
    eventDate: formatIsoDate(year, input.month, input.day),
    eventTime,
    dateDisplay: formatDateDisplay(year, input.month, input.day, eventTime),
    sortOrder: buildSortOrder(year, input.month, input.day, hour, minute),
  }
}

function parseTimingFromText(text: string, fallbackYear: number): ParsedTiming | null {
  const timeOnDate = text.match(
    /(?:at\s+)?(\d{1,2}):(\d{2})\s+on\s+(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/i,
  )
  if (timeOnDate) {
    const month = parseMonthToken(timeOnDate[4])
    if (!month) return null
    return parseTimingFromParts({
      day: Number(timeOnDate[3]),
      month,
      year: timeOnDate[5] ? Number(timeOnDate[5]) : fallbackYear,
      hour: Number(timeOnDate[1]),
      minute: Number(timeOnDate[2]),
      fallbackYear,
    })
  }

  const datePattern = /\b(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\b/g
  let dateMatch: RegExpExecArray | null
  while ((dateMatch = datePattern.exec(text)) !== null) {
    const month = parseMonthToken(dateMatch[2])
    if (!month) continue

    const day = Number(dateMatch[1])
    if (day < 1 || day > 31) continue

    return parseTimingFromParts({
      day,
      month,
      year: dateMatch[3] ? Number(dateMatch[3]) : fallbackYear,
      fallbackYear,
    })
  }

  const isoDate = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (isoDate) {
    return parseTimingFromParts({
      day: Number(isoDate[3]),
      month: Number(isoDate[2]),
      year: Number(isoDate[1]),
      fallbackYear,
    })
  }

  return null
}

function undatedTiming(): ParsedTiming {
  return {
    eventDate: null,
    eventTime: null,
    dateDisplay: "Undated",
    sortOrder: Number.MAX_SAFE_INTEGER,
  }
}

function detectBankName(input: BuildChronologyOfEventsInput): string {
  const corpus = [
    ...input.assertions.map((assertion) => assertion.assertion_text),
    ...input.assertions.map((assertion) => assertion.bank_conclusion_supported ?? ""),
    ...input.evidenceLabels.map((label) => label.original_filename ?? ""),
  ].join(" ")

  const match = corpus.match(BANK_NAME_PATTERN)
  return match?.[1] ?? "the bank"
}

function buildFindingEvidenceMap(input: BuildChronologyOfEventsInput): Map<string, string[]> {
  const findingToEvidence = new Map<string, string[]>()

  for (const item of input.evidenceReviewModel.evidence_items) {
    for (const findingText of item.related_findings) {
      const list = findingToEvidence.get(findingText) ?? []
      list.push(item.evidence_label)
      findingToEvidence.set(findingText, list)
    }
  }

  for (const label of input.evidenceLabels) {
    for (const findingId of label.linked_finding_ids) {
      const finding = input.findings.find((entry) => entry.id === findingId)
      if (!finding) continue
      const list = findingToEvidence.get(finding.finding_text) ?? []
      list.push(label.label)
      findingToEvidence.set(finding.finding_text, list)
    }
  }

  return findingToEvidence
}

function classifyFinding(finding: CaseFindingRow): ChronologyEventType | null {
  const text = finding.finding_text.toLowerCase()

  if (/travell?ing overseas|was overseas|travelled overseas|flight/i.test(text)) {
    return "customer_travel"
  }
  if (/token was registered|digital token was registered|new digital token/i.test(text)) {
    return "token_registration"
  }
  if (/disputed transactions occurred within|disputed transactions/i.test(text)) {
    return "disputed_transactions"
  }
  if (/called.*fraud hotline|contacted.*hotline|reported.*hotline|fraud hotline at/i.test(text)) {
    return "fraud_notification"
  }
  if (/declined|rejected|unsuccessful|cannot be disputed/i.test(text)) {
    return "bank_rejection"
  }
  if (/customer service|acknowledgement|acknowledgment|response regarding the dispute/i.test(text)) {
    return "bank_acknowledgement"
  }
  if (/newsroom|announcement|security-related/i.test(text)) {
    return "bank_newsroom_statement"
  }

  if (finding.finding_type === "notification") return "fraud_notification"
  if (finding.finding_type === "authentication") return "token_registration"
  if (finding.finding_type === "transaction_pattern") return "disputed_transactions"
  if (finding.finding_type === "chronology" && /travel|overseas|itinerary/i.test(text)) {
    return "customer_travel"
  }

  return null
}

function parseTransactionDetails(text: string): { count: number | null; minutes: number | null } {
  const match = text.match(/(\w+)\s+disputed transactions occurred within (\d+)\s+minutes?/i)
  if (!match) return { count: null, minutes: null }

  const numeric = Number(match[1])
  const count = Number.isNaN(numeric)
    ? ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }[
        match[1].toLowerCase()
      ] ?? null)
    : numeric

  return { count, minutes: Number(match[2]) }
}

function formatCount(count: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
  return words[count] ?? String(count)
}

function formatMinutePeriod(minutes: number): string {
  const article = minutes === 8 || minutes === 11 || minutes === 18 ? "an" : "a"
  return `${article} ${minutes}-minute`
}

function timingWithoutTime(timing: ParsedTiming): ParsedTiming {
  if (!timing.eventDate) return timing

  const [year, month, day] = timing.eventDate.split("-").map(Number)
  return {
    eventDate: timing.eventDate,
    eventTime: null,
    dateDisplay: formatDateDisplay(year, month, day, null),
    sortOrder: buildSortOrder(year, month, day),
  }
}

function pickMergedTiming(group: ChronologyCandidate[]): ParsedTiming {
  const ranked = group
    .map((candidate) => candidate.timing)
    .sort((left, right) => {
      const leftHasTime = left.eventTime ? 1 : 0
      const rightHasTime = right.eventTime ? 1 : 0
      if (leftHasTime !== rightHasTime) return rightHasTime - leftHasTime

      const leftDated = left.eventDate ? 1 : 0
      const rightDated = right.eventDate ? 1 : 0
      if (leftDated !== rightDated) return rightDated - leftDated

      return left.sortOrder - right.sortOrder
    })

  return ranked[0] ?? undatedTiming()
}

function inferTimingFromEvidenceRefs(input: {
  evidenceRefs: string[]
  evidenceLabels: EvidenceLabel[]
  documentPresentationById: Map<string, EvidencePresentationContext>
  fallbackYear: number
  matchesLabel?: (label: EvidenceLabel, corpus: string) => boolean
}): ParsedTiming | null {
  for (const ref of input.evidenceRefs) {
    const label = input.evidenceLabels.find((entry) => entry.label === ref)
    if (!label) continue

    const corpus = buildLabelCorpus(label, input.documentPresentationById.get(label.case_document_id))
    if (input.matchesLabel && !input.matchesLabel(label, corpus)) continue

    const timing = parseTimingFromText(corpus, input.fallbackYear)
    if (timing) return timing
  }

  return null
}

function buildEventText(
  eventType: ChronologyEventType,
  input: {
    bankName: string
    findingText?: string
    timing: ParsedTiming
  },
): string {
  const bankLabel = input.bankName === "the bank" ? "The bank" : input.bankName
  const findingText = input.findingText ?? ""

  switch (eventType) {
    case "customer_travel":
      return input.timing.eventDate
        ? "Customer travelled overseas."
        : "Customer travelled overseas."
    case "token_registration":
      return "A new digital token was registered on the customer's account before the disputed transactions."
    case "disputed_transactions": {
      const details = parseTransactionDetails(findingText)
      if (details.count && details.minutes) {
        return `${formatCount(details.count).replace(/^\w/, (char) => char.toUpperCase())} disputed transactions occurred within ${formatMinutePeriod(details.minutes)} period.`
      }
      return "A sequence of disputed transactions occurred within a short period."
    }
    case "fraud_notification":
      if (input.timing.eventTime) {
        return `Customer called the ${bankLabel} fraud hotline at ${input.timing.eventTime} after discovering the disputed transactions.`
      }
      return `Customer called the ${bankLabel} fraud hotline after discovering the disputed transactions.`
    case "bank_acknowledgement":
      return `${bankLabel} sent a customer service response regarding the dispute.`
    case "bank_rejection":
      return `${bankLabel} declined the dispute, relying on authentication grounds.`
    case "bank_newsroom_statement":
      return `${bankLabel} published a security-related newsroom statement.`
    default:
      return findingText
  }
}

function evidenceRefsForEventType(input: {
  findingText?: string
  eventType: ChronologyEventType
  findingEvidence: Map<string, string[]>
  evidenceLabels: EvidenceLabel[]
  documentPresentationById: Map<string, EvidencePresentationContext>
}): string[] {
  const refs = input.findingText ? [...(input.findingEvidence.get(input.findingText) ?? [])] : []

  for (const label of input.evidenceLabels) {
    const presentation = input.documentPresentationById.get(label.case_document_id)
    if (detectDocumentEventType(label, presentation) === input.eventType) {
      refs.push(label.label)
    }
  }

  return sortEvidenceRefs(refs)
}

function resolveDocumentTiming(input: {
  label: EvidenceLabel
  presentation: EvidencePresentationContext | undefined
  eventType: ChronologyEventType
  fallbackYear: number
}): ParsedTiming {
  const corpus = buildLabelCorpus(input.label, input.presentation)
  const filenameTiming = input.label.original_filename
    ? parseTimingFromText(input.label.original_filename, input.fallbackYear)
    : null

  const parsedTiming =
    filenameTiming ??
    parseTimingFromText(corpus, input.fallbackYear) ??
    (input.label.document_date
      ? parseTimingFromText(input.label.document_date, input.fallbackYear)
      : null) ??
    undatedTiming()

  if (input.eventType === "disputed_transactions" || input.eventType === "bank_acknowledgement") {
    return timingWithoutTime(parsedTiming)
  }

  return parsedTiming
}

function buildLabelCorpus(
  label: EvidenceLabel,
  presentation: EvidencePresentationContext | undefined,
): string {
  return [
    label.title,
    label.short_description,
    label.original_filename,
    label.evidence_type.replaceAll("_", " "),
    presentation?.verifiedProcessedType,
    presentation?.predictedProcessedType,
    presentation?.extractedText,
  ]
    .filter(Boolean)
    .join(" ")
}

function isGenericDocumentTitle(title: string): boolean {
  return GENERIC_TITLE_PATTERN.test(title.trim())
}

function detectDocumentEventType(
  label: EvidenceLabel,
  presentation: EvidencePresentationContext | undefined,
): ChronologyEventType | null {
  const corpus = buildLabelCorpus(label, presentation)
  const title = label.title.trim()

  if (isGenericDocumentTitle(title) && !/customer service|hotline|itinerary|newsroom|final response|pending transaction|token|dispute/i.test(corpus)) {
    return null
  }

  if (label.evidence_type === "flight_itinerary" || /\bflight itinerary\b|\btravel itinerary\b|\btravell?ing overseas\b/i.test(corpus)) {
    return "customer_travel"
  }
  if (
    label.evidence_type === "token_registration_record" ||
    /\btoken registration\b|\bdigital token\b|\btoken binding\b|\bSMS_LOG_TOKEN\b/i.test(corpus)
  ) {
    return "token_registration"
  }
  if (
    label.evidence_type === "hotline_call_record" ||
    /\bfraud hotline\b|\bhotline call\b|\bcall log\b/i.test(corpus)
  ) {
    return "fraud_notification"
  }
  if (
    /\bpending transaction\b|\brapidly drained\b|\bdisputed transaction\b|\btransaction history\b/i.test(corpus) ||
    label.evidence_type === "transaction_history"
  ) {
    return "disputed_transactions"
  }
  if (
    label.evidence_type === "bank_email_or_letter" &&
    /\bcustomer service\b|\bemail from dbs\b|\bOM-\d+/i.test(corpus)
  ) {
    return "bank_acknowledgement"
  }
  if (
    label.evidence_type === "bank_final_response" ||
    /\bfinal response\b|\bdispute request\(s\) on your card transaction is\/are unsuccessful\b|\bcannot be disputed\b/i.test(
      corpus,
    )
  ) {
    return "bank_rejection"
  }
  if (
    label.evidence_type === "news_article" ||
    /\bnewsroom\b|\bannouncement\b|\bsecurity vulnerability\b|\bphishing digital bank security\b/i.test(corpus)
  ) {
    return "bank_newsroom_statement"
  }

  return null
}

function confidenceFromFinding(finding: CaseFindingRow): ChronologyEventConfidence {
  if (finding.confidence === "high") return "high"
  if (finding.confidence === "low") return "low"
  return "medium"
}

function confidenceFromLabel(label: EvidenceLabel): ChronologyEventConfidence {
  if (label.source_confidence === "high") return "high"
  if (label.source_confidence === "low") return "low"
  return "medium"
}

function buildFindingCandidates(input: BuildChronologyOfEventsInput): ChronologyCandidate[] {
  const fallbackYear = inferCaseYear(input)
  const bankName = detectBankName(input)
  const findingEvidence = buildFindingEvidenceMap(input)
  const candidates: ChronologyCandidate[] = []

  for (const finding of dedupeFindings(input.findings)) {
    const eventType = classifyFinding(finding)
    if (!eventType) continue

    const evidenceRefs = evidenceRefsForEventType({
      findingText: finding.finding_text,
      eventType,
      findingEvidence,
      evidenceLabels: input.evidenceLabels,
      documentPresentationById: input.documentPresentationById,
    })
    if (!evidenceRefs.length) continue

    const timing = parseTimingFromText(finding.finding_text, fallbackYear) ?? undatedTiming()
    const resolvedTiming =
      eventType === "disputed_transactions" ? timingWithoutTime(timing) : timing

    candidates.push({
      eventType,
      eventText: buildEventText(eventType, { bankName, findingText: finding.finding_text, timing: resolvedTiming }),
      timing: resolvedTiming,
      evidenceRefs,
      source: "finding",
      confidence: confidenceFromFinding(finding),
    })
  }

  return candidates
}

function buildDocumentCandidates(input: BuildChronologyOfEventsInput): {
  candidates: ChronologyCandidate[]
  droppedDocumentOnlyRows: number
} {
  const fallbackYear = inferCaseYear(input)
  const bankName = detectBankName(input)
  const candidates: ChronologyCandidate[] = []
  let droppedDocumentOnlyRows = 0

  for (const label of input.evidenceLabels) {
    const presentation = input.documentPresentationById.get(label.case_document_id)
    const corpus = buildLabelCorpus(label, presentation)
    const eventType = detectDocumentEventType(label, presentation)

    if (!eventType) {
      if (
        parseTimingFromText(corpus, fallbackYear) &&
        (isGenericDocumentTitle(label.title) || /document identified as/i.test(label.short_description))
      ) {
        droppedDocumentOnlyRows += 1
      }
      continue
    }

    const timing = resolveDocumentTiming({
      label,
      presentation,
      eventType,
      fallbackYear,
    })

    candidates.push({
      eventType,
      eventText: buildEventText(eventType, { bankName, timing }),
      timing,
      evidenceRefs: [label.label],
      source: presentation?.extractedText ? "document_metadata" : "evidence_label",
      confidence: confidenceFromLabel(label),
    })
  }

  return { candidates, droppedDocumentOnlyRows }
}

function buildAssertionCandidates(input: BuildChronologyOfEventsInput): ChronologyCandidate[] {
  const bankName = detectBankName(input)
  const documentIdToLabel = new Map(
    input.evidenceLabels.map((label) => [label.case_document_id, label.label]),
  )
  const candidates: ChronologyCandidate[] = []

  const declined = input.assertions.some((assertion) =>
    /unsuccessful|cannot be disputed|declined|rejected|not upheld|denied/i.test(
      assertion.bank_conclusion_supported ?? "",
    ),
  )

  if (declined) {
    const evidenceRefs = sortEvidenceRefs([
      ...input.assertions
        .map((assertion) =>
          assertion.source_document_id ? documentIdToLabel.get(assertion.source_document_id) : null,
        )
        .filter((label): label is string => Boolean(label)),
      ...input.evidenceLabels
        .filter((label) => {
          const presentation = input.documentPresentationById.get(label.case_document_id)
          return detectDocumentEventType(label, presentation) === "bank_rejection"
        })
        .map((label) => label.label),
    ])

    if (evidenceRefs.length) {
      candidates.push({
        eventType: "bank_rejection",
        eventText: buildEventText("bank_rejection", { bankName, timing: undatedTiming() }),
        timing: undatedTiming(),
        evidenceRefs,
        source: "document_metadata",
        confidence: "high",
      })
    }
  }

  return candidates
}

function sourcePriority(source: ChronologyEventSource): number {
  if (source === "finding") return 3
  if (source === "document_metadata") return 2
  return 1
}

function confidencePriority(confidence: ChronologyEventConfidence): number {
  if (confidence === "high") return 3
  if (confidence === "medium") return 2
  return 1
}

function mergeCandidates(
  candidates: ChronologyCandidate[],
  bankName: string,
  input: BuildChronologyOfEventsInput,
): ChronologyCandidate[] {
  const grouped = new Map<string, ChronologyCandidate[]>()

  for (const candidate of candidates) {
    const list = grouped.get(candidate.eventType) ?? []
    list.push(candidate)
    grouped.set(candidate.eventType, list)
  }

  const merged: ChronologyCandidate[] = []

  for (const [, group] of grouped) {
    const evidenceRefs = sortEvidenceRefs(group.flatMap((candidate) => candidate.evidenceRefs))
    if (!evidenceRefs.length) continue

    const preferred = group
      .slice()
      .sort((left, right) => {
        const datedLeft = left.timing.eventDate ? 1 : 0
        const datedRight = right.timing.eventDate ? 1 : 0
        if (datedLeft !== datedRight) return datedRight - datedLeft
        if (left.timing.sortOrder !== right.timing.sortOrder) {
          return left.timing.sortOrder - right.timing.sortOrder
        }
        const sourceDelta = sourcePriority(right.source) - sourcePriority(left.source)
        if (sourceDelta !== 0) return sourceDelta
        return confidencePriority(right.confidence) - confidencePriority(left.confidence)
      })[0]

    const mergedTiming = pickMergedTiming(group)
    let resolvedTiming = mergedTiming

    if (preferred.eventType === "fraud_notification") {
      const hotlineTiming = dedupeFindings(input.findings)
        .filter((finding) => classifyFinding(finding) === "fraud_notification")
        .map((finding) => parseTimingFromText(finding.finding_text, inferCaseYear(input)))
        .find((timing): timing is ParsedTiming => Boolean(timing?.eventTime))

      if (hotlineTiming?.eventTime) {
        resolvedTiming = {
          ...hotlineTiming,
          eventDate: hotlineTiming.eventDate ?? resolvedTiming.eventDate,
        }
        if (resolvedTiming.eventDate) {
          const [year, month, day] = resolvedTiming.eventDate.split("-").map(Number)
          resolvedTiming.dateDisplay = formatDateDisplay(year, month, day, resolvedTiming.eventTime)
        }
      }
    }

    if (
      !resolvedTiming.eventDate &&
      (preferred.eventType === "token_registration" ||
        preferred.eventType === "customer_travel" ||
        preferred.eventType === "bank_newsroom_statement")
    ) {
      const fallbackYear = inferCaseYear(input)
      const labelMatchers: Partial<Record<ChronologyEventType, (label: EvidenceLabel, corpus: string) => boolean>> =
        {
          customer_travel: (label, corpus) =>
            label.evidence_type === "flight_itinerary" ||
            /\bflight itinerary\b|\btravel itinerary\b|\btravell?ing overseas\b/i.test(corpus),
          token_registration: (_label, corpus) =>
            /\btoken registration\b|\bdigital token\b|\btoken binding\b/i.test(corpus),
          bank_newsroom_statement: (_label, corpus) =>
            /\bnewsroom\b|\bannouncement\b|\bsecurity vulnerability\b/i.test(corpus),
        }

      resolvedTiming =
        inferTimingFromEvidenceRefs({
          evidenceRefs,
          evidenceLabels: input.evidenceLabels,
          documentPresentationById: input.documentPresentationById,
          fallbackYear,
          matchesLabel: labelMatchers[preferred.eventType],
        }) ?? resolvedTiming
    }

    merged.push({
      ...preferred,
      evidenceRefs,
      timing: resolvedTiming,
      eventText:
        preferred.eventType === "fraud_notification"
          ? buildEventText("fraud_notification", { bankName, timing: resolvedTiming })
          : group.find((candidate) => candidate.source === "finding")?.eventText ?? preferred.eventText,
      confidence:
        group.reduce<ChronologyEventConfidence>((best, candidate) => {
          return confidencePriority(candidate.confidence) > confidencePriority(best)
            ? candidate.confidence
            : best
        }, "low") ?? preferred.confidence,
    })
  }

  const anchorTiming = pickMergedTiming(
    merged.filter(
      (candidate) =>
        candidate.eventType === "fraud_notification" || candidate.eventType === "disputed_transactions",
    ),
  )

  for (const candidate of merged) {
    if (candidate.eventType === "token_registration" && !candidate.timing.eventDate && anchorTiming.eventDate) {
      candidate.timing = timingWithoutTime(anchorTiming)
    }

    if (candidate.eventType === "customer_travel" && !candidate.timing.eventDate) {
      const inferred = inferTimingFromEvidenceRefs({
        evidenceRefs: candidate.evidenceRefs,
        evidenceLabels: input.evidenceLabels,
        documentPresentationById: input.documentPresentationById,
        fallbackYear: inferCaseYear(input),
        matchesLabel: (label, corpus) =>
          label.evidence_type === "flight_itinerary" ||
          /\bflight itinerary\b|\btravel itinerary\b/i.test(corpus),
      })
      if (inferred) {
        candidate.timing = timingWithoutTime(inferred)
      }
    }
  }

  return merged
}

export function buildChronologyOfEvents(input: BuildChronologyOfEventsInput): {
  events: SubmissionChronologyEvent[]
  diagnostics: ChronologyBuildDiagnostics
} {
  const documentResult = buildDocumentCandidates(input)
  const rawCandidates = [
    ...buildFindingCandidates(input),
    ...documentResult.candidates,
    ...buildAssertionCandidates(input),
  ]
  const bankName = detectBankName(input)
  const mergedCandidates = mergeCandidates(rawCandidates, bankName, input)

  const events = mergedCandidates
    .sort((left, right) => left.timing.sortOrder - right.timing.sortOrder)
    .map((candidate, index) => ({
      event_date: candidate.timing.eventDate,
      event_time: candidate.timing.eventTime,
      date_display: candidate.timing.dateDisplay,
      event_text: candidate.eventText,
      evidence_refs: candidate.evidenceRefs,
      source: candidate.source,
      confidence: candidate.confidence,
      sort_order: index,
    }))

  return {
    events,
    diagnostics: {
      raw_chronology_candidates: rawCandidates.length,
      merged_chronology_events: events.length,
      dropped_document_only_rows: documentResult.droppedDocumentOnlyRows,
      duplicate_events_merged: Math.max(0, rawCandidates.length - mergedCandidates.length),
      undated_events: events.filter((event) => !event.event_date).length,
      confirmed_events: 0,
      inferred_events: 0,
      requires_confirmation_events: 0,
    },
  }
}
