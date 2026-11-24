import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createRangeDatabase,
  IP_LOCATION_FLAGGED_TEXT,
  ipLocationLine,
  ipLocationLines,
  ipLocationNote,
  ipsInAccessEvents,
  isNotPublic,
  lookupIpLocations,
  parseIp,
  parseNeutralCsv,
  toNeutralCsv,
} from '../../supabase/functions/_shared/ip-location/index.ts'
import type { AccessEvent, IpLocation } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { buildIpDb, isInside, main } from '../../scripts/ip-db/build-ip-db.ts'
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
