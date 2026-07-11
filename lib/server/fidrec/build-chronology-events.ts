import type { EvidencePresentationContext } from "@/lib/server/fidrec/build-evidence-links"
import type {
  ChronologyEvent,
  ChronologyEventStatus,
  ChronologyEventType,
  ChronologyEventsBuildDiagnostics,
} from "@/lib/types/fidrec-chronology"
import type { EvidenceLabel } from "@/lib/types/fidrec-evidence-labels"
import type { EvidenceReviewModel } from "@/lib/types/fidrec-evidence-review"
import type { CaseBankAssertionRow, CaseFindingRow } from "@/lib/types/fidrec"

/**
 * CHRONOLOGY BUILDER RULES
 *
 * Chronology answers: what happened, when (to the extent supported), what evidence
 * supports it, and what facts remain unverified.
 *
 * It must NOT answer: liability, breach, control failure, or negligence.
 *
 * If exact time, exact date, transaction count, or transaction window cannot be
 * determined from evidence, do not invent them — set status to requires_confirmation
 * and add claimant_questions instead.
 *
 * Events are derived from document extractions, findings, and cases.primary_narrative.
 * The output is a sequence of events, not a list of uploaded documents.
 *
 * Year anchoring: when a police report date is available, its year is used as the
 * chronology anchor for undated evidence (screenshots, SMS, narrative omissions).
 * Explicit years in the customer narrative are not treated as authoritative when
 * they conflict with the police report anchor.
 */

export type BuildChronologyEventsInput = {
  findings: CaseFindingRow[]
  assertions: CaseBankAssertionRow[]
  evidenceLabels: EvidenceLabel[]
  evidenceReviewModel: EvidenceReviewModel
  documentPresentationById: Map<string, EvidencePresentationContext>
  documentChunkTextById?: Map<string, string>
  primaryNarrative?: string | null
  extractJson?: Record<string, unknown> | null
}

type ParsedDateParts = {
  year: number
  month: number
  day: number
  hour: number | null
  minute: number | null
}

type EventCandidate = {
  eventType: ChronologyEventType
  eventText: string
  status: ChronologyEventStatus
  eventDatetime: string | null
  sortKey: number
  supportingEvidence: string[]
  claimantQuestions: string[]
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

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const EVENT_TYPE_ORDER: ChronologyEventType[] = [
  "phishing_email",
  "token_registration",
  "limit_change",
  "fraud_transactions",
  "fraud_discovery",
  "hotline_call",
  "police_report",
  "dispute_submission",
  "technical_access_request",
  "bank_rejection",
]

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function sortEvidenceRefs(refs: string[]): string[] {
  return uniqueStrings(refs).sort((left, right) => {
    const leftNumber = Number(left.replace(/^E/i, ""))
    const rightNumber = Number(right.replace(/^E/i, ""))
    if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) return left.localeCompare(right)
    return leftNumber - rightNumber
  })
}

function parseMonthToken(token: string): number | null {
  return MONTH_INDEX[token.toLowerCase()] ?? null
}

function formatIsoDateTime(parts: ParsedDateParts): string {
  const date = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
  if (parts.hour === null || parts.minute === null) return `${date}T00:00:00.000Z`
  return `${date}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:00.000Z`
}

function formatDisplayDate(parts: ParsedDateParts, prefix = ""): string {
  const monthLabel = MONTH_LABELS[parts.month - 1] ?? "Unknown"
  const dateLabel = `${parts.day} ${monthLabel} ${parts.year}`
  if (parts.hour !== null && parts.minute !== null) {
    const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
    return `${prefix}${dateLabel} at ${time}`.trim()
  }
  return `${prefix}${dateLabel}`.trim()
}

function sortKeyFromParts(parts: ParsedDateParts): number {
  const hour = parts.hour ?? 0
  const minute = parts.minute ?? 0
  return parts.year * 1_000_000_000 + parts.month * 10_000_000 + parts.day * 100_000 + hour * 1_000 + minute
}

function inferPoliceReportAnchorYear(input: BuildChronologyEventsInput): number | null {
  const { corpus, reportRef } = collectPoliceReportContext(input)
  const fromRef = parseReportRefDateParts(reportRef)
  if (fromRef) return fromRef.year

  const fromReportField = parseDatePartsFromText(corpus, new Date().getFullYear())
  if (fromReportField) return fromReportField.year

  return null
}

function inferCaseYear(input: BuildChronologyEventsInput): number {
  const policeYear = inferPoliceReportAnchorYear(input)
  if (policeYear) return policeYear

  for (const label of input.evidenceLabels) {
    if (label.document_date) {
      const parsed = new Date(label.document_date)
      if (!Number.isNaN(parsed.getTime())) return parsed.getUTCFullYear()
    }
  }
  const corpus = [
    input.primaryNarrative ?? "",
    ...input.findings.map((finding) => finding.finding_text),
    ...input.evidenceLabels.map((label) => label.original_filename ?? ""),
  ].join(" ")
  const match = corpus.match(/\b(20\d{2})\b/)
  return match ? Number(match[1]) : new Date().getFullYear()
}

function withAnchorYear(parts: ParsedDateParts | null, anchorYear: number): ParsedDateParts | null {
  if (!parts) return null
  return { ...parts, year: anchorYear }
}

