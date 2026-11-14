// Brief W1 Addendum S3.2 (approved by Elena, 14 Nov 2026): only requests that came through Cloudflare reach the app.
// Cloudflare adds ORIGIN_AUTH_HEADER with a shared secret to every request it forwards (a Transform Rule); the
// middleware refuses any request without it. The secret lives in Cloudflare and in Render's environment
// (ORIGIN_AUTH_SECRET), never in the repo. Unset means off, so the check can be switched on after Cloudflare sends it.
//
// /api/health/* stays exempt: Render's health check and the release checks call the service directly.
//
// ORIGIN_AUTH_MODE=report lets every request through and only reports, at /api/health/origin, whether the header
// arrived and matched. Switch on with report first; enforce once that says "match" (lesson of 14 Nov: a header that
// did not match took every page to 404 for three minutes).

export const ORIGIN_AUTH_HEADER = 'x-guidebuoy-origin'

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

export type OriginStatus = 'off' | 'missing' | 'match' | 'match-after-trim' | 'mismatch'

// Says only whether the header matched, never anything about either value.
export function originStatus(headerValue: string | null, secret: string | undefined): OriginStatus {
  const expected = secret?.trim()
  if (!expected) return 'off'
  if (headerValue === null || headerValue === '') return 'missing'
  if (constantTimeEqual(headerValue, expected)) return 'match'
  return constantTimeEqual(headerValue.trim(), expected) ? 'match-after-trim' : 'mismatch'
}

export function originAllowed(
  pathname: string,
  headerValue: string | null,
  secret: string | undefined,
  mode?: string,
): boolean {
  const expected = secret?.trim()
  if (!expected || mode?.trim() === 'report') return true
  if (pathname === '/api/health' || pathname.startsWith('/api/health/')) return true
  return headerValue !== null && constantTimeEqual(headerValue, expected)
}
