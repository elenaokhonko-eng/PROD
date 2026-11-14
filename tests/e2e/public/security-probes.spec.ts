import { expect, test } from '@playwright/test'
import { PROBES } from '../../security-probes'

// Brief W1 Addendum S7, as served.

test('every scanner probe gets a tiny 404 with no cookies', async ({ request }) => {
  for (const probe of PROBES) {
    let path = probe
    let response = await request.get(path, { maxRedirects: 0 })
    // Next.js strips a trailing slash (308) before the middleware runs; the address it redirects to must then be blocked.
    if (response.status() === 308 && path.endsWith('/')) {
      expect(response.headers()['location'], path).toBe(path.replace(/\/$/, ''))
      path = path.replace(/\/$/, '')
      response = await request.get(path, { maxRedirects: 0 })
    }
    expect(response.status(), path).toBe(404)
    expect((await response.body()).length, `${path} body size`).toBeLessThan(100)
    expect(response.headers()['set-cookie'], `${path} sets no cookie`).toBeUndefined()
  }
})

test('an unknown API address answers with a JSON 404', async ({ request }) => {
  const response = await request.get('/api/does-not-exist')
  expect(response.status()).toBe(404)
  expect(response.headers()['content-type']).toMatch(/^application\/json/)
  expect(await response.json()).toEqual({ error: 'Not found' })
})

test('security.txt tells people how to report a problem (S6)', async ({ request }) => {
  const response = await request.get('/.well-known/security.txt')
  expect(response.status()).toBe(200)
  const body = await response.text()
  expect(body).toContain('Contact: mailto:info@guidebuoyai.sg')
  expect(body).toContain('Preferred-Languages: en')
  expect(body).toContain('Canonical: https://guidebuoyai.sg/.well-known/security.txt')
  const expires = new Date(/Expires: (\S+)/.exec(body)![1])
  expect(expires.getTime()).toBeGreaterThan(Date.now() + 300 * 24 * 60 * 60 * 1000)
})

test('security headers are on pages, an API route and the not-found page; no X-Powered-By (S5)', async ({ request }) => {
  for (const path of ['/', '/pricing', '/api/health/release', '/no-such-page']) {
    const headers = (await request.get(path, { maxRedirects: 0 })).headers()
    expect(headers['x-powered-by'], path).toBeUndefined()
    expect(headers['strict-transport-security'], path).toBe('max-age=31536000; includeSubDomains')
    expect(headers['x-content-type-options'], path).toBe('nosniff')
    expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy'], path).toContain('microphone=(self)')
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'")
  }
})
