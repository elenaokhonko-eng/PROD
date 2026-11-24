// Loads a copy written by build-ip-db.ts (ip-db.csv + ip-db.meta.json) into Postgres, into Lane 1's table
// public.ip_location_ranges (migration 20261204120200_case_ip_locations.sql), keyed by database and database_edition.
// The current edition of a database is its latest database_edition (sql-database.ts); once the new copy is in, older
// editions of the same database are removed (each pack keeps its own lookup results and the database date).
//
//   IP_DB_DATABASE_URL=postgres://…@127.0.0.1:<558xx>/postgres \
//   npx tsx scripts/ip-db/load-ip-db.ts --dir <dir written by build-ip-db>
//
// LOCAL DATABASES ONLY from this script: it refuses any host but this machine and the shared Supabase port 54322.
// Loading a hosted database is a release step for Elena, not something this script does. The connection string is
// read from the environment and never printed; no address is printed either.

import { createReadStream, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { IP_LOCATION_RANGES_TABLE } from '../../supabase/functions/_shared/ip-location/sql-database.ts'
import { NEUTRAL_HEADER, splitCsvLine } from '../../supabase/functions/_shared/ip-location/range-database.ts'
import type { IpDbMeta } from './build-ip-db.ts'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const FORBIDDEN_PORTS = new Set(['54322'])
export const BATCH_SIZE = 5000

/** Throws unless the URL points at a database on this machine, on a port other than the shared 54322. */
export function assertLocalDatabaseUrl(url: string | undefined): URL {
  if (!url) throw new Error('IP_DB_DATABASE_URL is not set')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('IP_DB_DATABASE_URL is not a URL')
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error('IP_DB_DATABASE_URL must be a postgres URL')
  if (!LOCAL_HOSTS.has(parsed.hostname)) throw new Error('this script loads local databases only (host must be this machine)')
  if (!parsed.port) throw new Error('give the local port explicitly')
  if (FORBIDDEN_PORTS.has(parsed.port)) throw new Error('port 54322 is the shared Supabase database; use your own local database')
  return parsed
}

export interface RangeColumns {
  start: string[]
  end: string[]
  country: (string | null)[]
  region: (string | null)[]
  city: (string | null)[]
  radius: (number | null)[]
  asn: (string | null)[]
  organisation: (string | null)[]
  flags: string[]
}

const cell = (v: string | undefined) => (v === undefined || v.trim() === '' ? null : v.trim())

function emptyColumns(): RangeColumns {
  return { start: [], end: [], country: [], region: [], city: [], radius: [], asn: [], organisation: [], flags: [] }
}

export function pushNeutralLine(cols: RangeColumns, line: string, n: number): void {
  const cells = splitCsvLine(line)
  if (cells.length !== NEUTRAL_HEADER.length) throw new Error(`ip-db.csv line ${n}: expected ${NEUTRAL_HEADER.length} fields`)
  const [start, end, country, region, city, radius, asn, organisation, flags] = cells
  cols.start.push(start.trim())
  cols.end.push(end.trim())
  cols.country.push(cell(country))
  cols.region.push(cell(region))
  cols.city.push(cell(city))
  cols.radius.push(cell(radius) === null ? null : Number(radius))
  // The table holds ASNs above 0; an AS number of 0 means none.
  cols.asn.push(cell(asn) === null || Number(asn) === 0 ? null : cell(asn))
  cols.organisation.push(cell(organisation))
  // A Postgres array literal per row; flags are fixed words (hosting, vpn, proxy).
  cols.flags.push(`{${(cell(flags) ?? '').split('|').filter(Boolean).join(',')}}`)
}

export const INSERT_RANGES_SQL = `insert into public.${IP_LOCATION_RANGES_TABLE}
  (database, database_edition, range_start, range_end, country, region, city, accuracy_radius_km, asn, organisation, flags)
select $1, $2::date, s::inet, e::inet, c, r, ci, ra, a::bigint, o, f::text[]
from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::text[], $10::text[], $11::text[])
  as t(s, e, c, r, ci, ra, a, o, f)`

interface Client {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
  end(): Promise<void>
}

export async function load(dir: string, client: Client): Promise<{ database: string; edition: string; ranges: number }> {
  const meta = JSON.parse(readFileSync(join(dir, 'ip-db.meta.json'), 'utf8')) as IpDbMeta
  if (!meta.name || !/^\d{4}-\d{2}-\d{2}$/.test(meta.edition)) throw new Error('ip-db.meta.json has no name or edition')
  const { name: database, edition } = meta
  await client.query('begin')
  try {
    // Loading the same copy again replaces it.
    await client.query(`delete from public.${IP_LOCATION_RANGES_TABLE} where database = $1 and database_edition = $2::date`, [database, edition])
    let n = 0
    let loaded = 0
    let cols = emptyColumns()
    const flush = async () => {
      if (!cols.start.length) return
      await client.query(INSERT_RANGES_SQL, [database, edition, cols.start, cols.end, cols.country, cols.region, cols.city, cols.radius, cols.asn, cols.organisation, cols.flags])
      loaded += cols.start.length
      cols = emptyColumns()
    }
    for await (const line of createInterface({ input: createReadStream(join(dir, 'ip-db.csv')), crlfDelay: Infinity })) {
      n++
      if (n === 1) {
        if (line.trim() !== NEUTRAL_HEADER.join(',')) throw new Error('ip-db.csv does not start with the neutral header')
        continue
      }
      if (!line.trim()) continue
      pushNeutralLine(cols, line, n)
      if (cols.start.length >= BATCH_SIZE) await flush()
    }
    await flush()
    if (loaded !== meta.ranges) throw new Error(`ip-db.csv holds ${loaded} ranges; the metadata says ${meta.ranges}`)
    // The new copy is now the latest edition, so the current one; older editions of this database go.
    await client.query(`delete from public.${IP_LOCATION_RANGES_TABLE} where database = $1 and database_edition < $2::date`, [database, edition])
    await client.query('commit')
    return { database, edition, ranges: loaded }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

function arg(args: string[], name: string): string | null {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

const invokedDirectly = process.argv[1] && /load-ip-db\.ts$/.test(process.argv[1].replace(/\\/g, '/'))
if (invokedDirectly) {
  ;(async () => {
    const args = process.argv.slice(2)
    const dir = arg(args, 'dir')
    if (!dir) throw new Error('--dir <dir written by build-ip-db> is required')
    const url = assertLocalDatabaseUrl(process.env.IP_DB_DATABASE_URL)
    const { default: pg } = await import('pg')
    const client = new pg.Client({ connectionString: url.toString() }) as unknown as Client & { connect(): Promise<void> }
    await client.connect()
    try {
      const result = await load(dir, client)
      console.log(`ip-db: loaded ${result.database} ${result.edition}: ${result.ranges} ranges (now the latest edition)`)
    } finally {
      await client.end()
    }
  })().catch((error) => {
    console.error(`ip-db: ${error instanceof Error ? error.message : 'failed'}`)
    process.exit(1)
  })
}
