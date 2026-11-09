import assert from 'node:assert/strict'
import test from 'node:test'
import nextConfig, { securityHeaders } from '../../next.config.mjs'

// Elena, 9 Nov: HSTS, no framing, a referrer policy and nosniff on every response.
test('every response carries the security headers', async () => {
  const rules = await nextConfig.headers!()
  assert.deepEqual(rules, [{ source: '/:path*', headers: securityHeaders }])
  const header = (key: string) => securityHeaders.find((h) => h.key === key)?.value
  assert.match(header('Strict-Transport-Security')!, /^max-age=31536000; includeSubDomains$/)
  assert.equal(header('X-Frame-Options'), 'DENY')
  assert.match(header('Content-Security-Policy')!, /frame-ancestors 'none'/)
  assert.equal(header('X-Content-Type-Options'), 'nosniff')
  assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin')
  assert.match(header('Permissions-Policy')!, /microphone=\(self\)/, 'voice input keeps the microphone')
  assert.match(header('Permissions-Policy')!, /camera=\(\)/)
})