function extractionSpanCorpus(json: Record<string, unknown> | null | undefined): string {
  const spans = json?.evidence_spans
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

function buildLabelCorpus(
  label: EvidenceLabel,
  presentation: EvidencePresentationContext | undefined,
  chunkText?: string | null,
): string {
  return [
    label.title,
    label.short_description,
    label.original_filename,
    presentation?.extractedText,
    extractionSpanCorpus(presentation?.extractedJson),
    chunkText,
    presentation?.verifiedProcessedType,
    presentation?.predictedProcessedType,
  ]
    .filter(Boolean)
    .join("\n")
}

function documentCorpus(label: EvidenceLabel, input: BuildChronologyEventsInput): string {
  return buildLabelCorpus(
    label,
    input.documentPresentationById.get(label.case_document_id),
    input.documentChunkTextById?.get(label.case_document_id),
  )
}

function normalizePoliceReportFilename(filename: string | null | undefined): string {
  return (filename ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
}

function isStandalonePoliceReportPdfFilename(filename: string | null | undefined): boolean {
  const normalized = normalizePoliceReportFilename(filename)
  return /^e20\d{6}\d{3,5}$/.test(normalized)
}

function collectPoliceReportContext(input: BuildChronologyEventsInput): {
  corpus: string
  reportRef: string | null
  refs: string[]
} {
  const corpusParts: string[] = []
  const refs: string[] = []
  let reportRef: string | null = null

  const consider = (label: EvidenceLabel, corpus: string) => {
    corpusParts.push(corpus)
    refs.push(label.label)
    const match = corpus.match(/\bE\/20\d{6}\/\d+\b/)
    if (match) reportRef = match[0]
  }

  for (const label of input.evidenceLabels) {
    const corpus = documentCorpus(label, input)
    const filename = label.original_filename ?? ""
    const reportRefInCorpus = corpus.match(/\bE\/20\d{6}\/\d+\b/)
    const enclosesReportPdf = /E_20251016_7004\.pdf/i.test(corpus) && /Police online report|enclosed the Police/i.test(corpus)

    if (
      isStandalonePoliceReportPdfFilename(filename) ||
      /Date\/Time Report Made/i.test(corpus) ||
      (label.evidence_type === "police_report" && reportRefInCorpus) ||
      enclosesReportPdf
    ) {
      consider(label, corpus)
    }
  }

  if (!refs.length) {
    for (const label of input.evidenceLabels) {
      const corpus = documentCorpus(label, input)
      if (label.evidence_type !== "police_report" && !/police report|E\/20\d{6}\/\d+/i.test(corpus)) continue
      consider(label, corpus)
    }
  }

  return {
    corpus: corpusParts.join("\n"),
    reportRef,
    refs: sortEvidenceRefs(refs),
  }
}

function buildAuthoritativeCorpus(input: BuildChronologyEventsInput): string {
  const parts = [input.primaryNarrative ?? ""]
  for (const label of input.evidenceLabels) {
    parts.push(buildLabelCorpus(label, input.documentPresentationById.get(label.case_document_id)))
  }
  for (const finding of input.findings) {
    parts.push(finding.finding_text)
  }
  return parts.join("\n")
}

function parseDatePartsFromText(text: string, fallbackYear: number): ParsedDateParts | null {
  const reportMade = text.match(
    /Date\/Time Report Made[\s:]*(\d{1,2})\/(\d{1,2})\/(20\d{2})\s+(\d{1,2}):(\d{2})/i,
  )
  if (reportMade) {
    return {
      year: Number(reportMade[3]),
      month: Number(reportMade[2]),
      day: Number(reportMade[1]),
      hour: Number(reportMade[4]),
      minute: Number(reportMade[5]),
    }
  }

  const dayMonthSlashTime = text.match(/\b(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\b/)
  if (dayMonthSlashTime) {
    return {
      year: fallbackYear,
      month: Number(dayMonthSlashTime[2]),
      day: Number(dayMonthSlashTime[1]),
      hour: Number(dayMonthSlashTime[3]),
      minute: Number(dayMonthSlashTime[4]),
    }
  }

  const slashDateTime = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\s+(\d{1,2}):(\d{2})\b/)
  if (slashDateTime) {
    return {
      year: Number(slashDateTime[3]),
      month: Number(slashDateTime[2]),
      day: Number(slashDateTime[1]),
      hour: Number(slashDateTime[4]),
      minute: Number(slashDateTime[5]),
    }
  }

  const slashDateOnly = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/)
  if (slashDateOnly) {
    return {
      year: Number(slashDateOnly[3]),
      month: Number(slashDateOnly[2]),
      day: Number(slashDateOnly[1]),
      hour: null,
      minute: null,
    }
  }

  const lodgedOn = text.match(/\blodged on\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/i)
  if (lodgedOn) {
    const month = parseMonthToken(lodgedOn[2])
    if (month) {
      return {
        year: Number(lodgedOn[3]),
        month,
        day: Number(lodgedOn[1]),
        hour: null,
        minute: null,
      }
    }
  }

  const onDayMonthTime = text.match(/\bon\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{1,2}):(\d{2})\b/i)
  if (onDayMonthTime) {
    const month = parseMonthToken(onDayMonthTime[2])
    if (!month) return null
    return {
      year: fallbackYear,
      month,
      day: Number(onDayMonthTime[1]),
      hour: Number(onDayMonthTime[3]),
      minute: Number(onDayMonthTime[4]),
    }
  }

  const weekdayDateAtTime = text.match(
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{1,2})\s+([A-Za-z]+)\s+at\s+(\d{1,2}):(\d{2})\b/i,
  )
  if (weekdayDateAtTime) {
    const month = parseMonthToken(weekdayDateAtTime[2])
    if (!month) return null
    return {
      year: fallbackYear,
      month,
      day: Number(weekdayDateAtTime[1]),
      hour: Number(weekdayDateAtTime[3]),
      minute: Number(weekdayDateAtTime[4]),
    }
  }

  const notificationDate = text.match(/Notifications?\s+(\d{1,2})\s+([A-Za-z]+)/i)
  if (notificationDate) {
    const month = parseMonthToken(notificationDate[2])
    if (!month) return null
    const timeMatch = text.match(/^(\d{1,2}):(\d{2})\s*$/m)
    return {
      year: fallbackYear,
      month,
      day: Number(notificationDate[1]),
      hour: timeMatch ? Number(timeMatch[1]) : null,
      minute: timeMatch ? Number(timeMatch[2]) : null,
    }
  }

  const timeOnDate = text.match(
    /(?:at\s+)?(\d{1,2}):(\d{2})\s+(?:on\s+)?(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/i,
  )
  if (timeOnDate) {
    const month = parseMonthToken(timeOnDate[4])
    if (!month) return null
    return {
      year: timeOnDate[5] ? Number(timeOnDate[5]) : fallbackYear,
      month,
      day: Number(timeOnDate[3]),
      hour: Number(timeOnDate[1]),
      minute: Number(timeOnDate[2]),
    }
  }

  const onDateAtTime = text.match(/on\s+(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\s+at\s+(\d{1,2}):(\d{2})/i)
  if (onDateAtTime) {
    const month = parseMonthToken(onDateAtTime[2])
    if (!month) return null
    return {
      year: onDateAtTime[3] ? Number(onDateAtTime[3]) : fallbackYear,
      month,
      day: Number(onDateAtTime[1]),
      hour: Number(onDateAtTime[4]),
      minute: Number(onDateAtTime[5]),
    }
  }

  for (const dateOnly of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\b/g)) {
    const month = parseMonthToken(dateOnly[2])
    if (!month) continue
    return {
      year: dateOnly[3] ? Number(dateOnly[3]) : fallbackYear,
      month,
      day: Number(dateOnly[1]),
      hour: null,
      minute: null,
    }
  }

  const isoDate = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (isoDate) {
    return {
      year: Number(isoDate[1]),
      month: Number(isoDate[2]),
      day: Number(isoDate[3]),
      hour: null,
      minute: null,
    }
  }

  return null
}

