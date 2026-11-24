// The IP location database loaded into our own Postgres (brief v5, 3c; review of 24 November, decision 10).
//
// The tables are requested from Lane 1 (a migration in supabase/migrations). Until it lands this code is written
// against the requested shape, which LOCAL_TABLES_SQL in scripts/ip-db/load-ip-db.ts creates in a lane's own local database only:
//
//   ip_location_editions  one row per loaded copy: edition_id, database_name, edition (date), provider, licence,
//                         attribution, sha256, range_count, loaded_at, is_current (at most one row true)
//   ip_location_ranges    edition_id -> ip_location_editions ON DELETE CASCADE, range_start inet, range_end inet,
//                         country, region, city, accuracy_radius_km, asn, organisation, flags text[];
//                         primary key (edition_id, range_start)
//
// Driver-neutral: the caller passes a query function (pg in Node, a Postgres client in Deno). Nothing here opens a
// network connection to a third party, and no address is logged.

import { IP_NETWORK_FLAGS, type IpNetworkFlag, type IsoDate } from "../facts/update/contract.ts";
import type { ParsedIp } from "./ip.ts";
import type { IpLocationDatabase, IpRangeRecord } from "./range-database.ts";

export const IP_LOCATION_TABLES = { editions: "ip_location_editions", ranges: "ip_location_ranges" } as const;

export type SqlQuery = (sql: string, params: readonly unknown[]) => Promise<ReadonlyArray<Record<string, unknown>>>;

export interface IpDatabaseEdition {
  editionId: string;
  name: string;
  edition: IsoDate;
}

// The range that starts at or before the address, of the same family; it holds the address if it ends at or after it.
// The primary key (edition_id, range_start) serves the descending scan.
export const IP_RANGE_LOOKUP_SQL = `select country, region, city, accuracy_radius_km, asn, organisation, flags
from (
  select * from public.${IP_LOCATION_TABLES.ranges}
  where edition_id = $1 and range_start <= $2::inet and family(range_start) = family($2::inet)
  order by range_start desc
  limit 1
) r
where r.range_end >= $2::inet`;

export const CURRENT_EDITION_SQL = `select edition_id, database_name, edition::text as edition
from public.${IP_LOCATION_TABLES.editions} where is_current limit 1`;

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

/** A lookup against one loaded edition. */
export function createSqlIpDatabase(edition: IpDatabaseEdition, query: SqlQuery): IpLocationDatabase {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(edition.edition)) throw new Error("ip database: the edition must be a date, YYYY-MM-DD");
  return {
    name: edition.name,
    edition: edition.edition,
    async lookup(ip: ParsedIp) {
      const rows = await query(IP_RANGE_LOOKUP_SQL, [edition.editionId, ip.text]);
      return rows.length ? rangeRecordFromRow(rows[0]) : null;
    },
  };
}

/** The edition marked current, or null when none is loaded (then the pack prints no lookup). */
export async function openCurrentSqlIpDatabase(query: SqlQuery): Promise<IpLocationDatabase | null> {
  const rows = await query(CURRENT_EDITION_SQL, []);
  const row = rows[0];
  if (!row || !text(row.edition_id) || !text(row.database_name) || !text(row.edition)) return null;
  return createSqlIpDatabase(
    { editionId: String(row.edition_id), name: String(row.database_name), edition: String(row.edition).slice(0, 10) },
    query,
  );
}
