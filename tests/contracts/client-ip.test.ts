import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CLOUDFLARE_IPV4_RANGES,
  CLOUDFLARE_IPV6_RANGES,
  ipInCidr,
  isCloudflareIp,
  parseIp,
} from '../../lib/cloudflare-ips'
import { clientIp } from '../../lib/rate-limit'

// Elena, 9 Nov: HARBOR_TRUST_CLOUDFLARE_IP must not let a request sent straight to the *.onrender.com address dodge
// the per-IP limits with a forged CF-Connecting-IP. Documentation addresses only (RFC 5737 / 3849) plus Cloudflare's
// published ranges.

const headers = (values: Record<string, string>) => new Headers(values)

test('Cloudflare ranges are the published lists of 9 Nov 2026', () => {
  assert.equal(CLOUDFLARE_IPV4_RANGES.length, 15)
  assert.equal(CLOUDFLARE_IPV6_RANGES.length, 7)
  for (const cidr of [...CLOUDFLARE_IPV4_RANGES, ...CLOUDFLARE_IPV6_RANGES]) {
    assert.ok(parseIp(cidr.split('/')[0]), `${cidr} parses`)
  }
})

test('address matching: IPv4, IPv6, compressed and IPv4-mapped forms', () => {
  assert.ok(ipInCidr('104.16.0.1', '104.16.0.0/13'))
  assert.ok(ipInCidr('104.23.255.255', '104.16.0.0/13'))
  assert.ok(!ipInCidr('104.24.0.0', '104.16.0.0/13'))
  assert.ok(ipInCidr('2606:4700:3035::ac43:a4a5', '2606:4700::/32'))
  assert.ok(ipInCidr('2a06:98c7:ffff::1', '2a06:98c0::/29'))
  assert.ok(!ipInCidr('2a06:98c8::1', '2a06:98c0::/29'))
  assert.ok(!ipInCidr('104.16.0.1', '2606:4700::/32'), 'versions never match each other')
  assert.deepEqual(parseIp('::ffff:172.64.0.1'), parseIp('172.64.0.1'))
  assert.ok(isCloudflareIp('::ffff:172.64.0.1'))
  assert.ok(isCloudflareIp('[2400:cb00::1]'))
  for (const bad of ['', '256.1.1.1', '1.2.3', '1:2:3:4:5:6:7:8:9', '2001:db8::1::2', 'not-an-ip', '1.2.3.4/8']) {
    assert.equal(parseIp(bad), null, `${bad || '(empty)'} is rejected`)
  }
  assert.ok(!isCloudflareIp('203.0.113.9'))
  assert.ok(!isCloudflareIp('2001:db8::1'))
})

test('trusted: through Cloudflare, CF-Connecting-IP is the client', () => {
  assert.equal(clientIp(headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '198.51.100.7, 162.158.1.2' }), null, true), '198.51.100.7')
  assert.equal(clientIp(headers({ 'cf-connecting-ip': '2001:db8::7', 'x-forwarded-for': '2a06:98c0::1' }), null, true), '2001:db8::7')
})

test('direct to onrender.com: a forged CF-Connecting-IP is ignored and the connecting address is used', () => {
  const forged = headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '198.51.100.7, 203.0.113.9' })
  assert.equal(clientIp(forged, null, true), '203.0.113.9')
  // Rotating the forged value does not give a new bucket.
  const rotated = headers({ 'cf-connecting-ip': '198.51.100.8', 'x-forwarded-for': '198.51.100.8, 203.0.113.9' })
  assert.equal(clientIp(rotated, null, true), clientIp(forged, null, true))
  // Forging a Cloudflare address in the left of X-Forwarded-For does not help: only the right-most entry counts.
  assert.equal(clientIp(headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '172.64.0.1, 203.0.113.9' }), null, true), '203.0.113.9')
})

test('a malformed CF-Connecting-IP is never used as a key', () => {
  assert.equal(clientIp(headers({ 'cf-connecting-ip': 'x'.repeat(500), 'x-forwarded-for': '172.64.0.1' }), null, true), '172.64.0.1')
})

test('the header is believed by default, as every Render request comes through Cloudflare (measured on staging, 9 Nov)', () => {
  const saved = process.env.HARBOR_TRUST_CLOUDFLARE_IP
  delete process.env.HARBOR_TRUST_CLOUDFLARE_IP
  try {
    // The shape staging receives: client, then the Cloudflare edge that connected (a different edge per request).
    const first = headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '198.51.100.7, 172.70.1.2' })
    const second = headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.50, 198.51.100.7, 108.162.200.4' })
    assert.equal(clientIp(first), '198.51.100.7')
    assert.equal(clientIp(second), '198.51.100.7', 'one person keeps one bucket whichever edge carried the request')
    assert.notEqual(clientIp(headers({ 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '172.70.1.2' })), clientIp(first), 'two people on one edge are not one bucket')
  } finally {
    if (saved === undefined) delete process.env.HARBOR_TRUST_CLOUDFLARE_IP
    else process.env.HARBOR_TRUST_CLOUDFLARE_IP = saved
  }
})

test('HARBOR_TRUST_CLOUDFLARE_IP=false switches the header off, even from Cloudflare', () => {
  assert.equal(clientIp(headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '172.64.0.1' }), null, false), '172.64.0.1')
})

test('the client-address check needs the worker secret and returns only the caller\'s own request view', () => {
  const route = readFileSync('app/api/health/client-address/route.ts', 'utf8')
  assert.match(route, /timingSafeEqual/)
  assert.match(route, /status: 404/)
  assert.match(route, /no-store/)
  assert.doesNotMatch(route, /console\.|log\./, 'nothing is logged')
})
