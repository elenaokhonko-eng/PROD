// The IP location database provider (review of 24 November, decision 10: DB-IP Lite to start).
//
// DB-IP's Lite downloads (https://db-ip.com/db/lite.php, read 24 November 2026) are licensed under the Creative
// Commons Attribution 4.0 International licence. Commercial use, copying and adaptation are allowed with attribution;
// DB-IP asks for a link "IP Geolocation by DB-IP" to https://db-ip.com wherever results are shown, and CC BY 4.0 asks
// for the licence to be named and changes to be indicated. The Lite files are updated monthly.
//
// The attribution is printed with the lookups (the pack's IP location section) and named in the privacy policy.

export interface IpDatabaseProvider {
  id: string;
  /** The database name printed beside every lookup and kept with each lookup result (`IpLocation.database`). */
  databaseName: string;
  licence: string;
  licenceUrl: string;
  attributionText: string;
  attributionUrl: string;
  /** What we changed, as CC BY 4.0 asks. */
  changes: string;
}

export const DBIP_LITE: IpDatabaseProvider = {
  id: "dbip-lite",
  databaseName: "DB-IP Lite",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  attributionText: "IP Geolocation by DB-IP",
  attributionUrl: "https://db-ip.com",
  changes: "the IP to City Lite and IP to ASN Lite files were combined and converted for this lookup",
};

export const IP_DATABASE_PROVIDERS: readonly IpDatabaseProvider[] = [DBIP_LITE];

export function providerForDatabase(databaseName: string): IpDatabaseProvider | null {
  return IP_DATABASE_PROVIDERS.find((p) => p.databaseName === databaseName) ?? null;
}

/**
 * The attribution line printed with the lookups.
 * Approved by Elena, 24 Nov. "IP Geolocation by DB-IP" and the link are DB-IP's own words.
 */
export function ipLocationAttribution(databaseName: string): string | null {
  const p = providerForDatabase(databaseName);
  if (!p) return null;
  return `${p.attributionText} (${p.attributionUrl}), licensed under ${p.licence} (${p.licenceUrl}); ${p.changes}.`;
}
