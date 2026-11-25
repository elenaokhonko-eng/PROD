// A person's confirmations of the standards corpus, kept in the repo and tied to the exact content they cover.
//
// The loader and the seed step only write drafts. Verifying a version, reviewing what rests on it and approving a
// statement are a person's steps; this file reads their record (supabase/standards/confirmations/*.json), checks it
// still covers what the repo holds, and works out what can be applied to a database and what is still waiting.
//
// A record names content by hash: a version by its source file and the hashes of all its clauses, a statement by
// its wording. When the manifest or the seed changes, the record no longer covers it and is reported as stale; it
// is never applied to different content.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Manifest } from "./manifest.ts"
import type { RuleCitation, SeedStatement } from "./seeds.ts"
import { sha256Hex } from "./segment.ts"

export const CONFIRMATIONS_DIR = "supabase/standards/confirmations"
/** Statements held in the repo that scripts/standards/seed.ts does not load: each needs a check per edition first. */
export const UNLOADED_STATEMENTS_DIR = "supabase/standards/seeds/statements/schemes"

export function unloadedStatementKeys(dir = UNLOADED_STATEMENTS_DIR): Set<string> {
  const keys = new Set<string>()
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"))
  } catch {
    return keys
  }
  for (const file of files) {
    for (const s of (JSON.parse(readFileSync(join(dir, file), "utf8")) as { statements: Array<{ statement_key: string }> }).statements) keys.add(s.statement_key)
  }
  return keys
}

export const REVIEW_OUTCOMES = ["unchanged", "reworded", "retired"] as const
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number]

/** "The stored text matches the source and the dates are right", for one manifest as it stood. */
export interface VersionConfirmation {
  manifest: string
  content_sha256: string
  clauses_sha256: string
  note?: string | null
}

/** One statement checked against one version's wording of the clauses it rests on. */
export interface StatementReview {
  manifest: string
  statement_key: string
  revision: number
  text_sha256: string
  outcome: ReviewOutcome
  note?: string | null
}

/** One server rule checked against one version's wording of the clauses it cites. */
export interface RuleReview {
  manifest: string
  rule_id: string
  outcome: ReviewOutcome
  note?: string | null
}

/** A statement approved as written, to print for dates on which the wording read on clauses_as_of is in force. */
export interface StatementApproval {
  statement_key: string
  revision: number
  text_sha256: string
  clauses_as_of: string
}

export interface ConfirmationFile {
  $comment?: string
  /** Who checked. Recorded as verified_by, reviewed_by and approved_by. */
  by: string
  /** When they checked, with an offset, e.g. 2026-11-25T17:40:00+08:00. Recorded as it is, never "now". */
  at: string
  versions?: VersionConfirmation[]
  statement_reviews?: StatementReview[]
  rule_reviews?: RuleReview[]
  statements?: StatementApproval[]
}

export interface NamedManifest {
  file: string
  manifest: Manifest
}

/** One hash for every clause a version holds: its keys and text hashes, in key order. */
export function clausesSha256(manifest: Manifest): string {
  return sha256Hex(manifest.clauses.map((c) => `${c.clause_key}:${c.text_sha256}`).sort().join("\n"))
}

export function statementTextSha256(text: string): string {
  return sha256Hex(text)
}

export function readConfirmations(dir = CONFIRMATIONS_DIR): Array<ConfirmationFile & { file: string }> {
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
  } catch {
    return []
  }
  return files.map((file) => ({ ...(JSON.parse(readFileSync(join(dir, file), "utf8")) as ConfirmationFile), file }))
}

