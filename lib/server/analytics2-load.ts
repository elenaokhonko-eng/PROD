import type { SupabaseClient } from '@supabase/supabase-js'
import { usageEnvironment } from '@/lib/server/model-usage'
import { type JourneyInputs, summariseJourney, type Analytics2View } from '@/lib/server/analytics2'

// Analytics 2: reads the period's rows with the service client. Call only after the admin check.
const LIMIT = 100_000

export async function loadAnalytics2(service: SupabaseClient, days: number): Promise<{ view: Analytics2View; missing: string[] }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const missing: string[] = []
  const rows = async <T,>(label: string, query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    const { data, error } = await query
    if (error) {
      missing.push(label)
      return [] as T[]
    }
    return data ?? []
  }

  const [funnel, accounts, cases, evaluations, interest, purchases] = await Promise.all([
    rows<JourneyInputs['funnel'][number]>(
      'browser steps',
      service
        .from('funnel_events')
        .select('event, anon_session_id, created_at, device_class, utm_source, referrer_host')
        .eq('environment', usageEnvironment(process.env))
        .gte('created_at', since)
        .limit(LIMIT),
    ),
    rows<JourneyInputs['accounts'][number]>('accounts', service.from('profiles').select('created_at').gte('created_at', since).limit(LIMIT)),
    rows<JourneyInputs['cases'][number]>('cases', service.from('cases').select('id, created_at, first_touch').gte('created_at', since).limit(LIMIT)),
    rows<JourneyInputs['evaluations'][number]>(
      'evaluations',
      service.from('case_narratives').select('case_id, created_at').eq('narrative_type', 'tier0_summary').gte('created_at', since).limit(LIMIT),
    ),
    rows<JourneyInputs['interest'][number]>('pack interest', service.from('waitlist').select('created_at, source').gte('created_at', since).limit(LIMIT)),
    rows<JourneyInputs['purchases'][number]>(
      'purchases',
      service.from('case_purchases').select('case_id, product_code, paid_at, payment_status').gte('paid_at', since).limit(LIMIT),
    ),
  ])

  return { view: summariseJourney({ funnel, accounts, cases, evaluations, interest, purchases }, days), missing }
}
