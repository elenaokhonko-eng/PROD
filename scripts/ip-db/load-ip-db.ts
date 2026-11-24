// Loads a copy written by build-ip-db.ts (ip-db.csv + ip-db.meta.json) into Postgres, marks it the current edition and
// removes older editions (each pack keeps its own lookup results and the database date, so old ranges are not needed).
//
//   IP_DB_DATABASE_URL=postgres://…@127.0.0.1:<558xx>/postgres \
//   npx tsx scripts/ip-db/load-ip-db.ts --dir <dir written by build-ip-db> [--create-local-tables]
//
// LOCAL DATABASES ONLY from this script: it refuses any host but this machine and the shared Supabase port 54322.
// Loading a hosted database is a release step for Elena, not something this script does. The connection string is
// read from the environment and never printed; no address is printed either.

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { IP_LOCATION_TABLES } from '../../supabase/functions/_shared/ip-location/sql-database.ts'
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

// LOCAL USE ONLY, applied with --create-local-tables. Not a migration: the real tables come from Lane 1's migration in
// supabase/migrations. This is the shape Lane 2 requested, so the import and the lookup can be built and tested against a
// lane's own local database before that migration lands (see sql-database.ts).
export const LOCAL_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS public.ip_location_editions (
  edition_id text PRIMARY KEY,
  database_name text NOT NULL,
  edition date NOT NULL,
  provider text NOT NULL,
  licence text NOT NULL,
  attribution text NOT NULL,
  sha256 text NOT NULL,
  range_count integer NOT NULL CHECK (range_count >= 0),
  loaded_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS ip_location_editions_one_current
  ON public.ip_location_editions (is_current) WHERE is_current;

CREATE TABLE IF NOT EXISTS public.ip_location_ranges (
  edition_id text NOT NULL REFERENCES public.ip_location_editions(edition_id) ON DELETE CASCADE,
  range_start inet NOT NULL,
  range_end inet NOT NULL,
  country text,
  region text,
  city text,
  accuracy_radius_km integer,
  asn bigint,
  organisation text,
  flags text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (edition_id, range_start),
  CHECK (family(range_start) = family(range_end) AND range_start <= range_end)
);

ALTER TABLE public.ip_location_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_location_ranges ENABLE ROW LEVEL SECURITY;
`

export function editionIdOf(meta: IpDbMeta): string {
  return `${meta.provider ?? meta.format}:${meta.edition}`
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
  cols.asn.push(cell(asn))
  cols.organisation.push(cell(organisation))
  // A Postgres array literal per row; flags are fixed words (hosting, vpn, proxy).
  cols.flags.push(`{${(cell(flags) ?? '').split('|').filter(Boolean).join(',')}}`)
}

export const INSERT_RANGES_SQL = `insert into public.${IP_LOCATION_TABLES.ranges}
  (edition_id, range_start, range_end, country, region, city, accuracy_radius_km, asn, organisation, flags)
select $1, s::inet, e::inet, c, r, ci, ra, a::bigint, o, f::text[]
from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[], $9::text[], $10::text[])
  as t(s, e, c, r, ci, ra, a, o, f)`

interface Client {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
  end(): Promise<void>
}

export async function load(dir: string, client: Client, options: { createLocalTables?: boolean } = {}): Promise<{ editionId: string; ranges: number }> {
  const meta = JSON.parse(readFileSync(join(dir, 'ip-db.meta.json'), 'utf8')) as IpDbMeta
  if (!meta.name || !/^\d{4}-\d{2}-\d{2}$/.test(meta.edition)) throw new Error('ip-db.meta.json has no name or edition')
  const editionId = editionIdOf(meta)
  if (options.createLocalTables) {
    await client.query(LOCAL_TABLES_SQL)
  }
  await client.query('begin')
  try {
    await client.query(`delete from public.${IP_LOCATION_TABLES.editions} where edition_id = $1`, [editionId])
    await client.query(
      `insert into public.${IP_LOCATION_TABLES.editions}
        (edition_id, database_name, edition, provider, licence, attribution, sha256, range_count, is_current)
       values ($1, $2, $3::date, $4, $5, $6, $7, $8, false)`,
      [editionId, meta.name, meta.edition, meta.provider ?? meta.format, meta.licence ?? 'synthetic', meta.attribution ?? '', meta.sha256, meta.ranges],
    )
    let n = 0
    let loaded = 0
    let cols = emptyColumns()
    const flush = async () => {
      if (!cols.start.length) return
      await client.query(INSERT_RANGES_SQL, [editionId, cols.start, cols.end, cols.country, cols.region, cols.city, cols.radius, cols.asn, cols.organisation, cols.flags])
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
    await client.query(`update public.${IP_LOCATION_TABLES.editions} set is_current = false where is_current`)
    await client.query(`update public.${IP_LOCATION_TABLES.editions} set is_current = true where edition_id = $1`, [editionId])
    await client.query(`delete from public.${IP_LOCATION_TABLES.editions} where edition_id <> $1`, [editionId])
    await client.query('commit')
    return { editionId, ranges: loaded }
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
      const result = await load(dir, client, { createLocalTables: args.includes('--create-local-tables') })
      console.log(`ip-db: loaded ${result.editionId}: ${result.ranges} ranges (now current)`)
    } finally {
      await client.end()
    }
  })().catch((error) => {
    console.error(`ip-db: ${error instanceof Error ? error.message : 'failed'}`)
    process.exit(1)
  })
}
