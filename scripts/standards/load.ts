// Loads standards manifests as draft versions.
//
//   npx tsx scripts/standards/load.ts <manifest.json>... --sources <dir> [--psql "<command>"] [--sql-out <dir>]
//       [--sheet-dir <dir>] [--write-hashes] [--print-text <file>]
//
// --sources       root of the private source store; each manifest's snapshot_path is read under it.
// --psql          a psql command for the target database, given the SQL on stdin, e.g.
//                 "docker exec -i <container> psql -U postgres -h localhost". Never a staging or production URL.
// --sql-out       write the generated SQL there instead of (or as well as) running it.
// --sheet-dir     write a verification sheet per version to <dir>/<document_key>/<version>.html (outside the repo).
// --write-hashes  authoring only: record the file hash, the clause hashes and pages in the manifest instead of
//                 refusing a mismatch. Re-read the sheet before committing a manifest written this way.
// --print-text    authoring only: write the cleaned text with page and offset marks, to place markers.
//
// The loader checks, before writing anything, that the source file is the one the manifest names (content_sha256)
// and that every clause cut from it hashes to the manifest's text_sha256. The database computes the hash again on
// insert and the SQL stops if it differs. So every database loaded from one manifest holds the same text and hashes.
// It never verifies a version or approves a statement.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileSha256, sourcePages } from "./extract.ts"
import { formatManifest, type Manifest, validateManifest } from "./manifest.ts"
import { buildStream, cutClauses, hashMismatches, pageAt } from "./segment.ts"
import { buildSheet } from "./sheet.ts"
import { buildLoadSql } from "./sql.ts"

const STAGING_OR_PRODUCTION = /yqqkkftfddxuxmpxwbcj|ottnvtqltxinxasedbjp|supabase\.co|pooler\.supabase\.com/i
const PLACEHOLDER = "0".repeat(64)

interface Options {
  manifests: string[]
  sources: string
  psql: string | null
  sqlOut: string | null
  sheetDir: string | null
  writeHashes: boolean
  printText: string | null
}

function parseArgs(argv: string[]): Options {
  const o: Options = { manifests: [], sources: "", psql: null, sqlOut: null, sheetDir: null, writeHashes: false, printText: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${a} needs a value`)
      return value
    }
    if (a === "--sources") o.sources = next()
    else if (a === "--psql") o.psql = next()
    else if (a === "--sql-out") o.sqlOut = next()
    else if (a === "--sheet-dir") o.sheetDir = next()
    else if (a === "--write-hashes") o.writeHashes = true
    else if (a === "--print-text") o.printText = next()
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`)
    else o.manifests.push(a)
  }
  if (!o.manifests.length || !o.sources) throw new Error("usage: load.ts <manifest.json>... --sources <dir> [--psql <cmd>] [--sql-out <dir>] [--sheet-dir <dir>]")
  if (o.psql && STAGING_OR_PRODUCTION.test(o.psql)) throw new Error("--psql points at a hosted Supabase project; the loader is run against a local database only")
  return o
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function toHref(fromDir: string, file: string): string {
  return relative(fromDir, file).split(/[\\/]/).map(encodeURIComponent).join("/")
}

function loadOne(manifestFile: string, o: Options): { changed: string | null } {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest
  const errors = validateManifest(manifest).filter((e) => !(o.writeHashes && /sha256 is not a sha256|content_sha256/.test(e)))
  if (errors.length) throw new Error(`${manifestFile}:\n  ${errors.join("\n  ")}`)
  const repoPath = relative(process.cwd(), resolve(manifestFile)).split(/[\\/]/).join("/")
  const label = `${manifest.document.document_key} "${manifest.version.version_label}"`

  const source = resolve(o.sources, manifest.version.snapshot_path)
  if (!existsSync(source)) throw new Error(`${label}: source file not found in the private store: ${manifest.version.snapshot_path}`)
  const fileHash = fileSha256(source)
  if (fileHash !== manifest.version.content_sha256) {
    if (!o.writeHashes) throw new Error(`${label}: the source file's sha256 is ${fileHash}, the manifest records ${manifest.version.content_sha256}`)
    manifest.version.content_sha256 = fileHash
  }

  const pages = sourcePages(source, manifest.extraction)
  if (o.printText) {
    const stream = buildStream(pages, manifest.extraction.remove)
    const marked = stream.text.split("\n").reduce<{ out: string[]; offset: number }>((acc, line) => {
      acc.out.push(`[p${pageAt(stream, acc.offset)} @${acc.offset}] ${line}`)
      acc.offset += line.length + 1
      return acc
    }, { out: [], offset: 0 }).out
    mkdirSync(dirname(resolve(o.printText)), { recursive: true })
    writeFileSync(o.printText, marked.join("\n"), "utf8")
    console.log(`${label}: text written to ${o.printText}`)
  }

  const cut = cutClauses(manifest, pages)
  const mismatches = hashMismatches(manifest, cut)
  if (o.writeHashes) {
    const byKey = new Map(cut.map((c) => [c.clause_key, c]))
    for (const c of manifest.clauses) {
      const found = byKey.get(c.clause_key)
      if (!found) continue
      c.text_sha256 = found.text_sha256
      c.pages = found.pages
    }
    writeFileSync(manifestFile, formatManifest(manifest) + "\n", "utf8")
    console.log(`${label}: hashes written for ${mismatches.length} changed clause(s), file ${fileHash.slice(0, 12)}…`)
  } else if (mismatches.length) {
    const placeholders = mismatches.filter((x) => x.expected === PLACEHOLDER).length
    throw new Error(`${label}: ${mismatches.length} clause(s) cut from the file do not match the manifest's hashes` +
      `${placeholders ? ` (${placeholders} never recorded)` : ""}: ${mismatches.slice(0, 10).map((x) => x.clause_key).join(", ")}`)
  }

  if (o.sheetDir) {
    const sheetFile = resolve(o.sheetDir, manifest.document.document_key, `${slug(manifest.version.version_label)}.html`)
    mkdirSync(dirname(sheetFile), { recursive: true })
    writeFileSync(sheetFile, buildSheet({
      manifest, manifestRepoPath: repoPath, pages, cut, sourceHref: toHref(dirname(sheetFile), source),
      generatedAt: new Date().toISOString(),
    }), "utf8")
    console.log(`${label}: verification sheet ${sheetFile}`)
  }

  const sql = buildLoadSql(manifest, cut, repoPath)
  if (o.sqlOut) {
    mkdirSync(resolve(o.sqlOut), { recursive: true })
    const out = join(resolve(o.sqlOut), `${manifest.document.document_key}.${slug(manifest.version.version_label)}.sql`)
    writeFileSync(out, sql, "utf8")
    console.log(`${label}: SQL written to ${out}`)
  }
  if (!o.psql) return { changed: null }

  const run = spawnSync(o.psql, { shell: true, input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const notice = /standards loader: .*/.exec(run.stderr ?? "")?.[0] ?? null
  if (run.status !== 0) {
    const err = (run.stderr ?? "").split("\n").filter((l) => /ERROR|DETAIL|HINT/.test(l)).join("\n")
    throw new Error(`${label}: psql failed (${run.status}):\n${err || run.stderr || run.error?.message}`)
  }
  console.log(notice ?? `${label}: loaded`)
  return { changed: notice }
}

function main(): void {
  const o = parseArgs(process.argv.slice(2))
  let failed = 0
  for (const file of o.manifests) {
    try {
      loadOne(file, o)
    } catch (error) {
      failed++
      console.error((error as Error).message)
    }
  }
  if (failed) process.exit(1)
}

main()
