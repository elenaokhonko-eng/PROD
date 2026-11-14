// Liveness for Render's health check (Addendum S3.2): answers 200 without touching the database or any provider, and
// stays reachable when the origin check refuses requests that bypass Cloudflare.
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
