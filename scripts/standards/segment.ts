// Cutting a source document's text into clauses, as its manifest says. Pure functions: the same pages and manifest
// always give the same clause texts and hashes.

import { createHash } from "node:crypto"
import type { Manifest, ManifestMarker } from "./manifest.ts"

export interface CutClause {
  clause_key: string
  text: string
  text_sha256: string
  pages: number[]
}

export interface Stream {
  text: string
  /** Offset in `text` where each page starts; page n (1-based) starts at pageStarts[n - 1]. */
  pageStarts: number[]
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** The form stored and hashed: compatibility-normalised (ligatures, no-break spaces), whitespace collapsed. */
export function normaliseClauseText(text: string): string {
  return text.normalize("NFKC").replace(/­/g, "").replace(/\s+/g, " ").trim()
}

export function cleanPage(text: string, remove: string[]): string {
  let out = text.replace(/\r\n?/g, "\n")
  for (const pattern of remove) out = out.replace(new RegExp(pattern, "gm"), "")
  return out
}

export function buildStream(pages: string[], remove: string[]): Stream {
  const pageStarts: number[] = []
  let text = ""
  for (const page of pages) {
    pageStarts.push(text.length)
    text += cleanPage(page, remove) + "\n"
  }
  return { text, pageStarts }
}

export function pageAt(stream: Stream, offset: number): number {
  let page = 1
  for (let i = 0; i < stream.pageStarts.length; i++) if (stream.pageStarts[i] <= offset) page = i + 1
  return page
}

interface Piece {
  marker: ManifestMarker
  index: number
  start: number
  end: number
}

/** Finds each marker in reading order; each must come after the one before it. */
export function findPieces(stream: Stream, markers: ManifestMarker[], endPattern?: string): Piece[] {
  const found: Array<{ marker: ManifestMarker; index: number; at: number; start: number }> = []
  let from = 0
  for (const [index, marker] of markers.entries()) {
    if (marker.at_page !== undefined) {
      const at = stream.pageStarts[marker.at_page - 1]
      if (at === undefined || at < from) {
        throw new Error(`marker ${index} (${marker.clause ?? "dropped"}) at_page ${marker.at_page} is not after offset ${from} (page ${pageAt(stream, from)})`)
      }
      found.push({ marker, index, at, start: at })
      from = at + 1
      continue
    }
    const re = new RegExp(marker.at as string, "gm")
    re.lastIndex = from
    const match = re.exec(stream.text)
    if (!match) {
      throw new Error(`marker ${index} (${marker.clause ?? "dropped"}) /${marker.at}/ not found after offset ${from} (page ${pageAt(stream, from)})`)
    }
    const at = match.index
    found.push({ marker, index, at, start: marker.skip ? at + match[0].length : at })
    from = at + Math.max(match[0].length, 1)
  }

  let streamEnd = stream.text.length
  if (endPattern) {
    const re = new RegExp(endPattern, "gm")
    re.lastIndex = from
    const match = re.exec(stream.text)
    if (!match) throw new Error(`end /${endPattern}/ not found after the last marker`)
    streamEnd = match.index
  }

  return found.map((f, i) => ({
    marker: f.marker,
    index: f.index,
    start: f.start,
    end: i + 1 < found.length ? found[i + 1].at : streamEnd,
  }))
}

/** Every clause the manifest lists, cut from the pages: text in order of its pieces, joined by a space. */
export function cutClauses(manifest: Manifest, pages: string[]): CutClause[] {
  const stream = buildStream(pages, manifest.extraction.remove)
  const pieces = findPieces(stream, manifest.markers, manifest.extraction.end)
  const parts = new Map<string, string[]>()
  const pageSets = new Map<string, Set<number>>()
  for (const piece of pieces) {
    if (piece.marker.clause === null) continue
    const raw = stream.text.slice(piece.start, piece.end)
    if (!raw.trim()) throw new Error(`marker ${piece.index} (${piece.marker.clause}) cuts an empty piece`)
    const lead = raw.length - raw.trimStart().length
    const trail = raw.length - raw.trimEnd().length
    const pagesOfPiece = pageSets.get(piece.marker.clause) ?? new Set<number>()
    const first = pageAt(stream, piece.start + lead)
    const last = pageAt(stream, Math.max(piece.start + lead, piece.end - trail - 1))
    for (let p = first; p <= last; p++) pagesOfPiece.add(p)
    pageSets.set(piece.marker.clause, pagesOfPiece)
    parts.set(piece.marker.clause, [...(parts.get(piece.marker.clause) ?? []), raw])
  }

  return manifest.clauses.map((c) => {
    const text = normaliseClauseText((parts.get(c.clause_key) ?? []).join(" "))
    if (!text) throw new Error(`${c.clause_key} has no text`)
    return {
      clause_key: c.clause_key,
      text,
      text_sha256: sha256Hex(text),
      pages: [...(pageSets.get(c.clause_key) ?? [])].sort((a, b) => a - b),
    }
  })
}

export interface HashCheck {
  clause_key: string
  expected: string
  actual: string
}

/** Clauses whose cut text does not hash to the value the manifest records. */
export function hashMismatches(manifest: Manifest, cut: CutClause[]): HashCheck[] {
  const byKey = new Map(cut.map((c) => [c.clause_key, c]))
  return manifest.clauses
    .map((c) => ({ clause_key: c.clause_key, expected: c.text_sha256, actual: byKey.get(c.clause_key)?.text_sha256 ?? "" }))
    .filter((c) => c.expected !== c.actual)
}
