// An IP location database held as address ranges, loaded from our own copy of a provider's file (brief v5, 3c).
// The provider is not chosen yet (Elena decides from the shortlist in the Lane 2 pull request), so every provider's
// download is first converted to the neutral format below by scripts/ip-db; this file never reads a provider format.
//
// Neutral format: CSV with a header line, one range per line, ranges not overlapping:
//   start,end,country,region,city,accuracy_radius_km,asn,organisation,flags
// start and end are addresses of the same version (inclusive). flags is "|"-separated: hosting, vpn, proxy.
// Empty cells are null. Fields containing commas are quoted with "".

import { IP_NETWORK_FLAGS, type IpNetworkFlag, type IsoDate } from "../facts/update/contract.ts";
import { type ParsedIp, parseIp } from "./ip.ts";

/** What the database says about one range. */
export interface IpRangeRecord {
  country: string | null;
  region: string | null;
  city: string | null;
  accuracyRadiusKm: number | null;
  asn: number | null;
  organisation: string | null;
  flags: IpNetworkFlag[];
}

export interface IpRange extends IpRangeRecord {
  start: string;
  end: string;
}

/**
 * The lookup interface the pack code uses. A database-backed implementation (ranges in a Postgres table, queried by
 * address) plugs in here once the provider is chosen; tests use the in-memory one.
 */
export interface IpLocationDatabase {
  /** The provider's database name as it is printed, for example "Example IP Database". */
  readonly name: string;
  /** The edition date printed beside every lookup. */
  readonly edition: IsoDate;
  lookup(ip: ParsedIp): Promise<IpRangeRecord | null>;
}

export const NEUTRAL_HEADER = ["start", "end", "country", "region", "city", "accuracy_radius_km", "asn", "organisation", "flags"] as const;

interface LoadedRange extends IpRangeRecord {
  version: 4 | 6;
  start: bigint;
  end: bigint;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

const empty = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : v.trim());

function integer(v: string | undefined, line: number, field: string): number | null {
  const text = empty(v);
  if (text === null) return null;
  if (!/^\d+$/.test(text)) throw new Error(`ip database line ${line}: ${field} is not a whole number`);
  return Number(text);
}

/** Reads the neutral CSV. Throws on a malformed line, a range that ends before it starts, or overlapping ranges. */
export function parseNeutralCsv(text: string): IpRange[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length || splitCsvLine(lines[0]).join(",") !== NEUTRAL_HEADER.join(",")) {
    throw new Error(`ip database: the first line must be ${NEUTRAL_HEADER.join(",")}`);
  }
  return lines.slice(1).map((line, i) => {
    const n = i + 2;
    const cells = splitCsvLine(line);
    if (cells.length !== NEUTRAL_HEADER.length) throw new Error(`ip database line ${n}: expected ${NEUTRAL_HEADER.length} fields`);
    const [start, end, country, region, city, radius, asn, organisation, flags] = cells;
    const flagList = (empty(flags) ?? "").split("|").filter(Boolean);
    if (!flagList.every((f) => (IP_NETWORK_FLAGS as readonly string[]).includes(f))) throw new Error(`ip database line ${n}: unknown flag`);
    return {
      start: start.trim(),
      end: end.trim(),
      country: empty(country),
      region: empty(region),
      city: empty(city),
      accuracyRadiusKm: integer(radius, n, "accuracy_radius_km"),
      asn: integer(asn, n, "asn"),
      organisation: empty(organisation),
      flags: [...new Set(flagList)] as IpNetworkFlag[],
    };
  });
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toNeutralCsv(ranges: readonly IpRange[]): string {
  const rows = ranges.map((r) =>
    [r.start, r.end, r.country, r.region, r.city, r.accuracyRadiusKm, r.asn, r.organisation, r.flags.join("|") || null].map(csvCell).join(",")
  );
  return [NEUTRAL_HEADER.join(","), ...rows].join("\n") + "\n";
}

function load(ranges: readonly IpRange[]): LoadedRange[] {
  const loaded = ranges.map((r, i) => {
    const start = parseIp(r.start);
    const end = parseIp(r.end);
    if (!start || !end || start.version !== end.version) throw new Error(`ip database range ${i + 1}: not a range of one address version`);
    if (end.value < start.value) throw new Error(`ip database range ${i + 1}: ends before it starts`);
    const { start: _s, end: _e, ...record } = r;
    return { ...record, version: start.version, start: start.value, end: end.value };
  });
  loaded.sort((a, b) => (a.version !== b.version ? a.version - b.version : a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  for (let i = 1; i < loaded.length; i++) {
    const prev = loaded[i - 1];
    if (prev.version === loaded[i].version && loaded[i].start <= prev.end) throw new Error("ip database: ranges overlap");
  }
  return loaded;
}

/** An in-memory database: binary search over sorted, non-overlapping ranges. */
export function createRangeDatabase(meta: { name: string; edition: IsoDate }, ranges: readonly IpRange[]): IpLocationDatabase {
  if (!meta.name.trim()) throw new Error("ip database: a name is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.edition)) throw new Error("ip database: the edition must be a date, YYYY-MM-DD");
  const loaded = load(ranges);
  return {
    name: meta.name,
    edition: meta.edition,
    lookup(ip) {
      let lo = 0;
      let hi = loaded.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = loaded[mid];
        const before = ip.version < r.version || (ip.version === r.version && ip.value < r.start);
        const after = ip.version > r.version || (ip.version === r.version && ip.value > r.end);
        if (before) hi = mid - 1;
        else if (after) lo = mid + 1;
        else {
          const { version: _v, start: _s, end: _e, ...record } = r;
          return Promise.resolve({ ...record, flags: [...record.flags] });
        }
      }
      return Promise.resolve(null);
    },
  };
}
