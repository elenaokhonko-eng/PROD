// IP location lookup for the FIDReC pack (brief v5, 3c). Every address is looked up in a database loaded into our own
// environment; nothing here opens a network connection, so an address is never sent to a third party. Addresses are
// personal data and may be a third party's (3e): this module never logs them.

import type { AccessEvent, IpLocation } from "../facts/update/contract.ts";
import { isNotPublic, parseIp } from "./ip.ts";
import type { IpLocationDatabase } from "./range-database.ts";
import { ipLocationAttribution } from "./providers.ts";

/** The distinct IP addresses in the institution's access record, in the order first seen. */
export function ipsInAccessEvents(events: readonly AccessEvent[]): string[] {
  const seen = new Map<string, string>();
  for (const e of events) {
    const ip = e.ip ? parseIp(e.ip) : null;
    if (ip && !seen.has(ip.text)) seen.set(ip.text, e.ip!.trim());
  }
  return [...seen.keys()];
}

/**
 * Looks each address up. An address the database does not hold, or one no outside database can place (a private
 * network), gets a row with no location, still naming the database and its edition. An address the institution's
 * record gives a location for keeps that location beside the lookup (`institutionStatedLocation`).
 */
export async function lookupIpLocations(
  ips: readonly string[],
  database: IpLocationDatabase,
  institutionStated: Readonly<Record<string, string>> = {},
): Promise<IpLocation[]> {
  const out: IpLocation[] = [];
  const done = new Set<string>();
  for (const raw of ips) {
    const ip = parseIp(raw);
    if (!ip || done.has(ip.text)) continue;
    done.add(ip.text);
    const record = isNotPublic(ip) ? null : await database.lookup(ip);
    out.push({
      ip: ip.text,
      country: record?.country ?? null,
      region: record?.region ?? null,
      city: record?.city ?? null,
      accuracyRadiusKm: record?.accuracyRadiusKm ?? null,
      asn: record?.asn ?? null,
      organisation: record?.organisation ?? null,
      flags: record?.flags ?? [],
      database: database.name,
      databaseEdition: database.edition,
      institutionStatedLocation: institutionStated[raw]?.trim() || institutionStated[ip.text]?.trim() || null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Printed form (brief 3c). The brief gives this wording; nothing here states where a person was.
// ---------------------------------------------------------------------------------------------------------------

export const IP_LOCATION_FLAGGED_TEXT = "The database lists this network as a hosting or VPN provider.";

export function ipLocationNote(edition: string): string {
  return "An IP location is the provider's estimate of where the network is registered or used. It can differ from " +
    "where the person was, for example on mobile data, a VPN or a hosting service. Addresses can be reassigned over " +
    `time; this lookup used a database dated ${edition}.`;
}

/** "IP address [x] — according to [database, edition date]: registered to [owner], location [city, country] (accuracy about [N] km)." */
export function ipLocationLine(location: IpLocation): string {
  const owner = location.organisation
    ? `registered to ${location.organisation}${location.asn ? ` (AS${location.asn})` : ""}`
    : location.asn ? `registered to AS${location.asn}` : null;
  const place = [location.city, location.region && location.region !== location.city ? location.region : null, location.country]
    .filter(Boolean).join(", ");
  const where = place ? `location ${place}${location.accuracyRadiusKm ? ` (accuracy about ${location.accuracyRadiusKm} km)` : ""}` : null;
  const found = [owner, where].filter(Boolean).join(", ");
  const head = `IP address ${location.ip} — according to ${location.database}, ${location.databaseEdition}: `;
  return `${head}${found || "no location or network owner held"}.`;
}

/** The lines printed for one address: the lookup, the flag sentence where flagged, the institution's own location. */
export function ipLocationLines(location: IpLocation): string[] {
  const lines = [ipLocationLine(location)];
  if (location.flags.includes("hosting") || location.flags.includes("vpn") || location.flags.includes("proxy")) {
    lines.push(IP_LOCATION_FLAGGED_TEXT);
  }
  if (location.institutionStatedLocation) {
    lines.push(`The institution's record gives the location as ${location.institutionStatedLocation}.`);
  }
  return lines;
}

/**
 * What follows the lookups (decision 10): the note with each database date used, then the attribution the database's
 * licence requires. One of each per database and edition, in the order first used.
 */
export function ipLocationFooterLines(locations: readonly IpLocation[]): string[] {
  const editions = [...new Set(locations.map((l) => l.databaseEdition))];
  const databases = [...new Set(locations.map((l) => l.database))];
  return [
    ...editions.map(ipLocationNote),
    ...databases.map(ipLocationAttribution).filter((line): line is string => line !== null),
  ];
}
