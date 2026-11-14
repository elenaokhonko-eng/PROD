import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ORIGIN_AUTH_HEADER, originAllowed } from '../../lib/security/origin-check'

// Brief W1 Addendum S3.2: requests must come through Cloudflare once ORIGIN_AUTH_SECRET is set.
const secret = 'o'.repeat(48)

test('off until ORIGIN_AUTH_SECRET is set', () => {
  assert.equal(originAllowed('/', null, undefined), true)
  assert.equal(originAllowed('/', null, '  '), true)
})

test('when on, only the matching header gets through', () => {
  assert.equal(originAllowed('/', secret, secret), true)
  assert.equal(originAllowed('/pricing', null, secret), false)
  assert.equal(originAllowed('/api/payments/webhook', 'wrong', secret), false)
  assert.equal(originAllowed('/', secret.slice(1), secret), false)
})

test('health checks stay reachable directly', () => {
  assert.equal(originAllowed('/api/health/live', null, secret), true)
  assert.equal(originAllowed('/api/health/release', null, secret), true)
  assert.equal(originAllowed('/api/healthz', null, secret), false)
})

test('the middleware checks the origin after the probe block and before anything else', () => {
  const source = readFileSync('middleware.ts', 'utf8')
  const probe = source.indexOf('return probeResponse()')
  const origin = source.indexOf('originAllowed(pathname, request.headers.get(ORIGIN_AUTH_HEADER), process.env.ORIGIN_AUTH_SECRET)')
  const host = source.indexOf('hostAllowed(')
  assert.ok(probe > 0 && origin > probe && host > origin, 'probe block, then origin check, then host check')
  assert.equal(ORIGIN_AUTH_HEADER, 'x-guidebuoy-origin')
})
