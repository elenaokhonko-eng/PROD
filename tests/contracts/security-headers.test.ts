import assert from 'node:assert/strict'
import test from 'node:test'
import nextConfig, { securityHeaders } from '../../next.config.mjs'
import { AGENT_LINK_HEADER, INDEXABLE_ROUTES } from '../../lib/seo/public-routes.mjs'

// Elena, 9 Nov: HSTS, no framing, a referrer policy and nosniff on every response.
test('every response carries the security headers', async () => {
  const rules = await nextConfig.headers!()
  // The security headers apply to every path; the only other rules add the agent Link header to the public pages
  // (Addendum A §A4).
  assert.deepEqual(rules, [
    { source: '/:path*', headers: securityHeaders },
    ...INDEXABLE_ROUTES.map((source) => ({ source, headers: [{ key: 'Link', value: AGENT_LINK_HEADER }] })),
  ])
  const header = (key: string) => securityHeaders.find((h) => h.key === key)?.value
  assert.match(header('Strict-Transport-Security')!, /^max-age=31536000; includeSubDomains$/)
  assert.equal(header('X-Frame-Options'), 'DENY')
  assert.match(header('Content-Security-Policy')!, /frame-ancestors 'none'/)
  assert.equal(header('X-Content-Type-Options'), 'nosniff')
  assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin')
  assert.match(header('Permissions-Policy')!, /microphone=\(self\)/, 'voice input keeps the microphone')
  assert.match(header('Permissions-Policy')!, /camera=\(\)/)
})
