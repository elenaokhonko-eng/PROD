// A synthetic IP location database for tests and local runs. Every value is invented: addresses only from the
// documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32), ASNs from the documentation
// range (64496-64511), places and owners named "Example". It matches the ipLocations of the synthetic FIDReC update
// cases (tests/fixtures/fidrec-update). CLAUDE.md: no real data in the repo.

import type { IpRange } from '../../supabase/functions/_shared/ip-location/range-database.ts'

export const SYNTHETIC_IP_DATABASE = { name: 'Example IP Database', edition: '2025-10-01' } as const

export const SYNTHETIC_IP_RANGES: readonly IpRange[] = [
  { start: '192.0.2.0', end: '192.0.2.63', country: 'Exampleland', region: null, city: 'Example Port', accuracyRadiusKm: 200, asn: 64504, organisation: 'Example Cloud Hosting', flags: ['hosting', 'proxy'] },
  { start: '192.0.2.128', end: '192.0.2.255', country: null, region: null, city: null, accuracyRadiusKm: null, asn: 64502, organisation: 'Example VPN Service', flags: ['vpn'] },
  { start: '198.51.100.0', end: '198.51.100.31', country: 'Exampleland', region: null, city: 'Example Town', accuracyRadiusKm: 100, asn: 64501, organisation: 'Example Mobile Network', flags: [] },
  { start: '198.51.100.32', end: '198.51.100.63', country: 'Exampleland', region: 'Example Region', city: 'Example City', accuracyRadiusKm: 20, asn: 64503, organisation: 'Example Broadband', flags: [] },
  { start: '203.0.113.0', end: '203.0.113.255', country: 'Exampleland', region: null, city: 'Example City', accuracyRadiusKm: 50, asn: 64500, organisation: 'Example Hosting Network', flags: ['hosting'] },
  { start: '2001:db8::', end: '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', country: 'Exampleland', region: null, city: null, accuracyRadiusKm: 500, asn: 64505, organisation: 'Example IPv6 Network', flags: [] },
]
