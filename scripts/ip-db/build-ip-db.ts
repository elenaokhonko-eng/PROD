// Checks an IP location database in the neutral format and writes our own copy of it, with its name, edition and
// hash, OUTSIDE the repository (brief v5, 3c: the database is loaded into our own environment; the repo is public and
// a provider's file is never committed).
//
//   npx tsx scripts/ip-db/build-ip-db.ts --input <neutral.csv> --name "<database name>" --edition YYYY-MM-DD --out <dir>
//   npx tsx scripts/ip-db/build-ip-db.ts --synthetic --out <dir>      (the synthetic test database, for local runs)
//
// The provider is not chosen yet (Elena chooses from the shortlist in the Lane 2 pull request). Its download is
// converted to the neutral format by an adapter added to ADAPTERS once it is chosen; until then only "neutral" exists.
// The output (ip-db.csv and ip-db.meta.json) is what a database-backed lookup loads (requested from Lane 1).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  createRangeDatabase,
  type IpRange,
  parseNeutralCsv,
  toNeutralCsv,
} from '../../supabase/functions/_shared/ip-location/range-database.ts'
import { SYNTHETIC_IP_DATABASE, SYNTHETIC_IP_RANGES } from './synthetic.ts'

export const ADAPTERS: Record<string, (text: string) => IpRange[]> = {
  neutral: parseNeutralCsv,
}

export interface IpDbMeta {
  name: string
  edition: string
  format: string
  ranges: number
  sha256: string
}

export function isInside(dir: string, path: string): boolean {
  const rel = relative(resolve(dir), resolve(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Validates the ranges (the same checks the lookup makes) and returns the file to write with its metadata. */
export function buildIpDb(ranges: readonly IpRange[], meta: { name: string; edition: string; format: string }): { csv: string; meta: IpDbMeta } {
  createRangeDatabase(meta, ranges)
  const csv = toNeutralCsv(ranges)
  return {
    csv,
    meta: { ...meta, ranges: ranges.length, sha256: createHash('sha256').update(csv).digest('hex') },
  }
}

function arg(args: string[], name: string): string | null {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

export function main(args: string[], repoRoot = process.cwd()): IpDbMeta {
  const out = arg(args, 'out')
  if (!out) throw new Error('--out <dir> is required')
  if (isInside(repoRoot, out)) throw new Error('--out must be outside the repository: an IP database is never committed')
  const synthetic = args.includes('--synthetic')
  const format = arg(args, 'format') ?? 'neutral'
  const adapter = ADAPTERS[format]
  if (!adapter) throw new Error(`unknown --format ${format}; known: ${Object.keys(ADAPTERS).join(', ')}`)
  let ranges: readonly IpRange[]
  let meta: { name: string; edition: string; format: string }
  if (synthetic) {
    ranges = SYNTHETIC_IP_RANGES
    meta = { ...SYNTHETIC_IP_DATABASE, format: 'synthetic' }
  } else {
    const input = arg(args, 'input')
    const name = arg(args, 'name')
    const edition = arg(args, 'edition')
    if (!input || !name || !edition) throw new Error('--input, --name and --edition are required (or --synthetic)')
    ranges = adapter(readFileSync(input, 'utf8'))
    meta = { name, edition, format }
  }
  const built = buildIpDb(ranges, meta)
  if (!existsSync(out)) mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'ip-db.csv'), built.csv)
  writeFileSync(join(out, 'ip-db.meta.json'), `${JSON.stringify(built.meta, null, 2)}\n`)
  return built.meta
}

const invokedDirectly = process.argv[1] && /build-ip-db\.ts$/.test(process.argv[1].replace(/\\/g, '/'))
if (invokedDirectly) {
  try {
    const meta = main(process.argv.slice(2))
    // Counts and the hash only; never an address.
    console.log(`ip-db: ${meta.name} ${meta.edition}: ${meta.ranges} ranges, sha256 ${meta.sha256}`)
  } catch (error) {
    console.error(`ip-db: ${error instanceof Error ? error.message : 'failed'}`)
    process.exit(1)
  }
}