const SHA = /^[0-9a-f]{64}$/
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Shape only: what a record must hold before it is compared with the repo. */
export function validateConfirmationFile(f: ConfirmationFile & { file: string }): string[] {
  const errors: string[] = []
  const bad = (message: string) => errors.push(`${f.file}: ${message}`)
  if (typeof f.by !== "string" || !f.by.trim()) bad("by is missing")
  if (typeof f.at !== "string" || !AT.test(f.at) || Number.isNaN(Date.parse(f.at))) bad("at must be a date and time with an offset")
  for (const v of f.versions ?? []) {
    if (!v.manifest || !SHA.test(v.content_sha256 ?? "") || !SHA.test(v.clauses_sha256 ?? "")) bad(`version ${v.manifest ?? "?"}: manifest, content_sha256 and clauses_sha256 are required`)
  }
  for (const r of f.statement_reviews ?? []) {
    if (!r.manifest || !r.statement_key || !Number.isInteger(r.revision) || !SHA.test(r.text_sha256 ?? "")) bad(`statement review ${r.statement_key ?? "?"}: manifest, statement_key, revision and text_sha256 are required`)
    if (!REVIEW_OUTCOMES.includes(r.outcome)) bad(`statement review ${r.statement_key}: outcome must be one of ${REVIEW_OUTCOMES.join(", ")}`)
  }
  for (const r of f.rule_reviews ?? []) {
    if (!r.manifest || !r.rule_id) bad(`rule review ${r.rule_id ?? "?"}: manifest and rule_id are required`)
    if (!REVIEW_OUTCOMES.includes(r.outcome)) bad(`rule review ${r.rule_id}: outcome must be one of ${REVIEW_OUTCOMES.join(", ")}`)
  }
  for (const s of f.statements ?? []) {
    if (!s.statement_key || !Number.isInteger(s.revision) || !SHA.test(s.text_sha256 ?? "") || !DATE.test(s.clauses_as_of ?? "")) bad(`statement ${s.statement_key ?? "?"}: statement_key, revision, text_sha256 and clauses_as_of are required`)
  }
  return errors
}

export interface PlannedReview {
  kind: "statement" | "rule"
  /** statement_key or rule_id */
  id: string
  revision: number | null
  text_sha256: string | null
  outcome: ReviewOutcome
  by: string
  at: string
  note: string | null
  /** The version's hashes of the clauses the dependant rests on. */
  clause_text_sha256: string[]
}

export interface PlannedVersion {
  file: string
  manifest: Manifest
  by: string
  at: string
  note: string | null
  /** The clauses that differ from the confirmed version before it; every clause for a document's first one. */
  changedKeys: string[]
  reviews: PlannedReview[]
  /** What the database will ask for and no record gives yet. Empty means the version can be verified. */
  waitingOn: string[]
}

export interface PlannedApproval {
  statement: SeedStatement
  by: string
  at: string
  clauses_as_of: string
  text_sha256: string
  /** Empty means the statement can be approved. */
  waitingOn: string[]
}

export interface ConfirmationPlan {
  /** Malformed records, and records that contradict each other. Nothing is applied while there are any. */
  errors: string[]
  /** Records whose content has changed since: they cover nothing now and are skipped. */
  stale: string[]
  versions: PlannedVersion[]
  approvals: PlannedApproval[]
}

function byDateThenFile(a: NamedManifest, b: NamedManifest): number {
  const x = a.manifest.version.effective_from ?? ""
  const y = b.manifest.version.effective_from ?? ""
  return x < y ? -1 : x > y ? 1 : a.file < b.file ? -1 : 1
}

/**
 * What the records allow. A version is ready when it is confirmed and every statement and server rule that rests on
 * a clause it changes has a review for it; that is what the database's own check asks for. A statement is ready when
 * every clause it rests on is held by a ready version in force on clauses_as_of.
 */
