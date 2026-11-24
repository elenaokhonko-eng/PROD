// Monthly refresh of the DB-IP Lite copy (review of 24 November, decision 10). DB-IP publishes the Lite files monthly
// (dated the 1st) under CC BY 4.0; see providers.ts for the licence terms and the attribution.
//
//   IP_DB_DATABASE_URL=postgres://…@127.0.0.1:<558xx>/postgres \
//   npx tsx scripts/ip-db/refresh-dbip.ts --data-dir C:\guidebuoy-backups\ip-data [--month YYYY-MM] [--no-load]
//
// 1. Downloads dbip-city-lite-YYYY-MM.csv.gz and dbip-asn-lite-YYYY-MM.csv.gz into <data-dir>/YYYY-MM/ (skipped when
//    already there). The data directory must be outside the repository: the files are never committed.
// 2. Converts them with build-ip-db.ts into <data-dir>/YYYY-MM/build/.
// 3. Loads the result with load-ip-db.ts (local databases only) unless --no-load, and marks it current.
//
// Prints file names, counts and hashes only.

import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { buildDbip, isInside } from './build-ip-db.ts'

export const DBIP_DOWNLOAD_BASE = 'https://download.db-ip.com/free'

export function dbipFileNames(month: string): { city: string; asn: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('--month must be YYYY-MM')
  return { city: `dbip-city-lite-${month}.csv.gz`, asn: `dbip-asn-lite-${month}.csv.gz` }
}

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7)
}

async function download(url: string, to: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status} for ${url.split('/').pop()}`)
  const partial = `${to}.partial`
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(partial))
  renameSync(partial, to)
}

function arg(args: string[], name: string): string | null {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

export async function refresh(args: string[], repoRoot = process.cwd()): Promise<string> {
  const dataDir = arg(args, 'data-dir') ?? process.env.IP_DB_DATA_DIR
  if (!dataDir) throw new Error('--data-dir (or IP_DB_DATA_DIR) is required')
  if (isInside(repoRoot, dataDir)) throw new Error('--data-dir must be outside the repository: an IP database is never committed')
  const month = arg(args, 'month') ?? currentMonth()
  const names = dbipFileNames(month)
  const monthDir = join(dataDir, month)
  mkdirSync(monthDir, { recursive: true })
  for (const file of [names.city, names.asn]) {
    const to = join(monthDir, file)
    if (existsSync(to)) {
      console.log(`ip-db: ${file} already downloaded`)
      continue
    }
    console.log(`ip-db: downloading ${file}`)
    await download(`${DBIP_DOWNLOAD_BASE}/${file}`, to)
  }
  const buildDir = join(monthDir, 'build')
  const meta = await buildDbip(['--city', join(monthDir, names.city), '--asn', join(monthDir, names.asn), '--out', buildDir], repoRoot)
  console.log(`ip-db: ${meta.name} ${meta.edition}: ${meta.ranges} ranges, sha256 ${meta.sha256}`)
  return buildDir
}

const invokedDirectly = process.argv[1] && /refresh-dbip\.ts$/.test(process.argv[1].replace(/\\/g, '/'))
if (invokedDirectly) {
  ;(async () => {
    const args = process.argv.slice(2)
    const buildDir = await refresh(args)
    if (args.includes('--no-load')) return
    const { assertLocalDatabaseUrl, load } = await import('./load-ip-db.ts')
    const url = assertLocalDatabaseUrl(process.env.IP_DB_DATABASE_URL)
    const { default: pg } = await import('pg')
    const client = new pg.Client({ connectionString: url.toString() })
    await client.connect()
    try {
      const result = await load(buildDir, client as never)
      console.log(`ip-db: loaded ${result.editionId}: ${result.ranges} ranges (now current)`)
    } finally {
      await client.end()
    }
  })().catch((error) => {
    console.error(`ip-db: ${error instanceof Error ? error.message : 'failed'}`)
    process.exit(1)
  })
}