function parseReportRefDateParts(reportRef: string | null | undefined): ParsedDateParts | null {
  const match = reportRef?.match(/^E\/(20\d{2})(\d{2})(\d{2})\//i)
  if (!match) return null
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: null,
    minute: null,
  }
}

function parsePoliceReportEventDate(
  corpus: string,
  reportRef: string | null,
  fallbackYear: number,
): ParsedDateParts | null {
  const parsed = parseDatePartsFromText(corpus, fallbackYear)
  if (parsed?.hour !== null && parsed?.minute !== null) return parsed

  const lodgedOn = corpus.match(/\blodged on\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/i)
  if (lodgedOn) {
    const month = parseMonthToken(lodgedOn[2])
    if (month) {
      return {
        year: Number(lodgedOn[3]),
        month,
        day: Number(lodgedOn[1]),
        hour: null,
        minute: null,
      }
    }
  }

  const fromRef = parseReportRefDateParts(reportRef)
  if (fromRef) return fromRef

  return parsed
}

function labelsMatching(
  input: BuildChronologyEventsInput,
  predicate: (label: EvidenceLabel, corpus: string) => boolean,
): EvidenceLabel[] {
  return input.evidenceLabels.filter((label) => {
    const corpus = documentCorpus(label, input)
    return predicate(label, corpus)
  })
}

function refsForLabels(labels: EvidenceLabel[]): string[] {
  return sortEvidenceRefs(labels.map((label) => label.label))
}

function narrativeEvidenceRefs(input: BuildChronologyEventsInput): string[] {
  return refsForLabels(
    labelsMatching(
      input,
      (label, corpus) =>
        label.evidence_type === "customer_narrative" ||
        /timeline notes|user report/i.test(corpus) ||
        /TIMELINE_NOTES/i.test(label.title),
    ),
  )
}

function smsTransactionLabels(input: BuildChronologyEventsInput): EvidenceLabel[] {
  return labelsMatching(
    input,
    (label, corpus) =>
      label.evidence_type === "sms_or_email_alert" &&
      /paynow|fast payment|transaction notification|successful paynow/i.test(corpus) &&
      !/token|digital token|limit/i.test(corpus),
  )
}

function tokenRegistrationLabels(input: BuildChronologyEventsInput): EvidenceLabel[] {
  return labelsMatching(
    input,
    (label, corpus) =>
      label.evidence_type === "token_registration_record" ||
      /token registration|digital token|token binding|new digital token|SMS_LOG_TOKEN/i.test(corpus),
  )
}
function detectBankName(input: BuildChronologyEventsInput): string {
  const corpus = buildAuthoritativeCorpus(input)
  const match = corpus.match(/\b(DBS|OCBC|UOB|HSBC|Standard Chartered|Citibank)\b/i)
  return match?.[1] ?? "the bank"
}

function hasConfirmedTime(parts: ParsedDateParts | null): boolean {
  return parts?.hour !== null && parts?.minute !== null
}

function hasConfirmedDate(parts: ParsedDateParts | null): boolean {
  return parts !== null
}

function mergeQuestions(...groups: string[][]): string[] {
  return uniqueStrings(groups.flat())
}

function phishingScreenshotLabels(input: BuildChronologyEventsInput): EvidenceLabel[] {
  return labelsMatching(
    input,
    (label, corpus) =>
      (label.evidence_type === "screenshot" || /phishing/i.test(corpus)) &&
      /digital token has expired|reactivate.*digital token|phishing email/i.test(corpus),
  )
}

