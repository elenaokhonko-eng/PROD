import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import test from 'node:test'
import { CLOUDFLARE_PROBE_RULE, isProbe } from '../../lib/security/probe-paths'
import { findSecrets } from '../../scripts/scan-secrets'
import { PROBES } from '../security-probes'

// Brief W1 Addendum S1, S2, S7: scanner probes are blocked; no real route is.


const walk = (dir: string, file: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path, file) : name === file ? [path] : []
  })

// Every page and API route in app/, with dynamic segments filled with sample values.
function appRoutes(): string[] {
  const toUrl = (path: string) =>
    '/' +
    relative('app', path)
      .split(sep)
      .slice(0, -1)
      .filter((segment) => !/^\(.*\)$/.test(segment))
      .map((segment) => (segment.startsWith('[[') ? '' : segment.startsWith('[') ? 'sample-id' : segment))
      .filter(Boolean)
      .join('/')
  return [...walk('app', 'page.tsx'), ...walk('app', 'route.ts')].map(toUrl)
}

// The script path Next.js builds for every page in a dynamic or catch-all folder, e.g.
// /_next/static/chunks/app/(auth)/sign-in/[[...sign-in]]/page-<hash>.js, raw and percent-encoded. Sign-in and sign-up
// were blocked on production by a ".." term on 19 Nov because these paths were never checked.
function dynamicPageChunks(): string[] {
  return walk('app', 'page.tsx')
    .map((path) => relative('app', path).split(sep).slice(0, -1).join('/'))
    .filter((dir) => dir.includes('['))
    .flatMap((dir) => {
      const raw = `/_next/static/chunks/app/${dir}/page-0123456789abcdef.js`
      return [raw, raw.replace(/\[/g, '%5B').replace(/\]/g, '%5D')]
    })
}


const RUNTIME_PATHS = [
  '/_next/static/chunks/app/(marketing)/page-0123456789abcdef.js',
  ...dynamicPageChunks(),
  '/_next/static/chunks/webpack-0123456789abcdef.js',
  '/_next/static/css/0123456789abcdef.css',
  '/_next/static/media/inter-latin.0123.woff2',
  '/_next/image',
  '/sign-in/sso-callback',
  '/sign-in/factor-one',
  '/sign-up/verify-email-address',
  '/api/webhooks/clerk',
  '/api/payments/webhook',
  '/api/health/release',
  '/api/health/client-address',
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
  '/favicon.ico',
  '/icon.png',
  '/apple-icon.png',
  '/manifest.webmanifest',
  '/.well-known/security.txt',
  '/.well-known/agent-skills/index.json',
  '/.well-known/agent-skills/guidebuoy-scam-help/SKILL.md',
  '/pricing.md',
  '/index.md',
  '/llms-full.txt',
  '/auth.md',
  '/openapi.json',
  '/mcp',
  '/api/public/v1/fidrec-deadline',
  '/.well-known/api-catalog',
  '/.well-known/mcp/server-card.json',
  '/app/case/sample-id/dashboard',
  '/facts',
  '/analytics',
  '/terms/2.1',
]

test('every probe from the Cloudflare reports is blocked', () => {
  const missed = PROBES.filter((path) => !isProbe(path))
  assert.deepEqual(missed, [])
})

test('no real or planned route is blocked', () => {
  const files = readdirSync('public', { recursive: true }).map((name) => '/' + String(name).replace(/\\/g, '/'))
  const routes = [...new Set([...appRoutes(), ...RUNTIME_PATHS, ...files])]
  assert.ok(routes.length > 60, `enumerated ${routes.length} routes`)
  assert.deepEqual(routes.filter((path) => isProbe(path)), [])
  // A redirect back from Clerk or Stripe carries an encoded address in the query string, which must stay allowed.
  assert.equal(isProbe('/sign-in', '/sign-in?redirect_url=https%3A%2F%2Fguidebuoyai.sg%2Fapp'), false)
  // The catch-all scripts are in the list above; path traversal stays blocked in every spelling.
  assert.ok(dynamicPageChunks().some((path) => path.includes('%5B%5B...sign-in%5D%5D')))
  for (const traversal of ['/../etc/passwd', '/a/../../etc/passwd', '/a/..%2f..%2fetc', '/%2e%2e/etc', '/a/..%5cwin.ini', '/a../b']) {
    assert.equal(isProbe(traversal), true, traversal)
  }
})

test('the Cloudflare rule is generated from the same lists and keeps the brief\'s exceptions', () => {
  assert.match(CLOUDFLARE_PROBE_RULE, /^\(http\.request\.uri\.path contains "\/\." and not starts_with\(http\.request\.uri\.path, "\/\.well-known\/"\)\)\n/)
  assert.match(CLOUDFLARE_PROBE_RULE, /"\/admin\/api-tokens"/)
  assert.doesNotMatch(CLOUDFLARE_PROBE_RULE, /starts_with\(http\.request\.uri\.path, "\/admin"\)/, '/admin as a whole stays open')
  assert.doesNotMatch(CLOUDFLARE_PROBE_RULE, /ends_with\(lower\(http\.request\.uri\.path\), "\.json"\)|"\.js"\)/, '.json and .js are not blocked by extension')
})

test('the secret scanner finds real-looking keys and ignores test fixtures', () => {
  // Built at run time so this file never contains a secret-shaped literal.
  const fake = (prefix: string, n = 32) => prefix + 'q7Rm2Kp9'.repeat(Math.ceil(n / 8)).slice(0, n)
  assert.deepEqual(findSecrets(`const k = "${fake('sk_' + 'live_')}"`), ['Stripe secret or restricted key', 'Clerk secret key'])
  assert.deepEqual(findSecrets(`key=${fake('AI' + 'za', 35)}`), ['Google API key'])
  assert.deepEqual(findSecrets(`"${fake('sk-' + 'proj-', 40)}"`), ['OpenAI key'])
  assert.deepEqual(findSecrets(`'${'sk_' + 'test_'}abcdefghijklmnopqrstuvwx'`), [], 'a fixture with abcde is ignored')
  assert.deepEqual(findSecrets('NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xyz'), [])
})
