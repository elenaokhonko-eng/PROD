// Reading a source file from the private store as pages of text. PDF through poppler's pdftotext (set
// STANDARDS_PDFTOTEXT to its path if it is not on PATH); HTML by stripping tags between two markers.

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { ManifestExtraction } from "./manifest.ts"

/** The hash recorded as content_sha256: over the file's bytes, exactly as fetched. */
export function fileSha256(path: string): string {
  return createHash("sha256").update(new Uint8Array(readFileSync(path))).digest("hex")
}

export function pdfPages(path: string): string[] {
  const bin = process.env.STANDARDS_PDFTOTEXT || "pdftotext"
  const run = spawnSync(bin, ["-enc", "UTF-8", path, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(`pdftotext failed on ${path}: ${run.stderr || run.error?.message}`)
  const pages = run.stdout.split("\f")
  if (pages.length > 1 && pages[pages.length - 1].trim() === "") pages.pop()
  return pages
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”",
  ldquo: "“", ndash: "–", mdash: "—", hellip: "…",
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name] ?? whole
  })
}

/** The body of an HTML page between the two markers, as text with one block element per line. */
export function htmlText(html: string, start: string, end: string): string {
  const s = new RegExp(start, "m").exec(html)
  if (!s) throw new Error(`html_start /${start}/ not found`)
  const rest = html.slice(s.index + s[0].length)
  const e = new RegExp(end, "m").exec(rest)
  if (!e) throw new Error(`html_end /${end}/ not found after html_start`)
  const body = rest.slice(0, e.index)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div|tr|table|ol|ul|section|article|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  return decodeEntities(body).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
}

export function sourcePages(path: string, extraction: ManifestExtraction): string[] {
  if (extraction.format === "pdf") return pdfPages(path)
  return [htmlText(readFileSync(path, "utf8"), extraction.html_start as string, extraction.html_end as string)]
}
