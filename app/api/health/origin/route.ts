import { ORIGIN_AUTH_HEADER, originStatus } from '@/lib/security/origin-check'

// Addendum S3.2 switch-on check: through guidebuoyai.sg this says whether Cloudflare's header reached the app and
// matched ORIGIN_AUTH_SECRET. It answers with a status word only, never any part of either value.
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  const origin = originStatus(request.headers.get(ORIGIN_AUTH_HEADER), process.env.ORIGIN_AUTH_SECRET)
  const mode = process.env.ORIGIN_AUTH_MODE?.trim() === 'report' ? 'report' : 'enforce'
  return Response.json({ origin, mode }, { headers: { 'Cache-Control': 'no-store' } })
}
