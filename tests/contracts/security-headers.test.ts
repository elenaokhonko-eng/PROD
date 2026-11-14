import assert from 'node:assert/strict'
import test from 'node:test'
import nextConfig, { securityHeaders } from '../../next.config.mjs'
import { CRAWL_FILE_CACHE_CONTROL, CRAWL_FILE_PATHS, INDEXABLE_ROUTES, pageLinkHeader } from '../../lib/seo/public-routes.mjs'

// Elena, 9 Nov: HSTS, no framing, a referrer policy and nosniff on every response.
test('every response carries the security headers', async () => {
  const rules = await nextConfig.headers!()
  // The security headers apply to every path; the only other rules add the agent Link header, with the page's own
  // markdown copy, and Vary: Accept to the public pages (Addendum A §A4, Addendum M §M3).
  assert.deepEqual(rules, [
    { source: '/:path*', headers: securityHeaders },
    ...INDEXABLE_ROUTES.map((source) => ({
      source,
      headers: [
        { key: 'Link', value: pageLinkHeader(source) },
        { key: 'Vary', value: 'Accept' },
      ],
    })),
    // Crawl files carry their own 1-hour cache so Cloudflare does not hold them for 4 hours.
    ...CRAWL_FILE_PATHS.map((source) => ({ source, headers: [{ key: 'Cache-Control', value: CRAWL_FILE_CACHE_CONTROL }] })),
  ])
  assert.equal(CRAWL_FILE_CACHE_CONTROL, 'public, max-age=3600')
  const header = (key: string) => securityHeaders.find((h) => h.key === key)?.value
  assert.match(header('Strict-Transport-Security')!, /^max-age=31536000; includeSubDomains$/)
  assert.equal(header('X-Frame-Options'), 'DENY')
  assert.match(header('Content-Security-Policy')!, /frame-ancestors 'none'/)
  assert.equal(header('X-Content-Type-Options'), 'nosniff')
  assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin')
  assert.match(header('Permissions-Policy')!, /microphone=\(self\)/, 'voice input keeps the microphone')
  assert.match(header('Permissions-Policy')!, /camera=\(\)/)
})
