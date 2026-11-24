import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createRangeDatabase,
  CURRENT_EDITION_SQL,
  DBIP_LITE,
  formatIp,
  formatIpv6,
  IP_LOCATION_FLAGGED_TEXT,
  IP_RANGE_LOOKUP_SQL,
  ipLocationAttribution,
  ipLocationFooterLines,
  ipLocationLine,
  ipLocationLines,
  ipLocationNote,
  ipsInAccessEvents,
  isNotPublic,
  lookupIpLocations,
  openCurrentSqlIpDatabase,
  parseIp,
  parseNeutralCsv,
  rangeRecordFromRow,
  toNeutralCsv,
} from '../../supabase/functions/_shared/ip-location/index.ts'
import type { AccessEvent, IpLocation } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { buildDbip, buildIpDb, isInside, main, run } from '../../scripts/ip-db/build-ip-db.ts'
import { dbipEditionFromFileName, dbipToNeutral, linesOfText } from '../../scripts/ip-db/dbip.ts'
import { assertLocalDatabaseUrl, load, pushNeutralLine } from '../../scripts/ip-db/load-ip-db.ts'
import { SYNTHETIC_IP_DATABASE, SYNTHETIC_IP_RANGES } from '../../scripts/ip-db/synthetic.ts'
import { FIDREC_UPDATE_CASES } from '../fixtures/fidrec-update/index.ts'

// FIDReC update, Lane 2 (brief v5, 3c): IP addresses looked up in a database loaded into our own environment, behind
// an interface so the provider Elena chooses plugs in later. Only the synthetic database is used here: documentation
// address ranges, documentation ASNs, "Example" names. No real IP database is downloaded or committed.

const db = () => createRangeDatabase(SYNTHETIC_IP_DATABASE, SYNTHETIC_IP_RANGES)

test('addresses are parsed as written, IPv4-mapped IPv6 is read as IPv4, nonsense is refused', () => {
  assert.deepEqual(parseIp('192.0.2.150'), { version: 4, value: BigInt(3221226134), text: '192.0.2.150' })
  assert.equal(parseIp('::ffff:198.51.100.7')?.text, '198.51.100.7')
  assert.equal(parseIp('2001:DB8::1')?.version, 6)
  assert.equal(parseIp('2001:db8:0:0:0:0:0:1')?.value, parseIp('2001:db8::1')?.value)
  for (const bad of ['', '192.0.2', '192.0.2.1.5', '300.0.2.1', '2001:db8::1::1', '2001:db8:zz::1', 'dev-ex-0002']) {
    assert.equal(parseIp(bad), null, bad)
  }
})

test('private, loopback and link-local addresses are never looked up; the documentation ranges are left to the database', () => {
  for (const ip of ['10.1.2.3', '192.168.0.10', '172.20.0.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fe80::1', 'fd00::5']) {
    assert.equal(isNotPublic(parseIp(ip)!), true, ip)
  }
  for (const ip of ['192.0.2.1', '198.51.100.7', '203.0.113.24', '2001:db8::1']) assert.equal(isNotPublic(parseIp(ip)!), false, ip)
})

test('the synthetic database gives each synthetic case the IP locations its fixture expects', async () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const access = (c.data.facts.access_events?.value ?? []) as AccessEvent[]
    const expected = c.data.ipLocations
    const stated = Object.fromEntries(expected.filter((l) => l.institutionStatedLocation).map((l) => [l.ip, l.institutionStatedLocation!]))
    const looked = await lookupIpLocations(ipsInAccessEvents(access), db(), stated)
    const byIp = (rows: readonly IpLocation[]) => [...rows].sort((a, b) => a.ip.localeCompare(b.ip))
    assert.deepEqual(byIp(looked), byIp(expected), c.id)
  }
})

test('an address the database does not hold, or a private one, still names the database and its edition', async () => {
  const [unknown, home] = await lookupIpLocations(['203.0.114.1', '192.168.1.20', '192.168.1.20', 'not an address'], db())
  for (const row of [unknown, home]) {
    assert.equal(row.country, null)
    assert.equal(row.asn, null)
    assert.deepEqual(row.flags, [])
    assert.equal(row.database, 'Example IP Database')
    assert.equal(row.databaseEdition, '2025-10-01')
  }
  assert.equal(home.ip, '192.168.1.20')
  assert.equal((await lookupIpLocations(['2001:db8::7'], db()))[0].asn, 64505)
})

