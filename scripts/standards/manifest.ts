// A standards manifest: what one document version is, where its source file is kept, and how its clauses are cut
// from that file. Committed to the repo; the source file and its text are not (CLAUDE.md, lanes plan rule 5).
// Clause text is derived at load time from the private source file, and its hash must equal the hash recorded here,
// so every database loaded from the same manifest and file gets the same clause text and the same hashes.

import { readFileSync } from "node:fs"

export const BINDING_LEVELS = [
  "guideline", "notice", "circular", "industry_code", "announcement", "contract", "scheme_rule", "forum_rules",
  "published_page",
] as const
/** Which date a document is read for (review of 24 Nov 2026, Decision 6; migration 20261204120000). */
export const AS_OF_RULES = ["event_date", "any_date"] as const
/** A contract and an institution's published page name their institution (migration 20261204120100). */
export const INSTITUTION_LEVELS = ["contract", "published_page"] as const
export const APPLIES_TO = [
  "bank", "card_issuer", "payment_service_provider", "payment_system_operator", "settlement_institution",
  "dpt_service_provider", "telco",
] as const
export const INSTRUMENTS = ["account_transfer", "sg_card", "ewallet"] as const
export const PROVENANCES = ["publisher_site", "web_archive", "provided_by_user", "provided_by_institution"] as const
export const CLAUSE_TAGS = [
  "definition_gross_negligence", "definition_negligence", "definition_recklessness", "customer_security_duty",
  "liability_unauthorised", "notification_deadline", "dispute_chargeback", "conclusive_evidence", "bank_may_block",
] as const

// The database's own patterns (20261201120000_standards_corpus.sql).
export const DOCUMENT_KEY_PATTERN = /^[a-z0-9]+(\.[a-z0-9_-]+)+$/
export const CLAUSE_KEY_PATTERN = /^[a-z0-9]+(\.[a-z0-9_-]+)+\/[a-z0-9._()~-]+$/
const SHA256 = /^[0-9a-f]{64}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

export interface ManifestDocument {
  document_key: string
  title: string
  publisher: string
  binding_level: (typeof BINDING_LEVELS)[number]
  applies_to: string[]
  instrument_scope: string[]
  institution: string | null
  card_scheme: "visa" | "mastercard" | null
  canonical_url: string | null
  /** Omitted means "event_date". "any_date" only for MAS written replies and other official clarifications. */
  as_of_rule?: (typeof AS_OF_RULES)[number]
}

export interface ManifestVersion {
  version_label: string
  effective_from: string | null
  issued_on: string | null
  /** When the file was fetched, fixed here so every database records the same time. */
  retrieved_at: string
  source_url: string | null
  /** Path of the file inside the private source store, relative to its root. */
  snapshot_path: string
  content_sha256: string
  provenance: (typeof PROVENANCES)[number]
  coverage: "full" | "selected_sections"
  /** The web archive's capture date; set exactly when provenance is "web_archive". */
  archived_at?: string | null
}

export interface ManifestExtraction {
  /** pdf: pdftotext (poppler), pages split on form feeds. html: tags stripped between `start` and `end`. */
  format: "pdf" | "html"
  /** Recorded for the reader; the hash check is what catches a different extractor. */
  extractor: string
  /** html only: regexes marking where the document body starts and ends in the page source. */
  html_start?: string
  html_end?: string
  /** Regexes (multiline) removed from each page before cutting: page furniture, running headers, amendment notes. */
  remove: string[]
  /** Optional regex: text after its first match (from the last marker on) is not part of any clause. */
  end?: string
}

/**
 * One cut in the text, in reading order. The text from this marker to the next marker belongs to `clause` (or to
 * nothing when null: headings, notes). A clause may own several pieces, for a paragraph interrupted by footnotes.
 * `skip` leaves the matched text out (a paragraph number already held in clause_ref). `at_page` cuts at the start of a
 * page instead of at a match, for a paragraph that resumes on the next page after its footnotes.
 */
export interface ManifestMarker {
  at?: string
  at_page?: number
  clause: string | null
  skip?: boolean
}