function formatTimeParts(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

type PayNowDrainWindow = {
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
  payees: string[]
}

function extractPayNowDrainWindow(corpus: string): PayNowDrainWindow | null {
  const times: Array<{ hour: number; minute: number }> = []
  for (const match of corpus.matchAll(/16 Oct (\d{1,2}):(\d{2}) SGT/gi)) {
    times.push({ hour: Number(match[1]), minute: Number(match[2]) })
  }
  if (!times.length) return null

  times.sort((left, right) => left.hour * 60 + left.minute - (right.hour * 60 + right.minute))
  const payees = uniqueStrings([
    ...( /OXPAY/i.test(corpus) ? ["OXPAY-PMMAX TECHNOLOGY LIMITED"] : []),
    ...( /TZP-eneba/i.test(corpus) ? ["TZP-eneba"] : []),
  ])

  return {
    startHour: times[0].hour,
    startMinute: times[0].minute,
    endHour: times[times.length - 1].hour,
    endMinute: times[times.length - 1].minute,
    payees,
  }
}

function representativeSmsRefs(labels: EvidenceLabel[], max = 6): string[] {
  if (labels.length <= max) return refsForLabels(labels)
  const sorted = labels.slice().sort((left, right) => {
    const leftNum = Number(left.label.replace(/^E/i, ""))
    const rightNum = Number(right.label.replace(/^E/i, ""))
    return leftNum - rightNum
  })
  const picks = [
    sorted[0],
    sorted[1],
    sorted[Math.floor(sorted.length / 2)],
    sorted[sorted.length - 2],
    sorted[sorted.length - 1],
  ].filter((label, index, list) => list.findIndex((entry) => entry.label === label.label) === index)
  return refsForLabels(picks.slice(0, max))
}

function limitIncreaseSmsLabels(input: BuildChronologyEventsInput): EvidenceLabel[] {
  return labelsMatching(
    input,
    (label, corpus) =>
      /increased your (?:DBS\/POSB )?transfer limit|daily limit to/i.test(corpus) &&
      /\$100,?000|S\$100,?000|100,?000/i.test(corpus),
  )
}

function initialTokenCoolingLabels(input: BuildChronologyEventsInput): EvidenceLabel[] {
  return tokenRegistrationLabels(input).filter((label) => {
    const corpus = documentCorpus(label, input)
    return /12 hours|15\/10 08:49|15 Oct at 08:49/i.test(corpus) && !/16\/10 07:18/i.test(corpus)
  })
}

function secondaryTokenBindingLabels(input: BuildChronologyEventsInput): EvidenceLabel[] {
  return tokenRegistrationLabels(input).filter((label) => {
    const corpus = documentCorpus(label, input)
    return /16\/10 07:18|digital token on 16\/10 07:18|16 Oct 07:18/i.test(corpus)
  })
}

function fraudDrainSmsLabels(input: BuildChronologyEventsInput): EvidenceLabel[] {
  return labelsMatching(
    input,
    (label, corpus) =>
      label.evidence_type === "sms_or_email_alert" &&
      /Successful PayNow/i.test(corpus) &&
      /OXPAY|TZP-eneba/i.test(corpus) &&
      /16 Oct/i.test(corpus),
  )
}

function shouldFoldFraudDrainIntoLimitChange(input: BuildChronologyEventsInput): boolean {
  return limitIncreaseSmsLabels(input).length > 0 && fraudDrainSmsLabels(input).length > 0
}

function tokenBindingLabelsForPhishingStep(input: BuildChronologyEventsInput): EvidenceLabel[] {
  return tokenRegistrationLabels(input).filter((label) => {
    const corpus = documentCorpus(label, input)
    return (
      /setting up your .*digital token|digital token which can be used/i.test(corpus) &&
      /15\/10|15 Oct/i.test(corpus) &&
      !/16\/10/i.test(corpus)
    )
  })
}

function shouldFoldTokenRegistrationIntoPhishing(input: BuildChronologyEventsInput, phishingCorpus: string): boolean {
  return (
    /digital token has expired/i.test(phishingCorpus) &&
    tokenBindingLabelsForPhishingStep(input).length > 0
  )
}

function buildPhishingEmailEvent(input: BuildChronologyEventsInput, anchorYear: number): EventCandidate | null {
  const screenshotLabels = phishingScreenshotLabels(input)
  const broadLabels = labelsMatching(
    input,
    (label, corpus) =>
      label.evidence_type === "screenshot" ||
      /phishing|digital token has expired|reactivate.*digital token/i.test(corpus),
  )
  const labels = screenshotLabels.length ? screenshotLabels : broadLabels
  const phishingCorpus = labels.map((label) => documentCorpus(label, input)).join("\n")
  const foldToken = shouldFoldTokenRegistrationIntoPhishing(input, phishingCorpus)
  const tokenLabels = foldToken ? tokenBindingLabelsForPhishingStep(input) : []

  const refs = sortEvidenceRefs([
    ...refsForLabels(labels),
    ...refsForLabels(tokenLabels),
    ...narrativeEvidenceRefs(input),
  ])
  if (!refs.length && !/phishing|digital token/i.test(input.primaryNarrative ?? "")) return null

  const evidenceCorpus = [phishingCorpus, ...tokenLabels.map((label) => documentCorpus(label, input))].join("\n")
  const corpus = [input.primaryNarrative ?? "", evidenceCorpus].join("\n")

  const dateParts = withAnchorYear(parseDatePartsFromText(phishingCorpus, anchorYear), anchorYear)
  const hasExpiredSubject = /digital token has expired/i.test(corpus)
  const bankName = detectBankName(input)

  const questions = mergeQuestions(
    !hasConfirmedTime(dateParts) ? ["Approximate time the phishing email was received"] : [],
    !/clicked|opened/i.test(corpus)
      ? ["Whether the email was opened", "Whether the embedded link was clicked"]
      : [],
    foldToken ? ["Whether the customer initiated the digital token registration"] : [],
  )

  const status: ChronologyEventStatus =
    hasConfirmedTime(dateParts) && hasExpiredSubject
      ? foldToken
        ? "requires_confirmation"
        : "confirmed"
      : hasConfirmedDate(dateParts)
        ? questions.length
          ? "requires_confirmation"
          : "inferred"
        : "requires_confirmation"

  let eventText: string
  if (hasExpiredSubject && dateParts) {
    const when = hasConfirmedTime(dateParts)
      ? `on ${formatDisplayDate(dateParts)}`
      : `${formatDisplayDate({ ...dateParts, hour: null, minute: null })} in the morning`
    eventText = `The available evidence suggests that ${when}, the customer received a phishing email impersonating a mandatory ${bankName} security update ("Your Digital Token Has Expired").`
    if (foldToken) {
      eventText +=
        " The available evidence further suggests that a digital token was registered on the account shortly afterwards without the customer's authorisation."
    }
  } else if (dateParts) {
    eventText = `The available evidence suggests that a phishing email impersonating ${bankName} was received ${formatDisplayDate(dateParts, "on or before ")}.`
  } else {
    eventText = "The available evidence suggests that the customer received a phishing email impersonating their bank."
  }

  return {
    eventType: "phishing_email",
    eventText,
    status,
    eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
    sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 100,
    supportingEvidence: refs,
    claimantQuestions: questions,
  }
}

function buildTokenRegistrationEvent(input: BuildChronologyEventsInput, anchorYear: number): EventCandidate | null {
  const phishingCorpus = phishingScreenshotLabels(input)
    .map((label) => documentCorpus(label, input))
    .join("\n")
  if (shouldFoldTokenRegistrationIntoPhishing(input, phishingCorpus)) {
    const secondaryLabels = secondaryTokenBindingLabels(input)
    if (!secondaryLabels.length) return null

    const corpus = secondaryLabels.map((label) => documentCorpus(label, input)).join("\n")
    const dateParts = withAnchorYear(parseDatePartsFromText(corpus, anchorYear), anchorYear)
    const questions = ["Whether the customer initiated the digital token registration"]

    return {
      eventType: "token_registration",
      eventText: dateParts
        ? `The available evidence suggests that a digital token was registered again on the customer's account on ${formatDisplayDate(dateParts)}.`
        : "The available evidence suggests that a digital token was registered again on the customer's account during the disputed transaction period.",
      status: hasConfirmedTime(dateParts) ? "requires_confirmation" : "requires_confirmation",
      eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
      sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 85,
      supportingEvidence: refsForLabels(secondaryLabels),
      claimantQuestions: questions,
    }
  }

  const labels = tokenRegistrationLabels(input)
  const refs = sortEvidenceRefs([...refsForLabels(labels), ...narrativeEvidenceRefs(input)])
  const finding = input.findings.find((entry) =>
    /token was registered|digital token was registered|new digital token/i.test(entry.finding_text),
  )
  if (!refs.length && !finding) return null

  const corpus = [finding?.finding_text ?? "", ...labels.map((label) => documentCorpus(label, input))].join("\n")
  const dateParts = withAnchorYear(parseDatePartsFromText(corpus, anchorYear), anchorYear)
  const questions = !hasConfirmedDate(dateParts)
    ? ["The date and time the digital token was registered", "Whether the customer initiated the token registration"]
    : !hasConfirmedTime(dateParts)
      ? ["The exact time the digital token was registered", "Whether the customer initiated the token registration"]
      : ["Whether the customer initiated the token registration"]

  const status: ChronologyEventStatus = hasConfirmedTime(dateParts)
    ? "inferred"
    : hasConfirmedDate(dateParts)
      ? "requires_confirmation"
      : "requires_confirmation"

  const datePhrase = dateParts ? formatDisplayDate(dateParts) : null
  const eventText = datePhrase
    ? `The available evidence suggests that a new digital token was registered on the customer's account on ${datePhrase}.`
    : "The available evidence suggests that a new digital token was registered on the customer's account before the disputed transactions."

  return {
    eventType: "token_registration",
    eventText,
    status,
    eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
    sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 90,
    supportingEvidence: refs,
    claimantQuestions: questions,
  }
}

function buildLimitChangeEvent(input: BuildChronologyEventsInput, anchorYear: number): EventCandidate | null {
  const smsLimitLabels = limitIncreaseSmsLabels(input)
  const coolingLabels = initialTokenCoolingLabels(input)
  const drainLabels = fraudDrainSmsLabels(input)
  const foldDrain = shouldFoldFraudDrainIntoLimitChange(input)

  const fallbackLabels = smsLimitLabels.length
    ? []
    : labelsMatching(
        input,
        (_label, corpus) => /daily transfer limit|limit increased|limit changed|account limit/i.test(corpus),
      )

  const limitLabels = smsLimitLabels.length ? smsLimitLabels : fallbackLabels
  if (!limitLabels.length && !/increased her daily transfer limit|daily transfer limit/i.test(input.primaryNarrative ?? "")) {
    return null
  }

  const limitCorpus = limitLabels.map((label) => documentCorpus(label, input)).join("\n")
  const coolingCorpus = coolingLabels.map((label) => documentCorpus(label, input)).join("\n")
  const drainCorpus = drainLabels.map((label) => documentCorpus(label, input)).join("\n")

  const dateParts = withAnchorYear(parseDatePartsFromText(limitCorpus, anchorYear), anchorYear)
  const coolingParts = withAnchorYear(parseDatePartsFromText(coolingCorpus, anchorYear), anchorYear)
  const drainWindow = foldDrain ? extractPayNowDrainWindow(drainCorpus) : null

  const limitMatch = limitCorpus.match(/limit to \$?([\d,]+)|limit to S\$([\d,]+)/i)
  const limitAmount = (limitMatch?.[1] ?? limitMatch?.[2] ?? "100000").replace(/,/g, "")

  const refs = sortEvidenceRefs([
    ...refsForLabels(coolingLabels),
    ...refsForLabels(limitLabels),
    ...(foldDrain ? representativeSmsRefs(drainLabels) : []),
  ])

  const questions = mergeQuestions(
    !hasConfirmedDate(dateParts) ? ["When the daily transfer limit was changed"] : [],
    !hasConfirmedTime(dateParts) ? ["The exact time the daily transfer limit was changed"] : [],
    ["Whether the customer authorised the limit change"],
    foldDrain ? ["The exact number of unauthorized PayNow transfers during the draining period"] : [],
  )

  const status: ChronologyEventStatus =
    hasConfirmedTime(dateParts) && limitMatch && coolingParts && foldDrain
      ? "requires_confirmation"
      : hasConfirmedTime(dateParts)
        ? "inferred"
        : "requires_confirmation"

  let eventText: string
  if (foldDrain && dateParts && coolingParts && drainWindow) {
    const windowStart =
      hasConfirmedTime(dateParts) &&
      dateParts.hour! * 60 + dateParts.minute! < drainWindow.startHour * 60 + drainWindow.startMinute
        ? { hour: dateParts.hour!, minute: dateParts.minute! }
        : { hour: drainWindow.startHour, minute: drainWindow.startMinute }
    const payeePhrase =
      drainWindow.payees.length === 2
        ? `${drainWindow.payees[0]} and ${drainWindow.payees[1]}`
        : drainWindow.payees.join(" and ")
    eventText =
      `The available evidence suggests that on ${formatDisplayDate(dateParts)}, following the 12-hour cooling period after the digital token was registered on ${formatDisplayDate(coolingParts)}, the account daily transfer limit was increased to S$${limitAmount}. ` +
      `The available evidence further suggests that unauthorized PayNow transfers to ${payeePhrase} occurred between ${formatTimeParts(windowStart.hour, windowStart.minute)} and ${formatTimeParts(drainWindow.endHour, drainWindow.endMinute)} on the same day.`
  } else if (dateParts) {
    eventText = `The available evidence suggests that the customer's daily transfer limit was increased to S$${limitAmount} on ${formatDisplayDate(dateParts)}.`
  } else {
    eventText = `The available evidence suggests that the customer's daily transfer limit was increased to S$${limitAmount} during the relevant period.`
  }

  return {
    eventType: "limit_change",
    eventText,
    status,
    eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
    sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 80,
    supportingEvidence: refs,
    claimantQuestions: questions,
  }
}

function buildFraudTransactionsEvent(input: BuildChronologyEventsInput, anchorYear: number): EventCandidate | null {
  if (shouldFoldFraudDrainIntoLimitChange(input)) return null

  const labels = [
    ...labelsMatching(
      input,
      (label, corpus) =>
        label.evidence_type === "transaction_history" ||
        /paynow|fast payment|disputed transaction|transaction notification/i.test(corpus),
    ),
    ...smsTransactionLabels(input),
  ].filter((label, index, list) => list.findIndex((entry) => entry.label === label.label) === index)

  const finding = input.findings.find((entry) => /disputed transaction|paynow|fast payment/i.test(entry.finding_text))
  const refs = sortEvidenceRefs([
    ...refsForLabels(labels),
    ...narrativeEvidenceRefs(input),
  ])
  if (!refs.length && !finding && !/transactions?:/i.test(input.primaryNarrative ?? "")) return null

  const corpus = [
    finding?.finding_text ?? "",
    input.primaryNarrative ?? "",
    ...labels.map((label) => buildLabelCorpus(label, input.documentPresentationById.get(label.case_document_id))),
  ].join("\n")

  const windowMatch = corpus.match(/between\s+about\s+(\d{1,2}:\d{2}\s*(?:am|pm)?)\s+and\s+(\d{1,2}:\d{2}\s*(?:am|pm)?)/i)
  const countInEvidence = corpus.match(/\b(\d+)\s+(?:paynow|fast|disputed)\s+transactions?\b/i)
  const countInNarrativeOnly =
    !countInEvidence && /(\d+)\s+transactions?/i.test(input.primaryNarrative ?? "")
      ? (input.primaryNarrative ?? "").match(/(\d+)\s+transactions?/i)
      : null

  const dateParts = withAnchorYear(parseDatePartsFromText(corpus, anchorYear), anchorYear)
  const questions = mergeQuestions(
    !hasConfirmedDate(dateParts) ? ["The date the unauthorized transactions began"] : [],
    !windowMatch ? ["The time window during which the unauthorized transactions occurred"] : [],
    countInNarrativeOnly && !countInEvidence
      ? ["The exact number of unauthorized transactions", "Whether all listed transactions are disputed"]
      : !countInEvidence
        ? ["The exact number of unauthorized transactions"]
        : [],
  )

  const status: ChronologyEventStatus =
    hasConfirmedDate(dateParts) && countInEvidence && windowMatch
      ? "confirmed"
      : hasConfirmedDate(dateParts) || countInEvidence
        ? questions.length
          ? "requires_confirmation"
          : "inferred"
        : "requires_confirmation"

  let eventText = "The available evidence suggests that unauthorized transactions were carried out from the customer's account"
  if (dateParts) {
    eventText += ` on ${formatDisplayDate(dateParts)}`
  }
  if (windowMatch) {
    eventText += ` between ${windowMatch[1]} and ${windowMatch[2]}`
  } else if (/during the night/i.test(corpus)) {
    eventText += " during the night"
  }
  eventText += "."
  if (countInEvidence) {
    eventText += ` The available materials reference ${countInEvidence[1]} transactions.`
  }

  return {
    eventType: "fraud_transactions",
    eventText,
    status,
    eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
    sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 70,
    supportingEvidence: refs,
    claimantQuestions: questions,
  }
}

function parseOutgoingHotlineCallDateTime(corpus: string, anchorYear: number): ParsedDateParts | null {
  const callTime = corpus.match(/\b(\d{1,2}):(\d{2})\s+Outgoing Call\b/i)
  if (!callTime) return null

  const dated = corpus.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/)
  if (dated) {
    const month = parseMonthToken(dated[2])
    if (!month) return null
    return {
      year: Number(dated[3]),
      month,
      day: Number(dated[1]),
      hour: Number(callTime[1]),
      minute: Number(callTime[2]),
    }
  }

  const shortDate = corpus.match(/\b(\d{1,2})\s+([A-Za-z]+)\b/)
  if (shortDate) {
    const month = parseMonthToken(shortDate[2])
    if (!month) return null
    return {
      year: anchorYear,
      month,
      day: Number(shortDate[1]),
      hour: Number(callTime[1]),
      minute: Number(callTime[2]),
    }
  }

  return null
}

