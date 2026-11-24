// DB-IP Lite adapter (review of 24 November, decision 10). Reads DB-IP's "IP to City Lite" and "IP to ASN Lite" CSV
// downloads (plain or .gz) and writes one neutral CSV (see range-database.ts), combining the two files' ranges.
//
// Licence (https://db-ip.com/db/lite.php, read 24 November 2026): CC BY 4.0; commercial use allowed with attribution;
// link "IP Geolocation by DB-IP" to https://db-ip.com where results are shown; updated monthly. Our combining and
// conversion is a change CC BY 4.0 asks us to indicate: see DBIP_LITE.changes in providers.ts.
//
// Formats (https://db-ip.com/db/format/ip-to-city-lite/csv.html), no header line, sorted by address:
//   city: ip_start,ip_end,continent,country,stateprov,city,latitude,longitude
//   asn:  ip_start,ip_end,as_number,as_organization
// Latitude and longitude are dropped: the pack prints a city and a country, never a point on a map.
//
// The files are large (millions of lines), so both are streamed and merged in one pass; nothing is held in memory but
// the current line of each. No address is printed.

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { formatIp, parseIp } from '../../supabase/functions/_shared/ip-location/ip.ts'
import { NEUTRAL_HEADER, splitCsvLine } from '../../supabase/functions/_shared/ip-location/range-database.ts'

export interface DbipCity {
  country: string | null
  region: string | null
  city: string | null
}

export interface DbipAsn {
  asn: number | null
  organisation: string | null
}

interface Row<T> {
  /** Ordering key: IPv4 first, then IPv6. */
  start: bigint
  end: bigint
  version: 4 | 6
  data: T
}

const V6_OFFSET = BigInt(1) << BigInt(129)

const blank = (v: string | undefined) => (v === undefined || v.trim() === '' ? null : v.trim())

