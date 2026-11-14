// Brief W1 Addendum S3.2 (approved by Elena, 14 Nov 2026): only requests that came through Cloudflare reach the app.
// Cloudflare adds ORIGIN_AUTH_HEADER with a shared secret to every request it forwards (a Transform Rule); the
// middleware refuses any request without it. The secret lives in Cloudflare and in Render's environment
// (ORIGIN_AUTH_SECRET), never in the repo. Unset means off, so the check can be switched on after Cloudflare sends it.
//
// /api/health/* stays exempt: Render's health check and the release checks call the service directly.

export const ORIGIN_AUTH_HEADER = 'x-guidebuoy-origin'

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

export function originAllowed(pathname: string, headerValue: string | null, secret: string | undefined): boolean {
  const expected = secret?.trim()
  if (!expected) return true
  if (pathname === '/api/health' || pathname.startsWith('/api/health/')) return true
  return headerValue !== null && constantTimeEqual(headerValue, expected)
}
