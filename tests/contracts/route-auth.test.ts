import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { SMTP_TEST_SUBJECT_PREFIX, smtpTestRecipients } from '../../lib/server/smtp-test'

// Elena, 9 Nov (after the Next.js middleware-bypass advisories): no route may rely on the middleware for access
// control. Every API route checks the session, a case-access helper or a shared secret itself, unless it is listed
// here as public with the reason; every signed-in page checks the user itself.

// The last alternative: the caller's own bearer token is passed to Supabase, which verifies it before RLS applies.
const GUARD =
  /\bauth\(\)|getCurrentUser\(|currentUser\(|factsCaseAccess\(|resolveRequestSupabaseUuid\(|assertCaseAccess\(|proxyEdgeFunction\(|handleClerkWebhook\(|constructEvent\(|timingSafeEqual\(|headers: \{ Authorization: `Bearer \$\{bearer\}` \}/

const PUBLIC: Record<string, string> = {
  'router/assess': 'pre-sign-in triage; rules only, limited per IP',
  'router/classify': 'pre-sign-in triage; model call limited per IP and by the daily breaker',
  'router/questions': 'pre-sign-in triage; model call limited per IP and by the daily breaker',
  'router/session': 'pre-sign-in triage session; links to the account when signed in',
  'transcribe': 'pre-sign-in voice input; limited per IP, audio capped at 3 MB',
  'funnel': 'pre-sign-in journey steps (Analytics 2); limited per IP in memory, listed steps and channel fields only',
  'triage/analyze': 'pre-sign-in triage; limited per IP',
  'health/live': 'liveness for Render health checks; returns {ok:true} and reads nothing (Addendum S3.2)',
  'health/origin': 'says whether the Cloudflare origin header matched (missing/match/mismatch), never any value (Addendum S3.2)',
  '[...unknown]': 'answers every unknown API address with a JSON 404 and does nothing else (Addendum S2)',
}

function routes(dir = 'app/api'): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return routes(path)
    return entry === 'route.ts' ? [path] : []
  })
}

const routeName = (path: string) => dirname(path).replace(/\\/g, '/').replace(/^app\/api\//, '')

test('every API route checks access itself, or is listed as public with a reason', () => {
  const unguarded: string[] = []
  for (const path of routes()) {
    const name = routeName(path)
    if (name in PUBLIC) continue
    const handlers = join(dirname(path), 'handlers.ts')
    const source = readFileSync(path, 'utf8') + (existsSync(handlers) ? readFileSync(handlers, 'utf8') : '')
    if (!GUARD.test(source)) unguarded.push(name)
  }
  assert.deepEqual(unguarded, [])
  const names = routes().map(routeName)
  assert.deepEqual(Object.keys(PUBLIC).filter((name) => !names.includes(name)), [], 'every public entry still exists')
})

test('signed-in pages check the user themselves', () => {
  const pages = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      return statSync(path).isDirectory() ? pages(path) : entry === 'page.tsx' ? [path] : []
    })
  const unchecked = [...pages('app/(case)/app'), ...pages('app/analytics')].filter((path) => {
    const source = readFileSync(path, 'utf8')
    const onlyRedirects = /^\s*redirect\(/m.test(source) && !/use client|fetch\(|createClient|supabase/.test(source)
    return !/getCurrentUser\(|\bauth\(\)/.test(source) && !onlyRedirects
  })
  assert.deepEqual(unchecked, [])
})

test('the open welcome-email route is gone, and the SMTP test route only mails the configured test recipients', () => {
  assert.equal(existsSync('app/api/email/welcome/route.ts'), false)
  const route = readFileSync('app/api/email/send/route.ts', 'utf8')
  assert.match(route, /smtpTestRecipients\(\)\.includes\(/)
  assert.match(route, /status: 403/)
  assert.match(route, /from: EMAIL_FROM, to, subject: `\$\{SMTP_TEST_SUBJECT_PREFIX\}\$\{subject\}`/)
  assert.doesNotMatch(route, /from \|\| EMAIL_FROM|from: z\./, 'the sender cannot be chosen')
  assert.deepEqual(
    smtpTestRecipients({ HARBOR_SMTP_TEST_RECIPIENT: ' Test@Example.com ', HARBOR_PREVIEW_EMAIL_SINK: 'sink@example.com', ADMIN_EMAIL: '' }),
    ['test@example.com', 'sink@example.com'],
  )
  assert.deepEqual(smtpTestRecipients({}), [], 'with nothing configured, nobody can be mailed')
  assert.ok(SMTP_TEST_SUBJECT_PREFIX.trim().length > 0)
})

// Next 14.2.35 still carries image-optimizer advisories fixed only in 15.5 (GHSA-2xp9-vwfh-vxw4, GHSA-2464-fhr4-w9xw).
// With images.unoptimized, /_next/image answers 404 before any image is processed.
test('the Next.js image optimizer stays off', () => {
  assert.match(readFileSync('next.config.mjs', 'utf8'), /images:\s*\{\s*unoptimized:\s*true,?\s*\}/)
})
