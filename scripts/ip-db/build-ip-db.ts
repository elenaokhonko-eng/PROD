// Checks an IP location database and writes our own copy of it in the neutral format, with its name, edition, hash and
// the provider's licence and attribution, OUTSIDE the repository (brief v5, 3c: the database is loaded into our own
// environment; the repo is public and a provider's file is never committed).
//
//   DB-IP Lite (decision 10 of the 24 November review), the two monthly downloads, plain or .gz:
//   npx tsx scripts/ip-db/build-ip-db.ts --format dbip --city <dbip-city-lite-YYYY-MM.csv.gz> \
//       --asn <dbip-asn-lite-YYYY-MM.csv.gz> --out <dir outside the repo>     (edition read from the file names)
//
//   A file already in the neutral format:
//   npx tsx scripts/ip-db/build-ip-db.ts --input <neutral.csv> --name "<database name>" --edition YYYY-MM-DD --out <dir>
//
//   The synthetic test database, for local runs:
//   npx tsx scripts/ip-db/build-ip-db.ts --synthetic --out <dir>
//
// The output (ip-db.csv and ip-db.meta.json) is what scripts/ip-db/load-ip-db.ts loads into Postgres.

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import {
  createRangeDatabase,
  type IpRange,
  parseNeutralCsv,
  toNeutralCsv,
} from '../../supabase/functions/_shared/ip-location/range-database.ts'
import { DBIP_LITE, ipLocationAttribution } from '../../supabase/functions/_shared/ip-location/providers.ts'
import { dbipEditionFromFileName, writeDbipNeutral } from './dbip.ts'
import { SYNTHETIC_IP_DATABASE, SYNTHETIC_IP_RANGES } from './synthetic.ts'

export const ADAPTERS: Record<string, (text: string) => IpRange[]> = {
  neutral: parseNeutralCsv,
}

/** Formats converted by streaming (files too large to hold in memory). */
export const STREAMED_FORMATS = ['dbip'] as const

export interface IpDbMeta {
  name: string
  edition: string
  format: string
  ranges: number
  sha256: string
  /** The provider's licence and the attribution printed with the lookups; absent for the synthetic and neutral inputs. */
  provider?: string
  licence?: string
  attribution?: string
  /** The provider's files this copy was made from: name and sha256 (names only; never a path). */
  sources?: Array<{ file: string; sha256: string }>
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

function outDir(args: string[], repoRoot: string): string {
  const out = arg(args, 'out')
  if (!out) throw new Error('--out <dir> is required')
  if (isInside(repoRoot, out)) throw new Error('--out must be outside the repository: an IP database is never committed')
  return out
}

function writeMeta(out: string, meta: IpDbMeta): void {
  writeFileSync(join(out, 'ip-db.meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
}

export function main(args: string[], repoRoot = process.cwd()): IpDbMeta {
  const out = outDir(args, repoRoot)
  const synthetic = args.includes('--synthetic')
  const format = arg(args, 'format') ?? 'neutral'
  if ((STREAMED_FORMATS as readonly string[]).includes(format)) throw new Error(`--format ${format} is converted by run(), not main()`)
  const adapter = ADAPTERS[format]
  if (!adapter) throw new Error(`unknown --format ${format}; known: ${[...Object.keys(ADAPTERS), ...STREAMED_FORMATS].join(', ')}`)
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
  writeMeta(out, built.meta)
  return built.meta
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array)
  return hash.digest('hex')
}

/** DB-IP Lite: the city and ASN downloads, streamed into one neutral file. */
export async function buildDbip(args: string[], repoRoot = process.cwd()): Promise<IpDbMeta> {
  const out = outDir(args, repoRoot)
  const city = arg(args, 'city')
  const asn = arg(args, 'asn')
  if (!city || !asn) throw new Error('--city and --asn are required for --format dbip')
  const edition = arg(args, 'edition') ?? dbipEditionFromFileName(basename(city))
  if (!edition || !/^\d{4}-\d{2}-\d{2}$/.test(edition)) throw new Error('--edition YYYY-MM-DD is required when the file names carry no month')
  const asnEdition = dbipEditionFromFileName(basename(asn))
  if (!arg(args, 'edition') && asnEdition && asnEdition !== edition) throw new Error('the city and ASN files are from different months')
  if (!existsSync(out)) mkdirSync(out, { recursive: true })
  const { ranges, sha256 } = await writeDbipNeutral(city, asn, join(out, 'ip-db.csv'))
  if (ranges === 0) throw new Error('the DB-IP files held no ranges')
  const meta: IpDbMeta = {
    name: DBIP_LITE.databaseName,
    edition,
    format: 'dbip',
    ranges,
    sha256,
    provider: DBIP_LITE.id,
    licence: `${DBIP_LITE.licence} (${DBIP_LITE.licenceUrl})`,
    attribution: ipLocationAttribution(DBIP_LITE.databaseName)!,
    sources: [
      { file: basename(city), sha256: await fileSha256(city) },
      { file: basename(asn), sha256: await fileSha256(asn) },
    ],
  }
  writeMeta(out, meta)
  return meta
}

export async function run(args: string[], repoRoot = process.cwd()): Promise<IpDbMeta> {
  return arg(args, 'format') === 'dbip' ? buildDbip(args, repoRoot) : main(args, repoRoot)
}

const invokedDirectly = process.argv[1] && /build-ip-db\.ts$/.test(process.argv[1].replace(/\\/g, '/'))
if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    // Counts and the hash only; never an address.
    (meta) => console.log(`ip-db: ${meta.name} ${meta.edition}: ${meta.ranges} ranges, sha256 ${meta.sha256}`),
    (error) => {
      console.error(`ip-db: ${error instanceof Error ? error.message : 'failed'}`)
      process.exit(1)
    },
  )
}