let regionNames: Intl.DisplayNames | null = null
/** "SG" -> "Singapore". DB-IP's Lite city file holds the ISO code only; "ZZ" (unknown) is null. */
export function countryName(code: string | null): string | null {
  if (!code || !/^[A-Z]{2}$/.test(code) || code === 'ZZ') return null
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

/** One DB-IP line as a range, or null for a line we skip (an IPv4-mapped IPv6 range: the lookup reads those as IPv4). */
function rangeOf<T>(cells: string[], data: T, line: number, file: string): Row<T> | null {
  const start = parseIp(cells[0] ?? '')
  const end = parseIp(cells[1] ?? '')
  if (!start || !end) throw new Error(`${file} line ${line}: not an address range`)
  const mapped = (cells[0].includes(':') && start.version === 4) || (cells[1].includes(':') && end.version === 4)
  if (mapped) return null
  if (start.version !== end.version || end.value < start.value) throw new Error(`${file} line ${line}: not a range of one address version`)
  const offset = start.version === 6 ? V6_OFFSET : BigInt(0)
  return { start: start.value + offset, end: end.value + offset, version: start.version, data }
}

export function parseDbipCityLine(line: string, n: number): Row<DbipCity> | null {
  const cells = splitCsvLine(line)
  if (cells.length < 6) throw new Error(`city line ${n}: expected at least 6 fields`)
  return rangeOf(cells, { country: countryName(blank(cells[3])), region: blank(cells[4]), city: blank(cells[5]) }, n, 'city')
}

export function parseDbipAsnLine(line: string, n: number): Row<DbipAsn> | null {
  const cells = splitCsvLine(line)
  if (cells.length < 4) throw new Error(`asn line ${n}: expected 4 fields`)
  const asn = blank(cells[2])
  if (asn !== null && !/^\d+$/.test(asn)) throw new Error(`asn line ${n}: as_number is not a whole number`)
  return rangeOf(cells, { asn: asn === null ? null : Number(asn), organisation: blank(cells[3]) }, n, 'asn')
}

/** Lines of a sorted, non-overlapping file, as ranges; throws if the order breaks. */
async function* rows<T>(lines: AsyncIterable<string>, parse: (line: string, n: number) => Row<T> | null, file: string): AsyncGenerator<Row<T>> {
  let n = 0
  let last: bigint | null = null
  for await (const raw of lines) {
    n++
    const line = raw.replace(/^﻿/, '')
    if (!line.trim()) continue
    const row = parse(line, n)
    if (!row) continue
    if (last !== null && row.start <= last) throw new Error(`${file} line ${n}: ranges are not sorted or overlap`)
    last = row.end
    yield row
  }
}

export interface MergedRange {
  version: 4 | 6
  start: bigint
  end: bigint
  city: DbipCity | null
  asn: DbipAsn | null
}

/**
 * Merges the two sorted range lists into the ranges where what the database says is constant: each output range has
 * the city line and the ASN line covering it, either of which may be absent. Gaps in both are not output.
 */
export async function* mergeDbip(city: AsyncIterable<Row<DbipCity>>, asn: AsyncIterable<Row<DbipAsn>>): AsyncGenerator<MergedRange> {
  const ci = city[Symbol.asyncIterator]()
  const ai = asn[Symbol.asyncIterator]()
  let c = (await ci.next()).value as Row<DbipCity> | undefined
  let a = (await ai.next()).value as Row<DbipAsn> | undefined
  const one = BigInt(1)
  let p: bigint | null = null
  while (c || a) {
    if (p === null) p = c && a ? (c.start < a.start ? c.start : a.start) : (c ?? a)!.start
    const coverC = Boolean(c && c.start <= p)
    const coverA = Boolean(a && a.start <= p)
    if (!coverC && !coverA) {
      p = c && a ? (c.start < a.start ? c.start : a.start) : (c ?? a)!.start
      continue
    }
    let end: bigint | null = null
    const limit = (v: bigint) => { if (end === null || v < end) end = v }
    if (c) limit(coverC ? c.end : c.start - one)
    if (a) limit(coverA ? a.end : a.start - one)
    const version = (coverC ? c! : a!).version
    const offset = version === 6 ? V6_OFFSET : BigInt(0)
    yield { version, start: p - offset, end: end! - offset, city: coverC ? c!.data : null, asn: coverA ? a!.data : null }
    p = end! + one
    if (c && c.end < p) c = (await ci.next()).value as Row<DbipCity> | undefined
    if (a && a.end < p) a = (await ai.next()).value as Row<DbipAsn> | undefined
  }
}

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function neutralLine(r: MergedRange): string {
  return [
    formatIp(r.version, r.start),
    formatIp(r.version, r.end),
    r.city?.country ?? null,
    r.city?.region ?? null,
    r.city?.city ?? null,
    null, // DB-IP Lite gives no accuracy radius
    r.asn?.asn ?? null,
    r.asn?.organisation ?? null,
    null, // nor hosting or VPN flags
  ].map(csvCell).join(',')
}

// The file is opened only when the first line is asked for, and read through the interface's own iterator from the
// start. Opening both files up front let one interface emit lines before anything read them, and those lines were
// lost (seen as a short output under load).
export async function* linesOf(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path)
  const input = /\.gz$/i.test(path) ? stream.pipe(createGunzip()) : stream
  yield* createInterface({ input, crlfDelay: Infinity })
}

export function linesOfText(text: string): AsyncIterable<string> {
  return (async function* () {
    for (const line of text.split(/\r?\n/)) yield line
  })()
}

/** Converts the two DB-IP files into neutral CSV lines (header first). */
export async function* dbipToNeutral(cityLines: AsyncIterable<string>, asnLines: AsyncIterable<string>): AsyncGenerator<string> {
  yield NEUTRAL_HEADER.join(',')
  for await (const r of mergeDbip(rows(cityLines, parseDbipCityLine, 'city'), rows(asnLines, parseDbipAsnLine, 'asn'))) {
    yield neutralLine(r)
  }
}

/** The edition date DB-IP puts in its file names: dbip-city-lite-2026-11.csv.gz -> 2026-11-01. */
export function dbipEditionFromFileName(path: string): string | null {
  const m = /dbip-(?:city|asn)-lite-(\d{4})-(\d{2})\.(?:csv|mmdb)/i.exec(path)
  return m ? `${m[1]}-${m[2]}-01` : null
}

/** Streams the conversion to a file; returns the number of ranges and the sha256 of what was written. */
export async function writeDbipNeutral(cityPath: string, asnPath: string, outPath: string): Promise<{ ranges: number; sha256: string }> {
  const out = createWriteStream(outPath)
  const hash = createHash('sha256')
  let lines = 0
  for await (const line of dbipToNeutral(linesOf(cityPath), linesOf(asnPath))) {
    const chunk = `${line}\n`
    hash.update(chunk)
    if (!out.write(chunk)) await once(out, 'drain')
    lines++
  }
  out.end()
  await once(out, 'finish')
  return { ranges: lines - 1, sha256: hash.digest('hex') }
}