test('the printed form follows the brief and says nothing about where a person was', async () => {
  const [broadband, vpn] = await lookupIpLocations(['198.51.100.40', '192.0.2.150'], db(), { '192.0.2.150': 'Exampleland' })
  assert.equal(
    ipLocationLine(broadband),
    'IP address 198.51.100.40 — according to Example IP Database, 2025-10-01: registered to Example Broadband (AS64503), location Example City, Example Region, Exampleland (accuracy about 20 km).',
  )
  assert.deepEqual(ipLocationLines(vpn), [
    'IP address 192.0.2.150 — according to Example IP Database, 2025-10-01: registered to Example VPN Service (AS64502).',
    IP_LOCATION_FLAGGED_TEXT,
    "The institution's record gives the location as Exampleland.",
  ])
  assert.match(ipLocationNote('2025-10-01'), /this lookup used a database dated 2025-10-01\.$/)
  for (const line of [...ipLocationLines(broadband), ...ipLocationLines(vpn), ipLocationNote('2025-10-01')]) {
    assert.doesNotMatch(line, /\b(?:was|were) (?:in|at)\b|\blogged in from\b|\bthe (?:scammer|fraudster)\b/i)
  }
})

test('a database with overlapping ranges, mixed versions or no edition date is refused', () => {
  const range = SYNTHETIC_IP_RANGES[0]
  assert.throws(() => createRangeDatabase(SYNTHETIC_IP_DATABASE, [range, { ...range, start: '192.0.2.10', end: '192.0.2.20' }]), /overlap/)
  assert.throws(() => createRangeDatabase(SYNTHETIC_IP_DATABASE, [{ ...range, end: '2001:db8::1' }]), /one address version/)
  assert.throws(() => createRangeDatabase(SYNTHETIC_IP_DATABASE, [{ ...range, start: '192.0.2.63', end: '192.0.2.0' }]), /ends before/)
  assert.throws(() => createRangeDatabase({ name: 'Example IP Database', edition: 'October 2025' }, [range]), /edition/)
})

test('the neutral format round-trips, quotes commas and refuses unknown flags or headers', () => {
  const tricky = [{ ...SYNTHETIC_IP_RANGES[2], organisation: 'Example Mobile, "Network"' }]
  assert.deepEqual(parseNeutralCsv(toNeutralCsv(tricky)), tricky)
  assert.deepEqual(parseNeutralCsv(toNeutralCsv(SYNTHETIC_IP_RANGES)), SYNTHETIC_IP_RANGES)
  assert.throws(() => parseNeutralCsv('ip,country\n192.0.2.1,Exampleland\n'), /first line/)
  assert.throws(() => parseNeutralCsv(toNeutralCsv([{ ...SYNTHETIC_IP_RANGES[0], flags: [] }]).replace(/,\n$/, ',tor\n')), /unknown flag/)
})

