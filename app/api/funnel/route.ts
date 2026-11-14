import { NextResponse } from 'next/server'
import { NOT_A_VISITOR, funnelEventSchema } from '@/lib/analytics/funnel-schema'
import { keyFrom, rateLimit } from '@/lib/rate-limit'
import { usageEnvironment } from '@/lib/server/model-usage'
import { createServiceClient } from '@/lib/supabase/service'

// Analytics 2 (brief W1 §N): records a journey step from the browser. Open to visitors before sign-up, so it is
// rate-limited per address in memory (nothing about the address is stored), drops crawlers, and accepts only the listed
// steps. It answers 204 whether or not the step was kept, so a visitor's page never shows an error because of it.
export const dynamic = 'force-dynamic'

const accepted = () => new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  const parsed = funnelEventSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_step' }, { status: 400 })
  if (!rateLimit(keyFrom(request, 'funnel'), 60, 60_000).ok) return accepted()
  if (NOT_A_VISITOR.test(request.headers.get('user-agent') ?? '')) return accepted()
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return accepted()

  const step = parsed.data
  const { error } = await createServiceClient().from('funnel_events').insert({
    event: step.event,
    anon_session_id: step.anon_session_id,
    path: step.path ?? null,
    referrer_host: step.referrer_host ?? null,
    utm_source: step.utm_source ?? null,
    utm_medium: step.utm_medium ?? null,
    utm_campaign: step.utm_campaign ?? null,
    device_class: step.device_class ?? null,
    environment: usageEnvironment(process.env),
  })
  if (error) console.warn('[funnel] step not recorded', { code: error.code })
  return accepted()
}
