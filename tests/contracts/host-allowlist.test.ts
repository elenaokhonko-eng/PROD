import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { allowedHosts, hostAllowed } from '../../lib/host-allowlist'

// Elena, 9 Nov: production refuses requests for any host but its own domains, so the *.onrender.com address cannot be
// used to go around Cloudflare. Health checks stay reachable.
const PROD = allowedHosts({ HARBOR_ALLOWED_HOSTS: ' guidebuoyai.sg, WWW.guidebuoyai.sg ,' })

test('the allowlist is read from HARBOR_ALLOWED_HOSTS; unset allows every host (staging, CI)', () => {
  assert.deepEqual(PROD, ['guidebuoyai.sg', 'www.guidebuoyai.sg'])
  assert.deepEqual(allowedHosts({}), [])
  assert.ok(hostAllowed('guidebuoy-staging-web.onrender.com', '/app', []))
})

test('production answers on its domains only', () => {
  assert.ok(hostAllowed('guidebuoyai.sg', '/', PROD))
  assert.ok(hostAllowed('WWW.GuideBuoyAI.sg', '/app/case/new', PROD))
  assert.ok(hostAllowed('guidebuoyai.sg:443', '/api/cases/bootstrap', PROD))
  assert.ok(hostAllowed('guidebuoyai.sg.', '/', PROD), 'a trailing root dot is the same name')
  for (const host of ['guidebuoy-web.onrender.com', 'evil.example', 'guidebuoyai.sg.evil.example', 'xguidebuoyai.sg', '', null]) {
    assert.equal(hostAllowed(host, '/app', PROD), false, String(host))
    assert.equal(hostAllowed(host, '/api/router/classify', PROD), false, String(host))
  }
})

test('release health checks answer on any host', () => {
  assert.ok(hostAllowed('guidebuoy-web.onrender.com', '/api/health/release', PROD))
  assert.ok(hostAllowed('10.0.0.5:10000', '/api/health/client-address', PROD))
  assert.equal(hostAllowed('guidebuoy-web.onrender.com', '/api/healthy', PROD), false)
})

test('the middleware checks the host before anything else and covers every API route', () => {
  const middleware = readFileSync('middleware.ts', 'utf8')
  const body = middleware.slice(middleware.indexOf('export default function middleware'))
  assert.ok(body.indexOf('hostAllowed(') > 0 && body.indexOf('hostAllowed(') < body.indexOf('blockedPathPatterns'), 'host check comes first')
  assert.match(middleware, /'\/\(api\|trpc\)\(\.\*\)'/)
})