test('the build script writes our copy outside the repository only, with its name, edition and hash', () => {
  const repo = process.cwd()
  assert.equal(isInside(repo, join(repo, 'data', 'ip')), true)
  assert.throws(() => main(['--synthetic', '--out', join(repo, 'tmp-ip-db')], repo), /outside the repository/)
  assert.equal(existsSync(join(repo, 'tmp-ip-db')), false)

  const out = mkdtempSync(join(tmpdir(), 'gb-ip-db-'))
  try {
    const meta = main(['--synthetic', '--out', out], repo)
    assert.equal(meta.ranges, SYNTHETIC_IP_RANGES.length)
    assert.equal(meta.sha256, buildIpDb(SYNTHETIC_IP_RANGES, { ...SYNTHETIC_IP_DATABASE, format: 'synthetic' }).meta.sha256)
    assert.deepEqual(parseNeutralCsv(readFileSync(join(out, 'ip-db.csv'), 'utf8')), SYNTHETIC_IP_RANGES)
    // A neutral file from elsewhere, converted the same way.
    const input = join(out, 'input.csv')
    writeFileSync(input, toNeutralCsv(SYNTHETIC_IP_RANGES.slice(0, 2)))
    const second = mkdtempSync(join(tmpdir(), 'gb-ip-db-'))
    try {
      assert.equal(main(['--input', input, '--name', 'Example IP Database', '--edition', '2025-11-01', '--out', second], repo).ranges, 2)
      assert.throws(() => main(['--input', input, '--name', 'Example', '--edition', '2025-11-01', '--format', 'some-provider', '--out', second], repo), /unknown --format/)
    } finally {
      rmSync(second, { recursive: true, force: true })
    }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('the lookup never opens a network connection and never logs an address', () => {
  const dir = 'supabase/functions/_shared/ip-location'
  for (const file of readdirSync(dir)) {
    const source = readFileSync(join(dir, file), 'utf8')
    assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|WebSocket|Deno\.connect|node:https?|node:net|from "npm:/, `${file}: network access`)
    assert.doesNotMatch(source, /console\.|logger\./, `${file}: logging`)
  }
})

test('no IP database file is committed', () => {
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  const files = [...walk('scripts/ip-db'), ...walk('supabase/functions/_shared/ip-location')]
  for (const f of files) assert.match(f, /\.ts$/, `${f}: only code lives here`)
})

// ---- DB-IP Lite (review of 24 November, decision 10). Synthetic files in DB-IP's CSV layout: documentation ranges,
// documentation ASNs, "Example" names. No DB-IP data is committed.

const DBIP_CITY = [
  '192.0.2.0,192.0.2.127,AS,SG,"Example Region","Example City",1.3,103.8',
  '198.51.100.0,198.51.100.255,AS,ZZ,,,0,0',
  '2001:db8::,2001:db8::ffff,AS,SG,,"Example Town",1.3,103.8',
].join('\n')
const DBIP_ASN = [
  '192.0.2.64,192.0.2.255,64500,"Example Network, Ltd"',
  '2001:db8::8000,2001:db8::1:0,64501,Example IPv6 Network',
].join('\n')

test('IPv6 addresses are written in the short form', () => {
  for (const text of ['2001:db8::1', '::', '::1', '2001:db8::', '2001:db8:0:1:1:1:1:1', 'fe80::1:0:0:1', '2001:db8::1:0:0:1']) {
    assert.equal(formatIpv6(parseIp(text)!.value), text, text)
  }
  assert.equal(formatIp(4, parseIp('192.0.2.1')!.value), '192.0.2.1')
})

test('the DB-IP adapter combines the city and network files into ranges that do not overlap', async () => {
  const lines: string[] = []
  for await (const line of dbipToNeutral(linesOfText(DBIP_CITY), linesOfText(DBIP_ASN))) lines.push(line)
  const ranges = parseNeutralCsv(`${lines.join('\n')}\n`)
  assert.deepEqual(ranges.map((r) => [r.start, r.end, r.country, r.region, r.city, r.asn, r.organisation]), [
    ['192.0.2.0', '192.0.2.63', 'Singapore', 'Example Region', 'Example City', null, null],
    ['192.0.2.64', '192.0.2.127', 'Singapore', 'Example Region', 'Example City', 64500, 'Example Network, Ltd'],
    ['192.0.2.128', '192.0.2.255', null, null, null, 64500, 'Example Network, Ltd'],
    ['198.51.100.0', '198.51.100.255', null, null, null, null, null],
    ['2001:db8::', '2001:db8::7fff', 'Singapore', null, 'Example Town', null, null],
    ['2001:db8::8000', '2001:db8::ffff', 'Singapore', null, 'Example Town', 64501, 'Example IPv6 Network'],
    ['2001:db8::1:0', '2001:db8::1:0', null, null, null, 64501, 'Example IPv6 Network'],
  ])
  // No accuracy radius and no hosting or VPN flags in DB-IP Lite; latitude and longitude are dropped.
  assert.ok(ranges.every((r) => r.accuracyRadiusKm === null && r.flags.length === 0))
  assert.doesNotMatch(lines.join('\n'), /103\.8|1\.3,/)
  // The result loads as a database and answers lookups.
  const database = createRangeDatabase({ name: DBIP_LITE.databaseName, edition: '2026-11-01' }, ranges)
  const [found] = await lookupIpLocations(['192.0.2.70'], database)
  assert.equal(
    ipLocationLine(found),
    'IP address 192.0.2.70 — according to DB-IP Lite, 2026-11-01: registered to Example Network, Ltd (AS64500), location Example City, Example Region, Singapore.',
  )
})

test('the DB-IP adapter refuses files that are out of order or overlap', async () => {
  const drain = async (city: string, asn: string) => {
    for await (const _line of dbipToNeutral(linesOfText(city), linesOfText(asn))) {
      // read through
    }
  }
  await assert.rejects(drain('198.51.100.0,198.51.100.9,AS,SG,,,0,0\n192.0.2.0,192.0.2.9,AS,SG,,,0,0', ''), /not sorted or overlap/)
  await assert.rejects(drain('192.0.2.0,192.0.2.9,AS,SG,,,0,0\n192.0.2.5,192.0.2.20,AS,SG,,,0,0', ''), /not sorted or overlap/)
  await assert.rejects(drain('', '192.0.2.0,192.0.2.9,AS64500,Example'), /not a whole number/)
  assert.equal(dbipEditionFromFileName('dbip-city-lite-2026-11.csv.gz'), '2026-11-01')
  assert.equal(dbipEditionFromFileName('cities.csv'), null)
})

test('a DB-IP build writes our copy outside the repository, with the licence and the attribution', async () => {
  const repo = process.cwd()
  const dir = mkdtempSync(join(tmpdir(), 'gb-dbip-'))
  try {
    const city = join(dir, 'dbip-city-lite-2026-11.csv')
    const asn = join(dir, 'dbip-asn-lite-2026-11.csv')
    writeFileSync(city, `${DBIP_CITY}\n`)
    writeFileSync(asn, `${DBIP_ASN}\n`)
    await assert.rejects(buildDbip(['--city', city, '--asn', asn, '--out', join(repo, 'tmp-ip-db')], repo), /outside the repository/)
    const out = join(dir, 'build')
    const meta = await run(['--format', 'dbip', '--city', city, '--asn', asn, '--out', out], repo)
    assert.equal(meta.name, 'DB-IP Lite')
    assert.equal(meta.edition, '2026-11-01')
    assert.equal(meta.ranges, 7)
    assert.equal(meta.licence, 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)')
    assert.match(meta.attribution!, /^IP Geolocation by DB-IP \(https:\/\/db-ip\.com\)/)
    assert.deepEqual(meta.sources!.map((s) => s.file), ['dbip-city-lite-2026-11.csv', 'dbip-asn-lite-2026-11.csv'])
    assert.equal(parseNeutralCsv(readFileSync(join(out, 'ip-db.csv'), 'utf8')).length, 7)
    assert.throws(() => main(['--format', 'dbip', '--city', city, '--asn', asn, '--out', out], repo), /run\(\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a DB-IP build from files keeps every line of both files', async () => {
  // Regression: both files were opened before either was read, and lines of one could be lost (a short output under
  // load). The documentation blocks are too small for 4,096 addresses, so this uses the RFC 2544 benchmarking range
  // 198.18.0.0/15, also never routed: one city range and one ASN range per address.
  const dir = mkdtempSync(join(tmpdir(), 'gb-dbip-many-'))
  try {
    const ips = Array.from({ length: 4096 }, (_, i) => `198.18.${i >> 8}.${i & 255}`)
    const city = join(dir, 'dbip-city-lite-2026-11.csv')
    const asn = join(dir, 'dbip-asn-lite-2026-11.csv')
    writeFileSync(city, `${ips.map((ip) => `${ip},${ip},AS,SG,,"Example City",0,0`).join('\n')}\n`)
    writeFileSync(asn, `${ips.map((ip) => `${ip},${ip},64500,Example Network`).join('\n')}\n`)
    const out = join(dir, 'build')
    const meta = await run(['--format', 'dbip', '--city', city, '--asn', asn, '--out', out], process.cwd())
    assert.equal(meta.ranges, ips.length)
    const ranges = parseNeutralCsv(readFileSync(join(out, 'ip-db.csv'), 'utf8'))
    assert.ok(ranges.every((r) => r.city === 'Example City' && r.asn === 64500))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the attribution the licence asks for prints after the lookups, with each database date', async () => {
  const database = createRangeDatabase({ name: DBIP_LITE.databaseName, edition: '2026-11-01' }, SYNTHETIC_IP_RANGES)
  const locations = await lookupIpLocations(['203.0.113.24', '198.51.100.7'], database)
  // Each lookup keeps the database name and date it was made with.
  assert.ok(locations.every((l) => l.database === 'DB-IP Lite' && l.databaseEdition === '2026-11-01'))
  const footer = ipLocationFooterLines(locations)
  assert.equal(footer.length, 2)
  assert.equal(footer[0], ipLocationNote('2026-11-01'))
  assert.equal(footer[1], ipLocationAttribution('DB-IP Lite'))
  assert.match(footer[1], /IP Geolocation by DB-IP \(https:\/\/db-ip\.com\), licensed under CC BY 4\.0/)
  // The synthetic database has no provider, so no attribution line.
  assert.deepEqual(ipLocationFooterLines(await lookupIpLocations(['203.0.113.24'], db())), [ipLocationNote(SYNTHETIC_IP_DATABASE.edition)])
})

test('the Postgres lookup calls lookup_ip_location_v1 for the latest edition of the database', async () => {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = []
  const query = async (sql: string, params: readonly unknown[]) => {
    calls.push({ sql, params })
    if (sql === CURRENT_EDITION_SQL) return [{ edition: '2026-11-01' }]
    return params[0] === '192.0.2.70'
      ? [{ country: 'Singapore', region: null, city: 'Example City', accuracy_radius_km: null, asn: '64500', organisation: 'Example Network', flags: '{}' }]
      : []
  }
  const database = await openCurrentSqlIpDatabase('DB-IP Lite', query)
  assert.ok(database)
  assert.equal(database!.name, 'DB-IP Lite')
  const [found, missing] = await lookupIpLocations(['192.0.2.70', '198.51.100.7'], database!)
  assert.deepEqual([found.city, found.asn, found.flags, found.database, found.databaseEdition], ['Example City', 64500, [], 'DB-IP Lite', '2026-11-01'])
  assert.equal(missing.city, null)
  assert.deepEqual(calls[0].params, ['DB-IP Lite'])
  assert.deepEqual(calls.slice(1).map((c) => c.params), [['192.0.2.70', 'DB-IP Lite', '2026-11-01'], ['198.51.100.7', 'DB-IP Lite', '2026-11-01']])
  assert.match(IP_RANGE_LOOKUP_SQL, /public\.lookup_ip_location_v1\(\$1::inet, \$2, \$3::date\)/)
  assert.match(CURRENT_EDITION_SQL, /max\(database_edition\)/)
  assert.equal(await openCurrentSqlIpDatabase('DB-IP Lite', async () => [{ edition: null }]), null)
  assert.equal(await openCurrentSqlIpDatabase('DB-IP Lite', async () => []), null)
  assert.deepEqual(rangeRecordFromRow({ flags: ['vpn', 'tor'] }).flags, ['vpn'])
})

test('the loader refuses any database but a local one, and the shared port 54322', () => {
  assert.throws(() => assertLocalDatabaseUrl(undefined), /not set/)
  assert.throws(() => assertLocalDatabaseUrl('postgres://u:p@db.example.com:5432/postgres'), /local databases only/)
  assert.throws(() => assertLocalDatabaseUrl('postgres://u:p@127.0.0.1:54322/postgres'), /54322/)
  assert.throws(() => assertLocalDatabaseUrl('postgres://u:p@127.0.0.1/postgres'), /port/)
  assert.throws(() => assertLocalDatabaseUrl('https://127.0.0.1:55820/'), /postgres URL/)
  assert.equal(assertLocalDatabaseUrl('postgres://u:p@127.0.0.1:55820/postgres').port, '55820')
})

test('the loader writes the columns of Lane 1\'s table; an AS number of 0 is none', () => {
  const cols = { start: [], end: [], country: [], region: [], city: [], radius: [], asn: [], organisation: [], flags: [] }
  pushNeutralLine(cols, '198.18.0.0,198.18.0.255,Singapore,,Example City,,0,,hosting|vpn', 2)
  pushNeutralLine(cols, '198.18.1.0,198.18.1.255,,,,,64500,"Example Network, Ltd",', 3)
  assert.deepEqual(cols.asn, [null, '64500'])
  assert.deepEqual(cols.flags, ['{hosting,vpn}', '{}'])
  assert.deepEqual(cols.organisation, [null, 'Example Network, Ltd'])
  assert.throws(() => pushNeutralLine(cols, '198.18.2.0,198.18.2.255', 4), /expected 9 fields/)
})

// Runs only against a lane's own local database with the repo's migrations applied (Lane 1's ip_location_ranges and
// lookup_ip_location_v1): IP_DB_TEST_DATABASE_URL=postgres://…@127.0.0.1:<558xx>/postgres. Skipped otherwise. It uses its
// own database name and removes its rows afterwards. Addresses from 198.18.0.0/15 (RFC 2544 benchmarking, never routed).
test('load and look up against the real migrations on a local Postgres', { skip: !process.env.IP_DB_TEST_DATABASE_URL }, async () => {
  const url = assertLocalDatabaseUrl(process.env.IP_DB_TEST_DATABASE_URL)
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: url.toString() })
  await client.connect()
  const name = 'Example Benchmark IP Database'
  const dir = mkdtempSync(join(tmpdir(), 'gb-ip-load-'))
  const csv = (org: string) => [
    'start,end,country,region,city,accuracy_radius_km,asn,organisation,flags',
    `198.18.0.0,198.18.0.255,Exampleland,Example Region,Example City,50,64500,${org},hosting`,
    '198.18.2.0,198.18.2.255,Exampleland,,,,0,,',
    '2001:db8::,2001:db8::ffff,Exampleland,,Example Town,,64501,Example IPv6 Network,',
  ].join('\n') + '\n'
  try {
    const query = async (sql: string, params: readonly unknown[]) => (await client.query(sql, params as unknown[])).rows
    for (const [edition, org] of [['2026-10-01', 'Example Old Network'], ['2026-11-01', 'Example Network']]) {
      const input = join(dir, `${edition}.csv`)
      writeFileSync(input, csv(org))
      const out = join(dir, edition)
      main(['--input', input, '--name', name, '--edition', edition, '--out', out], process.cwd())
      assert.deepEqual(await load(out, client as never), { database: name, edition, ranges: 3 })
    }
    // Loading the same copy again replaces it rather than failing on the unique key.
    assert.equal((await load(join(dir, '2026-11-01'), client as never)).ranges, 3)
    // The latest edition is current; the older one is gone.
    const editions = await query('select distinct database_edition::text as e from public.ip_location_ranges where database = $1', [name])
    assert.deepEqual(editions.map((r) => r.e), ['2026-11-01'])
    const database = (await openCurrentSqlIpDatabase(name, query))!
    assert.equal(database.edition, '2026-11-01')
    const found = await lookupIpLocations(['198.18.0.77', '198.18.2.1', '198.18.1.1', '2001:db8::1'], database)
    assert.deepEqual(found.map((l) => [l.organisation, l.asn, l.city]), [
      ['Example Network', 64500, 'Example City'],
      [null, null, null],
      [null, null, null],
      ['Example IPv6 Network', 64501, 'Example Town'],
    ])
    assert.deepEqual(found[0].flags, ['hosting'])
    assert.equal(found[0].accuracyRadiusKm, 50)
    assert.equal(found[1].country, 'Exampleland')
    assert.ok(found.every((l) => l.database === name && l.databaseEdition === '2026-11-01'))
  } finally {
    await client.query('delete from public.ip_location_ranges where database = $1', [name])
    rmSync(dir, { recursive: true, force: true })
    await client.end()
  }
})