export interface ManifestClause {
  clause_key: string
  clause_ref: string | null
  heading_path: string[]
  tags: string[]
  /** Narrower than the document's scope; null means the document's. */
  instrument_scope: string[] | null
  effective_from_override: string | null
  /** The source page(s) the clause was cut from, 1-based; written by the loader. */
  pages: number[]
  text_sha256: string
  note?: string
}

export interface Manifest {
  $comment?: string
  document: ManifestDocument
  version: ManifestVersion
  extraction: ManifestExtraction
  markers: ManifestMarker[]
  clauses: ManifestClause[]
}

export function readManifest(path: string): Manifest {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest
  const errors = validateManifest(manifest)
  if (errors.length) throw new Error(`${path}:\n  ${errors.join("\n  ")}`)
  return manifest
}

function isHttps(value: unknown): boolean {
  return typeof value === "string" && /^https:\/\//.test(value)
}

function regexError(source: string, label: string): string | null {
  try {
    new RegExp(source, "m")
    return null
  } catch (error) {
    return `${label}: not a regex: ${(error as Error).message}`
  }
}

export function validateManifest(m: Manifest): string[] {
  const errors: string[] = []
  const d = m?.document
  const v = m?.version
  const x = m?.extraction
  if (!d || !v || !x || !Array.isArray(m.markers) || !Array.isArray(m.clauses)) {
    return ["manifest needs document, version, extraction, markers and clauses"]
  }

  if (!DOCUMENT_KEY_PATTERN.test(d.document_key ?? "")) errors.push(`document_key ${d.document_key} does not match the database pattern`)
  if (!d.title?.trim() || !d.publisher?.trim()) errors.push("document needs a title and publisher")
  if (!(BINDING_LEVELS as readonly string[]).includes(d.binding_level)) errors.push(`binding_level ${d.binding_level}`)
  for (const a of d.applies_to ?? []) if (!(APPLIES_TO as readonly string[]).includes(a)) errors.push(`applies_to ${a}`)
  for (const s of d.instrument_scope ?? []) if (!(INSTRUMENTS as readonly string[]).includes(s)) errors.push(`instrument_scope ${s}`)
  if ((INSTITUTION_LEVELS as readonly string[]).includes(d.binding_level) !== (d.institution !== null)) {
    errors.push("a contract or published page names its institution, and only those do")
  }
  if (d.as_of_rule !== undefined && !(AS_OF_RULES as readonly string[]).includes(d.as_of_rule)) errors.push(`as_of_rule ${d.as_of_rule}`)
  if (d.as_of_rule === "any_date" && d.binding_level !== "announcement") errors.push("as_of_rule any_date is only for an announcement (a reply or clarification)")
  if ((d.binding_level === "scheme_rule") !== (d.card_scheme !== null)) errors.push("a scheme rule names its scheme, and only a scheme rule does")
  if (d.canonical_url !== null && !isHttps(d.canonical_url)) errors.push("canonical_url must be https")

  if (!v.version_label?.trim()) errors.push("version_label is empty")
  for (const [name, value] of [["effective_from", v.effective_from], ["issued_on", v.issued_on]] as const) {
    if (value !== null && !ISO_DATE.test(value)) errors.push(`${name} is not a date`)
  }
  if (!ISO_TIME.test(v.retrieved_at ?? "")) errors.push("retrieved_at must be a UTC time (…Z)")
  if (v.source_url !== null && !isHttps(v.source_url)) errors.push("source_url must be https")
  if (v.source_url === null && v.provenance !== "provided_by_user" && v.provenance !== "provided_by_institution") {
    errors.push("source_url is required unless the file was provided by the user or the institution")
  }
  if (!v.snapshot_path || /^([a-zA-Z]:|[\\/])/.test(v.snapshot_path) || v.snapshot_path.includes("..")) {
    errors.push("snapshot_path must be relative to the private source store")
  }
  if (!SHA256.test(v.content_sha256 ?? "")) errors.push("content_sha256 is not a sha256")
  if (!(PROVENANCES as readonly string[]).includes(v.provenance)) errors.push(`provenance ${v.provenance}`)
  if (v.coverage !== "full" && v.coverage !== "selected_sections") errors.push(`coverage ${v.coverage}`)
  const archived = v.archived_at ?? null
  if (archived !== null && !ISO_DATE.test(archived)) errors.push("archived_at is not a date")
  if ((v.provenance === "web_archive") !== (archived !== null)) errors.push("archived_at is set exactly when provenance is web_archive")

  if (x.format !== "pdf" && x.format !== "html") errors.push(`extraction format ${x.format}`)
  if (x.format === "html" && (!x.html_start || !x.html_end)) errors.push("html extraction needs html_start and html_end")
  for (const [i, r] of (x.remove ?? []).entries()) {
    const e = regexError(r, `remove[${i}]`)
    if (e) errors.push(e)
  }
  for (const r of [x.html_start, x.html_end, x.end]) {
    if (r === undefined) continue
    const e = regexError(r, "extraction")
    if (e) errors.push(e)
  }

  const keys = new Set<string>()
  for (const c of m.clauses) {
    if (keys.has(c.clause_key)) errors.push(`${c.clause_key} is listed twice`)
    keys.add(c.clause_key)
    if (!CLAUSE_KEY_PATTERN.test(c.clause_key)) errors.push(`${c.clause_key} does not match the database pattern`)
    if (c.clause_key.split("/")[0] !== d.document_key) errors.push(`${c.clause_key} does not belong to ${d.document_key}`)
    if (!SHA256.test(c.text_sha256 ?? "")) errors.push(`${c.clause_key}: text_sha256 is not a sha256`)
    if (!Array.isArray(c.heading_path) || !Array.isArray(c.tags) || !Array.isArray(c.pages)) {
      errors.push(`${c.clause_key}: heading_path, tags and pages are arrays`)
    }
    for (const t of c.tags ?? []) if (!(CLAUSE_TAGS as readonly string[]).includes(t)) errors.push(`${c.clause_key}: tag ${t}`)
    if (c.instrument_scope !== null) {
      for (const s of c.instrument_scope ?? []) {
        if (!d.instrument_scope.includes(s)) errors.push(`${c.clause_key}: scope ${s} is wider than the document's`)
      }
    }
    if (c.effective_from_override !== null && !ISO_DATE.test(c.effective_from_override ?? "")) {
      errors.push(`${c.clause_key}: effective_from_override is not a date`)
    }
    // Clause text lives only in the private source file; a manifest never carries it.
    if ("text" in c || "text_content" in c) errors.push(`${c.clause_key}: a manifest must not hold clause text`)
  }

  const owned = new Set<string>()
  for (const [i, marker] of m.markers.entries()) {
    if ((marker.at === undefined) === (marker.at_page === undefined)) errors.push(`markers[${i}] needs either at or at_page`)
    if (marker.at !== undefined) {
      const e = regexError(marker.at, `markers[${i}]`)
      if (e) errors.push(e)
    }
    if (marker.at_page !== undefined && (!Number.isInteger(marker.at_page) || marker.at_page < 1)) errors.push(`markers[${i}] at_page`)
    if (marker.clause !== null) {
      if (!keys.has(marker.clause)) errors.push(`markers[${i}] names ${marker.clause}, which is not in clauses`)
      owned.add(marker.clause)
    }
  }
  for (const key of keys) if (!owned.has(key)) errors.push(`${key} has no marker`)
  return errors
}

/** JSON with two-space indent, arrays of plain values on one line, so a manifest diff shows one clause per change. */
export function formatManifest(value: unknown, indent = ""): string {
  const inner = indent + "  "
  if (Array.isArray(value)) {
    if (!value.length) return "[]"
    if (value.every((v) => v === null || typeof v !== "object")) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`
    return `[\n${value.map((v) => inner + formatManifest(v, inner)).join(",\n")}\n${indent}]`
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    if (!entries.length) return "{}"
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatManifest(v, inner)}`).join(",\n")}\n${indent}}`
  }
  return JSON.stringify(value)
}