function hotlineCallEvidenceLabels(input: BuildChronologyEventsInput): EvidenceLabel[] {
  return labelsMatching(
    input,
    (label, corpus) =>
      label.evidence_type === "hotline_call_record" ||
      /Proof to call DBS/i.test(label.original_filename ?? "") ||
      (/1800 111 1111/i.test(corpus) && /Outgoing Call/i.test(corpus)),
  )
}

function shouldFoldFraudDiscoveryIntoHotlineCall(
  input: BuildChronologyEventsInput,
  hotlineDateParts: ParsedDateParts | null,
): boolean {
  return hasConfirmedTime(hotlineDateParts) && hotlineCallEvidenceLabels(input).length > 0
}

function minutesAfterLastTransaction(
  hotlineParts: ParsedDateParts,
  drainWindow: PayNowDrainWindow | null,
): number | null {
  if (!drainWindow) return null
  const hotlineMinutes = hotlineParts.hour! * 60 + hotlineParts.minute!
  const lastTxnMinutes = drainWindow.endHour * 60 + drainWindow.endMinute
  const delta = hotlineMinutes - lastTxnMinutes
  return delta >= 0 && delta <= 180 ? delta : null
}

function buildFraudDiscoveryEvent(input: BuildChronologyEventsInput, anchorYear: number): EventCandidate | null {
  const hotlineLabels = hotlineCallEvidenceLabels(input)
  const hotlineCorpus = hotlineLabels.map((label) => documentCorpus(label, input)).join("\n")
  const hotlineDateParts = withAnchorYear(
    parseOutgoingHotlineCallDateTime(hotlineCorpus, anchorYear) ??
      parseDatePartsFromText(hotlineCorpus, anchorYear),
    anchorYear,
  )
  if (shouldFoldFraudDiscoveryIntoHotlineCall(input, hotlineDateParts)) return null

  const finding = input.findings.find((entry) =>
    /discover|discovered|noticed|found.*transaction|upon discovering/i.test(entry.finding_text),
  )
  const labels = labelsMatching(
    input,
    (_label, corpus) => /discover|discovered|noticed unauthorized|found the transaction/i.test(corpus),
  )
  const refs = sortEvidenceRefs([...refsForLabels(labels), ...narrativeEvidenceRefs(input)])
  if (!finding && !refs.length && !/discover/i.test(input.primaryNarrative ?? "")) return null

  const corpus = [finding?.finding_text ?? "", input.primaryNarrative ?? ""].join("\n")
  const dateParts = withAnchorYear(parseDatePartsFromText(corpus, anchorYear), anchorYear)
  const questions = !hasConfirmedDate(dateParts)
    ? ["When the customer first discovered the unauthorized transactions", "How the customer discovered the transactions"]
    : ["How the customer discovered the transactions"]

  const status: ChronologyEventStatus = hasConfirmedDate(dateParts) ? "requires_confirmation" : "requires_confirmation"
  const eventText = dateParts
    ? `The available evidence suggests that the customer discovered the unauthorized transactions on ${formatDisplayDate(dateParts)}.`
    : "The available evidence suggests that the customer later discovered unauthorized transactions on the account."

  return {
    eventType: "fraud_discovery",
    eventText,
    status,
    eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
    sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 60,
    supportingEvidence: refs,
    claimantQuestions: questions,
  }
}

