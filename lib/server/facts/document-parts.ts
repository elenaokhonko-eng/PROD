import type { FactCandidate } from "@/lib/facts"

// A long document's facts are read in parts (requirements 9.2, 27 Nov 2026), so a long list of payments can't overflow
// one answer and no text is cut off.

/** Whole lines, each part no longer than `size` characters (a longer single line is split). */
export function splitIntoParts(text: string, size: number): string[] {
  const parts: string[] = []
  let current: string | null = null
  for (const line of text.split("\n")) {
    for (let i = 0; i === 0 || i < line.length; i += size) {
      const piece = line.slice(i, i + size)
      if (current !== null && current.length + 1 + piece.length <= size) current += `\n${piece}`
      else {
        if (current !== null) parts.push(current)
        current = piece
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
export const paymentRows = (text: string) => text.split("\n").filter((line) => DATE.test(line) && AMOUNT.test(line)).length

/**
 * A part with many payment lines that yields fewer than a quarter as many payments has lost them (Elena's test of
 * 28 Nov: 59 lines, no payments, nothing said). A quarter, because deposits and balances are lines too.
 */
export const paymentsLost = (text: string, listed: number) => {
  const rows = paymentRows(text)
  return rows >= 10 && listed < rows / 4
}
