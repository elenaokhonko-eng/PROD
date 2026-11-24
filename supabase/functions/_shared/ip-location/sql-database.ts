// The IP location database loaded into our own Postgres (brief v5, 3c; review of 24 November, decision 10), in the
// shape of Lane 1's migration 20261204120200_case_ip_locations.sql:
//
//   ip_location_ranges    one row per range: database, database_edition (date), range_start inet, range_end inet,
//                         country, region, city, accuracy_radius_km, asn, organisation, flags text[];
//                         unique (database, database_edition, range_start)
//   lookup_ip_location_v1(p_ip inet, p_database text, p_database_edition date)
//                         the range that holds the address in that copy, or no row
//
// The current edition of a database is its latest database_edition. Each lookup keeps the database name and the
// edition it used (IpLocation.database, IpLocation.databaseEdition).
//
// Driver-neutral: the caller passes a query function (pg in Node, a Postgres client in Deno). Nothing here opens a
// network connection to a third party, and no address is logged.

import { IP_NETWORK_FLAGS, type IpNetworkFlag, type IsoDate } from "../facts/update/contract.ts";
import type { ParsedIp } from "./ip.ts";
import type { IpLocationDatabase, IpRangeRecord } from "./range-database.ts";

export const IP_LOCATION_RANGES_TABLE = "ip_location_ranges";
export const IP_LOCATION_LOOKUP_FUNCTION = "lookup_ip_location_v1";

export type SqlQuery = (sql: string, params: readonly unknown[]) => Promise<ReadonlyArray<Record<string, unknown>>>;

export interface IpDatabaseEdition {
  name: string;
  edition: IsoDate;
}

export const IP_RANGE_LOOKUP_SQL =
  `select country, region, city, accuracy_radius_km, asn, organisation, flags from public.${IP_LOCATION_LOOKUP_FUNCTION}($1::inet, $2, $3::date)`;

export const CURRENT_EDITION_SQL =
  `select max(database_edition)::text as edition from public.${IP_LOCATION_RANGES_TABLE} where database = $1`;

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const whole = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isSafeInteger(Number(v)) ? Number(v) : null);

function flagsOf(v: unknown): IpNetworkFlag[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.replace(/^\{|\}$/g, "").split(",").filter(Boolean) : [];
  return list.filter((f): f is IpNetworkFlag => (IP_NETWORK_FLAGS as readonly string[]).includes(String(f)));
}

export function rangeRecordFromRow(row: Record<string, unknown>): IpRangeRecord {
  return {
    country: text(row.country),
    region: text(row.region),
    city: text(row.city),
    accuracyRadiusKm: whole(row.accuracy_radius_km),
    asn: whole(row.asn),
    organisation: text(row.organisation),
    flags: flagsOf(row.flags),
  };
}

/** A lookup against one loaded copy (database and edition). */
export function createSqlIpDatabase(edition: IpDatabaseEdition, query: SqlQuery): IpLocationDatabase {
  if (!edition.name.trim()) throw new Error("ip database: a name is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(edition.edition)) throw new Error("ip database: the edition must be a date, YYYY-MM-DD");
  return {
    name: edition.name,
    edition: edition.edition,
    async lookup(ip: ParsedIp) {
      const rows = await query(IP_RANGE_LOOKUP_SQL, [ip.text, edition.name, edition.edition]);
      return rows.length ? rangeRecordFromRow(rows[0]) : null;
    },
  };
}

/** The latest edition loaded for the database, or null when none is (then the pack prints no lookup). */
export async function openCurrentSqlIpDatabase(databaseName: string, query: SqlQuery): Promise<IpLocationDatabase | null> {
  const rows = await query(CURRENT_EDITION_SQL, [databaseName]);
  const edition = text(rows[0]?.edition);
  return edition ? createSqlIpDatabase({ name: databaseName, edition: edition.slice(0, 10) }, query) : null;
}