export function planConfirmations(input: {
  files: Array<ConfirmationFile & { file: string }>
  manifests: NamedManifest[]
  statements: SeedStatement[]
  citations: RuleCitation[]
  /** Statement keys that exist in the repo but that the seed step does not load (the card scheme statements). */
  notLoaded?: ReadonlySet<string>
}): ConfirmationPlan {
  const errors = input.files.flatMap(validateConfirmationFile)
  const stale: string[] = []
  if (errors.length) return { errors, stale, versions: [], approvals: [] }

  const manifestByFile = new Map(input.manifests.map((m) => [m.file, m]))
  const statementByKey = new Map(input.statements.map((s) => [`${s.statement_key} r${s.revision}`, s]))
  const ruleIds = new Set(input.citations.map((c) => c.rule_id))
  // A result for a statement the seed step does not load cannot be applied anywhere. It is an error, not a skip.
  for (const f of input.files) {
    for (const key of new Set([...(f.statement_reviews ?? []), ...(f.statements ?? [])].map((r) => r.statement_key))) {
      if (input.notLoaded?.has(key)) errors.push(`${f.file}: statement ${key} is not loaded by the seed step yet (card scheme statements), so a result for it cannot be recorded`)
    }
  }

  // Confirmed versions, one per manifest.
  const confirmed = new Map<string, { by: string; at: string; note: string | null }>()
  for (const f of input.files) {
    for (const v of f.versions ?? []) {
      const named = manifestByFile.get(v.manifest)
      if (!named) {
        stale.push(`${f.file}: version ${v.manifest}: no such manifest`)
        continue
      }
      if (named.manifest.version.content_sha256 !== v.content_sha256 || clausesSha256(named.manifest) !== v.clauses_sha256) {
        stale.push(`${f.file}: version ${v.manifest}: the manifest has changed since it was confirmed`)
        continue
      }
      const before = confirmed.get(v.manifest)
      if (before && (before.by !== f.by || before.at !== f.at)) {
        errors.push(`${f.file}: version ${v.manifest} is confirmed twice, by ${before.by} at ${before.at} and by ${f.by} at ${f.at}`)
        continue
      }
      confirmed.set(v.manifest, { by: f.by, at: f.at, note: v.note ?? null })
    }
  }

  // Reviews, by version and dependant.
  const reviews = new Map<string, PlannedReview>()
  const reviewKey = (manifest: string, kind: string, id: string, revision: number | null) => `${manifest}|${kind}|${id}|${revision ?? ""}`
  const addReview = (file: string, manifest: string, review: Omit<PlannedReview, "clause_text_sha256">, label: string) => {
    const key = reviewKey(manifest, review.kind, review.id, review.revision)
    const before = reviews.get(key)
    if (before && (before.outcome !== review.outcome || before.by !== review.by || before.at !== review.at)) {
      errors.push(`${file}: ${label} is reviewed twice for ${manifest}, with different results`)
      return
    }
    reviews.set(key, { ...review, clause_text_sha256: [] })
  }
  for (const f of input.files) {
    for (const r of f.statement_reviews ?? []) {
      const label = `statement ${r.statement_key} r${r.revision}`
      const statement = statementByKey.get(`${r.statement_key} r${r.revision}`)
      if (!manifestByFile.has(r.manifest) || !statement) {
        stale.push(`${f.file}: ${label} for ${r.manifest}: no such ${statement ? "manifest" : "statement"}`)
      } else if (statementTextSha256(statement.text) !== r.text_sha256) {
        stale.push(`${f.file}: ${label} for ${r.manifest}: the statement's wording has changed since it was reviewed`)
      } else {
        addReview(f.file, r.manifest, { kind: "statement", id: r.statement_key, revision: r.revision, text_sha256: r.text_sha256, outcome: r.outcome, by: f.by, at: f.at, note: r.note ?? null }, label)
      }
    }
    for (const r of f.rule_reviews ?? []) {
      const label = `rule ${r.rule_id}`
      if (!manifestByFile.has(r.manifest) || !ruleIds.has(r.rule_id)) {
        stale.push(`${f.file}: ${label} for ${r.manifest}: no such ${ruleIds.has(r.rule_id) ? "manifest" : "rule"}`)
      } else {
        addReview(f.file, r.manifest, { kind: "rule", id: r.rule_id, revision: null, text_sha256: null, outcome: r.outcome, by: f.by, at: f.at, note: r.note ?? null }, label)
      }
    }
  }

  // Versions in the order they come into force, so each is compared with the confirmed one before it.
  const versions: PlannedVersion[] = []
  const previousByDocument = new Map<string, Manifest>()
  for (const named of [...input.manifests].sort(byDateThenFile)) {
    const who = confirmed.get(named.file)
    if (!who) continue
    const m = named.manifest
    const before = previousByDocument.get(m.document.document_key)
    const oldHashes = new Map((before?.clauses ?? []).map((c) => [c.clause_key, c.text_sha256]))
    const newHashes = new Map(m.clauses.map((c) => [c.clause_key, c.text_sha256]))
    const changed = new Set<string>()
    for (const [key, hash] of newHashes) if (oldHashes.get(key) !== hash) changed.add(key)
    for (const key of oldHashes.keys()) if (!newHashes.has(key)) changed.add(key)

    const planned: PlannedReview[] = []
    const waitingOn: string[] = []
    if (!m.version.effective_from) waitingOn.push("an in-force date (the manifest has none, and a version cannot be verified without one)")
    const hashesFor = (keys: string[]) => keys.filter((k) => newHashes.has(k)).sort().map((k) => newHashes.get(k)!)
    for (const s of input.statements) {
      const review = reviews.get(reviewKey(named.file, "statement", s.statement_key, s.revision))
      if (review) planned.push({ ...review, clause_text_sha256: hashesFor(s.clause_keys) })
      else if (s.clause_keys.some((k) => changed.has(k))) waitingOn.push(`statement ${s.statement_key} r${s.revision}`)
    }
    const citedByRule = new Map<string, string[]>()
    for (const c of input.citations) citedByRule.set(c.rule_id, [...(citedByRule.get(c.rule_id) ?? []), c.clause_key])
    for (const [ruleId, keys] of [...citedByRule].sort()) {
      const review = reviews.get(reviewKey(named.file, "rule", ruleId, null))
      if (review) planned.push({ ...review, clause_text_sha256: hashesFor(keys) })
      else if (keys.some((k) => changed.has(k))) waitingOn.push(`rule ${ruleId}`)
    }
    versions.push({ file: named.file, manifest: m, by: who.by, at: who.at, note: who.note, changedKeys: [...changed].sort(), reviews: planned, waitingOn })
    if (!waitingOn.length) previousByDocument.set(m.document.document_key, m)
  }

  // Approvals: every clause must be in a ready version in force on clauses_as_of.
  const ready = versions.filter((v) => !v.waitingOn.length)
  const approvals: PlannedApproval[] = []
  const seen = new Set<string>()
  for (const f of input.files) {
    for (const a of f.statements ?? []) {
      const label = `statement ${a.statement_key} r${a.revision}`
      const statement = statementByKey.get(`${a.statement_key} r${a.revision}`)
      if (!statement) {
        stale.push(`${f.file}: ${label}: no such statement`)
        continue
      }
      if (statementTextSha256(statement.text) !== a.text_sha256) {
        stale.push(`${f.file}: ${label}: the statement's wording has changed since it was approved`)
        continue
      }
      if (seen.has(label)) {
        errors.push(`${f.file}: ${label} is approved twice`)
        continue
      }
      seen.add(label)
      const waitingOn: string[] = []
      for (const key of statement.clause_keys) {
        const document = key.split("/")[0]
        const holds = ready.some((v) =>
          v.manifest.document.document_key === document &&
          v.manifest.clauses.some((c) => c.clause_key === key && (c.effective_from_override ?? v.manifest.version.effective_from ?? "9999") <= a.clauses_as_of))
        if (!holds) waitingOn.push(`${key} (no verified version of ${document} holds it on ${a.clauses_as_of})`)
      }
      approvals.push({ statement, by: f.by, at: f.at, clauses_as_of: a.clauses_as_of, text_sha256: a.text_sha256, waitingOn })
    }
  }
  return { errors, stale, versions, approvals }
}

/** The plan in words, for the person who made the records. */
export function describePlan(plan: ConfirmationPlan): string {
  const lines: string[] = []
  for (const e of plan.errors) lines.push(`ERROR  ${e}`)
  for (const s of plan.stale) lines.push(`STALE  ${s}`)
  for (const v of plan.versions) {
    const name = `${v.manifest.document.document_key}, ${v.manifest.version.version_label}`
    if (v.waitingOn.length) lines.push(`WAIT   ${name}: text confirmed by ${v.by}; waiting on ${v.waitingOn.length}: ${v.waitingOn.join("; ")}`)
    else lines.push(`READY  ${name}: verified by ${v.by} at ${v.at}, with ${v.reviews.length} review(s)`)
  }
  for (const a of plan.approvals) {
    const name = `${a.statement.statement_key} r${a.statement.revision}`
    if (a.waitingOn.length) lines.push(`WAIT   statement ${name}: waiting on ${a.waitingOn.join("; ")}`)
    else lines.push(`READY  statement ${name}: approved by ${a.by} at ${a.at}, as of ${a.clauses_as_of}`)
  }
  if (!lines.length) lines.push("No confirmations recorded.")
  return lines.join("\n")
}