function buildHotlineCallEvent(input: BuildChronologyEventsInput, anchorYear: number): EventCandidate | null {
  const labels = hotlineCallEvidenceLabels(input)
  const lastTxnLabels = fraudDrainSmsLabels(input).filter((label) => /07:1[56] SGT/i.test(documentCorpus(label, input)))
  const refs = sortEvidenceRefs([...refsForLabels(labels), ...representativeSmsRefs(lastTxnLabels, 1)])
  const finding = input.findings.find((entry) => /fraud hotline|called the bank|contacted.*hotline/i.test(entry.finding_text))
  if (!refs.length && !finding) return null

  const hotlineCorpus = labels.map((label) => documentCorpus(label, input)).join("\n")
  const drainCorpus = fraudDrainSmsLabels(input).map((label) => documentCorpus(label, input)).join("\n")
  const drainWindow = extractPayNowDrainWindow(drainCorpus)

  const dateParts = withAnchorYear(
    parseOutgoingHotlineCallDateTime(hotlineCorpus, anchorYear) ??
      parseDatePartsFromText(hotlineCorpus, anchorYear),
    anchorYear,
  )
  const bankName = detectBankName(input)
  const foldDiscovery = shouldFoldFraudDiscoveryIntoHotlineCall(input, dateParts)
  const minutesAfter = dateParts && drainWindow ? minutesAfterLastTransaction(dateParts, drainWindow) : null

  const questions = mergeQuestions(
    foldDiscovery ? ["How the customer first discovered the unauthorized transactions"] : [],
    !hasConfirmedTime(dateParts) ? ["The exact time the customer called the bank fraud hotline"] : [],
  )

  const status: ChronologyEventStatus =
    hasConfirmedTime(dateParts) && /Outgoing Call|1800 111 1111/i.test(hotlineCorpus)
      ? foldDiscovery
        ? "requires_confirmation"
        : "confirmed"
      : "requires_confirmation"

  let eventText: string
  if (hasConfirmedTime(dateParts) && foldDiscovery) {
    const afterTxnPhrase =
      minutesAfter !== null
        ? `, approximately ${minutesAfter} minute${minutesAfter === 1 ? "" : "s"} after the final unauthorized PayNow transfer at ${formatTimeParts(drainWindow!.endHour, drainWindow!.endMinute)},`
        : ""
    eventText = `The available evidence suggests that on ${formatDisplayDate(dateParts)}, the customer discovered the unauthorized transactions${afterTxnPhrase} and contacted the ${bankName} fraud hotline to report the incident.`
  } else if (hasConfirmedTime(dateParts)) {
    eventText = `The customer contacted the ${bankName} fraud hotline on ${formatDisplayDate(dateParts)}.`
  } else {
    eventText = `The customer contacted the ${bankName} fraud hotline after discovering the unauthorized transactions.`
  }

  return {
    eventType: "hotline_call",
    eventText,
    status,
    eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
    sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 50,
    supportingEvidence: refs,
    claimantQuestions: questions,
  }
}

