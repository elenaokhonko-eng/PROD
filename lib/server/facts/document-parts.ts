import type { FactCandidate, Transaction } from "@/lib/facts"

// A long document's facts are read in parts (requirements 9.2, 27 Nov 2026), so a long list of payments can't overflow
// one answer and no text is cut off.

/**
 * An answer holds about 120 payments (91 took 6,022 of its 8,192 tokens, 28 Nov 2026), so a part is held to half that.
 */
export const PART_PAYMENT_LINES = 60

/**
 * Whole lines, each part no longer than `size` characters (a longer single line is split) and holding no more than
 * `maxRows` payment lines.
 */
export function splitIntoParts(text: string, size: number, maxRows = Number.POSITIVE_INFINITY): string[] {
  const parts: string[] = []
  let current: string | null = null
  let rows = 0
  for (const line of text.split("\n")) {
    for (let i = 0; i === 0 || i < line.length; i += size) {
      const piece = line.slice(i, i + size)
      const row = isPaymentRow(piece) ? 1 : 0
      if (current !== null && current.length + 1 + piece.length <= size && rows + row <= maxRows) {
        current += `\n${piece}`
        rows += row
      } else {
        if (current !== null) parts.push(current)
        current = piece
        rows = row
      }
    }
  }
  if (current !== null) parts.push(current)
  return parts
}

type Ref = { quotes?: string[]; confidence?: number }

/**
 * The parts' candidates as one document's. Payments are put end to end and never merged: the parts do not overlap, so
 * two alike are two payments. Any other fact repeated with the same value is kept once.
 */
export function mergeDocumentParts(parts: ReadonlyArray<readonly FactCandidate[]>): FactCandidate[] {
  const out: FactCandidate[] = []
  const seen = new Set<string>()
  let payments: FactCandidate | null = null
  for (const candidate of parts.flat()) {
    if (candidate.factKey === "transactions") {
      if (!payments) {
        payments = { ...candidate, sourceRef: { ...candidate.sourceRef } } as FactCandidate
        out.push(payments)
        continue
      }
      const into = payments.sourceRef as Ref
      const from = candidate.sourceRef as Ref
      if (from.quotes) into.quotes = [...(into.quotes ?? []), ...from.quotes]
      if (typeof from.confidence === "number") into.confidence = Math.min(into.confidence ?? 1, from.confidence)
      payments.value = [...(payments.value as unknown[]), ...(candidate.value as unknown[])] as typeof payments.value
      continue
    }
    const key = `${candidate.factKey}:${JSON.stringify(candidate.value)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

// A line holding both a date and a money amount: what a statement's payment line looks like.
const DATE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/i
const AMOUNT = /\d\.\d{2}(?!\d)/
const isPaymentRow = (line: string) => DATE.test(line) && AMOUNT.test(line)
export const paymentRows = (text: string) => text.split("\n").filter(isPaymentRow).length

/**
 * What stands above the payments: the bank's name and the column titles. It starts the later parts, so it holds no
 * payment line (a payment would be listed twice). The table starts at the first two payment lines in a row, so a single
 * dated line near the top does not cut the column titles off.
 */
export function headingLines(text: string): string {
  const lines = text.split("\n").filter((line) => line.trim())
  let start = lines.findIndex((line, i) => isPaymentRow(line) && i + 1 < lines.length && isPaymentRow(lines[i + 1]))
  if (start < 0) start = lines.findIndex(isPaymentRow)
  const above = (start < 0 ? lines.slice(0, 5) : lines.slice(0, start)).filter((line) => !isPaymentRow(line))
  const kept = above.length > 15 ? [...above.slice(0, 7), ...above.slice(-8)] : above
  return kept.map((line) => line.slice(0, 150)).join("\n")
}

/**
 * What the later parts say they come from. It is taken from the file's own heading, not from part one's answer, so no
 * part waits for another. It only tells the reading what it is looking at; the kind that filters facts is still the
 * reading's own (documentTypeOf).
 */
export function documentKind(heading: string): string {
  if (/police (?:force|report)/i.test(heading)) return "a police report"
  if (/credit card|card statement/i.test(heading)) return "a card statement"
  if (/statement|withdrawal|balance/i.test(heading)) return "a bank statement"
  return "a document"
}

export async function inBatches<T, R>(items: T[], size: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map((item, j) => fn(item, i + j)))))
  }
  return results
}

/**
 * Reads a document in parts, at the same time. Every part says which part it is; each later part also says what kind of
 * document it comes from and repeats its heading lines (requirements 11.9). `parts` are the document's own text,
 * without those additions.
 */
export async function readDocumentParts<T>(
  text: string,
  size: number,
  concurrency: number,
  read: (partText: string) => Promise<T>,
): Promise<{ parts: string[]; answers: T[] }> {
  const parts = splitIntoParts(text, size, PART_PAYMENT_LINES)
  if (parts.length === 1) return { parts, answers: [await read(parts[0])] }
  const total = parts.length
  const heading = headingLines(text)
  // Only a file with payment lines is named as a statement: a letter may mention one.
  const kind = paymentRows(text) ? documentKind(heading) : "a document"
  const asSent = (part: string, index: number) =>
    index === 0
      ? `This is part 1 of ${total} of one document.\n${part}`
      : [
          `This is part ${index + 1} of ${total} of ${kind}.`,
          ...(heading
            ? ["The document's heading lines, repeated so that this part can be read. List nothing from them again:", heading, `Part ${index + 1} of ${total}:`]
            : []),
          part,
        ].join("\n")
  const answers = await inBatches(parts, concurrency, (part, i) => read(asSent(part, i)))
  return { parts, answers }
}

/**
 * A part with many payment lines that yields fewer than a quarter as many payments has lost them (Elena's test of
 * 28 Nov: 59 lines, no payments, nothing said). A quarter, because deposits and balances are lines too.
 */
export const paymentsLost = (text: string, listed: number) => {
  const rows = paymentRows(text)
  return rows >= 10 && listed < rows / 4
}

export interface StatementCheck {
  name: string
  lines: number
  payments: Transaction[]
}

const STATEMENT_TYPES = new Set(["bank_statement", "card_statement"])

/**
 * Each statement's lines against the payments read from it, for the person to compare (Elena, 28 Nov 2026). It shows
 * both numbers whether or not they differ, and stops nothing. A file that gave no facts at all has no known kind, so
 * it is shown when it has such lines: that is the reading most in need of a look.
 */
export function statementChecks(
  documents: ReadonlyArray<{ sourceKey: string; name: string; text: string }>,
  candidates: ReadonlyArray<{ fact_key: string; value: unknown; source_ref: unknown }>,
): StatementCheck[] {
  return documents.flatMap(({ sourceKey, name, text }) => {
    const own = candidates.filter((c) => (c.source_ref as { sourceKey?: string } | null)?.sourceKey === sourceKey)
    const kinds = own.map((c) => (c.source_ref as { documentType?: string }).documentType)
    const unknown = own.length > 0 && own.every((c) => c.fact_key === "_source_scanned")
    if (!unknown && !kinds.some((kind) => kind && STATEMENT_TYPES.has(kind))) return []
    const payments = own.filter((c) => c.fact_key === "transactions").flatMap((c) => c.value as Transaction[])
    const lines = paymentRows(text)
    return lines || payments.length ? [{ name, lines, payments }] : []
  })
}