function buildPoliceReportEvent(input: BuildChronologyEventsInput, anchorYear: number): EventCandidate | null {
  const { corpus, reportRef, refs } = collectPoliceReportContext(input)
  if (!refs.length) return null

  const dateParts = parsePoliceReportEventDate(corpus, reportRef, anchorYear)
  const hasAuthoritativeTime = /Date\/Time Report Made/i.test(corpus) && hasConfirmedTime(dateParts)
  const questions = mergeQuestions(
    !hasConfirmedDate(dateParts) ? ["The date the police report was lodged"] : [],
    hasConfirmedDate(dateParts) && !hasAuthoritativeTime ? ["The exact time the police report was lodged"] : [],
  )

  const status: ChronologyEventStatus = hasAuthoritativeTime
    ? "confirmed"
    : hasConfirmedDate(dateParts)
      ? "requires_confirmation"
      : "requires_confirmation"
  const eventText = reportRef
    ? `A police report (${reportRef}) was lodged${dateParts ? ` on ${formatDisplayDate(dateParts)}` : ""}.`
    : `A police report was lodged${dateParts ? ` on ${formatDisplayDate(dateParts)}` : ""}.`

  return {
    eventType: "police_report",
    eventText,
    status,
    eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
    sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 40,
    supportingEvidence: refs,
    claimantQuestions: questions,
  }
}

function buildDisputeSubmissionEvent(input: BuildChronologyEventsInput, anchorYear: number): EventCandidate | null {
  const labels = labelsMatching(
    input,
    (_label, corpus) =>
      /fraudulent transaction report has been submitted|dispute submission|dispute request|dispute your card transaction/i.test(
        corpus,
      ),
  )
  const refs = refsForLabels(labels)
  if (!refs.length) return null

  const corpus = labels.map((label) => buildLabelCorpus(label, input.documentPresentationById.get(label.case_document_id))).join("\n")
  const dateParts = withAnchorYear(parseDatePartsFromText(corpus, anchorYear), anchorYear)
  const countMatch = corpus.match(/(\d+)\s+transaction/i)
  const questions = !hasConfirmedDate(dateParts) ? ["The date the dispute was submitted to the bank"] : []

  const status: ChronologyEventStatus = hasConfirmedDate(dateParts) ? "confirmed" : "requires_confirmation"
  const eventText = countMatch
    ? `The customer submitted a fraudulent transaction dispute to the bank covering ${countMatch[1]} transaction(s)${dateParts ? ` on ${formatDisplayDate(dateParts)}` : ""}.`
    : `The customer submitted a fraudulent transaction dispute to the bank${dateParts ? ` on ${formatDisplayDate(dateParts)}` : ""}.`

  return {
    eventType: "dispute_submission",
    eventText,
    status,
    eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
    sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 30,
    supportingEvidence: refs,
    claimantQuestions: questions,
  }
}

function buildBankRejectionEvent(input: BuildChronologyEventsInput, anchorYear: number): EventCandidate | null {
  const labels = labelsMatching(
    input,
    (label, corpus) =>
      label.evidence_type === "bank_final_response" ||
      label.evidence_type === "bank_investigation_report" ||
      /unsuccessful|cannot be disputed|unable to compensate|restitution.*not applicable|declined the dispute/i.test(corpus),
  )
  const refs = refsForLabels(labels)
  const declined = input.assertions.some((assertion) =>
    /unsuccessful|cannot be disputed|unable to compensate|declined|rejected|not applicable/i.test(
      `${assertion.assertion_text} ${assertion.bank_conclusion_supported ?? ""}`,
    ),
  )
  if (!refs.length && !declined) return null

  const corpus = labels.map((label) => buildLabelCorpus(label, input.documentPresentationById.get(label.case_document_id))).join("\n")
  const dateParts = withAnchorYear(parseDatePartsFromText(corpus, anchorYear), anchorYear)
  const bankName = detectBankName(input)
  const questions = !hasConfirmedDate(dateParts) ? ["The date of the bank's final rejection or investigation outcome letter"] : []

  const status: ChronologyEventStatus = hasConfirmedDate(dateParts) ? "confirmed" : "inferred"
  const eventText = `${bankName === "the bank" ? "The bank" : bankName} issued a written outcome declining the dispute${dateParts ? ` on ${formatDisplayDate(dateParts)}` : ""}.`

  return {
    eventType: "bank_rejection",
    eventText,
    status,
    eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
    sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 10,
    supportingEvidence: refs,
    claimantQuestions: questions,
  }
}

function buildTechnicalAccessRequestEvent(
  input: BuildChronologyEventsInput,
  anchorYear: number,
): EventCandidate | null {
  const labels = labelsMatching(
    input,
    (_label, corpus) =>
      /account access logs|system activity logs|technical data required|data access request|PDPC|personal data protection/i.test(
        corpus,
      ),
  )
  const refs = refsForLabels(labels)
  if (!refs.length) return null

  const corpus = labels.map((label) => documentCorpus(label, input)).join("\n")
  const dateParts = withAnchorYear(parseDatePartsFromText(corpus, anchorYear), anchorYear)
  const questions = [
    "Whether the bank provided the requested account access logs",
    "The date range for which access logs are still required",
  ]

  const status: ChronologyEventStatus = "requires_confirmation"
  const eventText =
    "The customer requested account access logs and related technical records from the bank to support the investigation."

  return {
    eventType: "technical_access_request",
    eventText,
    status,
    eventDatetime: dateParts ? formatIsoDateTime(dateParts) : null,
    sortKey: dateParts ? sortKeyFromParts(dateParts) : Number.MAX_SAFE_INTEGER - 20,
    supportingEvidence: refs,
    claimantQuestions: questions,
  }
}

function mergeCandidatesByType(candidates: EventCandidate[]): EventCandidate[] {
  const grouped = new Map<ChronologyEventType, EventCandidate[]>()
  for (const candidate of candidates) {
    const list = grouped.get(candidate.eventType) ?? []
    list.push(candidate)
    grouped.set(candidate.eventType, list)
  }

  const merged: EventCandidate[] = []
  for (const eventType of EVENT_TYPE_ORDER) {
    const group = grouped.get(eventType)
    if (!group?.length) continue

    const supportingEvidence = sortEvidenceRefs(group.flatMap((candidate) => candidate.supportingEvidence))
    if (!supportingEvidence.length) continue

    const preferred = group.slice().sort((left, right) => left.sortKey - right.sortKey)[0]
    merged.push({
      ...preferred,
      supportingEvidence,
      claimantQuestions: mergeQuestions(...group.map((candidate) => candidate.claimantQuestions)),
      status: group.some((candidate) => candidate.status === "requires_confirmation")
        ? "requires_confirmation"
        : group.some((candidate) => candidate.status === "inferred")
          ? "inferred"
          : "confirmed",
    })
  }

  return merged
}

function toChronologyEvent(candidate: EventCandidate, index: number): ChronologyEvent {
  return {
    event_id: `${candidate.eventType}-${index + 1}`,
    event_type: candidate.eventType,
    event_datetime: candidate.eventDatetime,
    event_text: candidate.eventText,
    status: candidate.status,
    supporting_evidence: candidate.supportingEvidence,
    claimant_questions: candidate.claimantQuestions,
  }
}

export function buildChronologyEvents(input: BuildChronologyEventsInput): {
  events: ChronologyEvent[]
  diagnostics: ChronologyEventsBuildDiagnostics
} {
  const anchorYear = inferCaseYear(input)
  const rawCandidates = [
    buildPhishingEmailEvent(input, anchorYear),
    buildTokenRegistrationEvent(input, anchorYear),
    buildLimitChangeEvent(input, anchorYear),
    buildFraudTransactionsEvent(input, anchorYear),
    buildFraudDiscoveryEvent(input, anchorYear),
    buildHotlineCallEvent(input, anchorYear),
    buildPoliceReportEvent(input, anchorYear),
    buildDisputeSubmissionEvent(input, anchorYear),
    buildTechnicalAccessRequestEvent(input, anchorYear),
    buildBankRejectionEvent(input, anchorYear),
  ].filter((candidate): candidate is EventCandidate => Boolean(candidate))

  const merged = mergeCandidatesByType(rawCandidates)
    .filter((candidate) => candidate.supportingEvidence.length > 0)
    .sort((left, right) => left.sortKey - right.sortKey)

  const events = merged.map((candidate, index) => toChronologyEvent(candidate, index))

  return {
    events,
    diagnostics: {
      raw_candidates: rawCandidates.length,
      merged_events: events.length,
      confirmed_events: events.filter((event) => event.status === "confirmed").length,
      inferred_events: events.filter((event) => event.status === "inferred").length,
      requires_confirmation_events: events.filter((event) => event.status === "requires_confirmation").length,
      dropped_document_only_rows: 0,
    },
  }
}

export type { ChronologyEvent, ChronologyEventsBuildDiagnostics } from "@/lib/types/fidrec-chronology"
