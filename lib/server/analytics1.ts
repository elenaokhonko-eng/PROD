// Analytics 1 (/analytics): the detailed view, computed from analytics_events rows. It used to read materialized views
// that were never refreshed on production (22 Nov 2026), so every session, country and timing tile was empty.
// Page views sent before 22 Nov 2026 carry no session id: they count as events, not as sessions.

export type EventRow = {
  session_id: string | null
  user_id: string | null
  event_name: string
  created_at: string
  ip_country: string | null
  country: string | null
  country_code: string | null
}

export type SessionRow = { session_id: string; page_views: number; total_events: number }
export type CountryRow = { country: string; events: number }
export type SessionCountRow = { day: string; unique_sessions: number; total_events: number }
export type SessionPeriodRow = {
  granularity: Granularity
  period_start: string
  unique_sessions: number
  total_events: number
  cumulative_sessions: number
  cumulative_events: number
}
export type FunnelRow = {
  avg_story_to_signup_minutes: number | null
  avg_signup_to_docs_minutes: number | null
  avg_docs_to_report_minutes: number | null
  avg_report_to_download_minutes: number | null
}

export const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const
export type Granularity = (typeof GRANULARITIES)[number]

const FUNNEL_STEPS = ['story_submitted', 'signup_complete', 'documents_uploaded', 'report_generated', 'report_downloaded'] as const

const day = (iso: string) => iso.slice(0, 10)

/** The first day of the period holding a UTC day (weeks start on Monday, as Postgres date_trunc). */
export function periodStart(isoDay: string, granularity: Granularity): string {
  const date = new Date(`${isoDay}T00:00:00Z`)
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  if (granularity === 'day') return isoDay
  if (granularity === 'week') {
    const back = (date.getUTCDay() + 6) % 7
    return new Date(Date.UTC(y, m, date.getUTCDate() - back)).toISOString().slice(0, 10)
  }
  if (granularity === 'month') return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  if (granularity === 'quarter') return new Date(Date.UTC(y, m - (m % 3), 1)).toISOString().slice(0, 10)
  return `${y}-01-01`
}

export function sessionRows(events: EventRow[]): SessionRow[] {
  const bySession = new Map<string, SessionRow>()
  for (const event of events) {
    if (!event.session_id) continue
    const row = bySession.get(event.session_id) ?? { session_id: event.session_id, page_views: 0, total_events: 0 }
    row.total_events += 1
    if (event.event_name === 'page_view') row.page_views += 1
    bySession.set(event.session_id, row)
  }
  return [...bySession.values()]
}

export function countryRows(events: EventRow[]): CountryRow[] {
  const counts = new Map<string, number>()
  for (const event of events) {
    const country = event.ip_country ?? event.country ?? event.country_code ?? 'UNKNOWN'
    counts.set(country, (counts.get(country) ?? 0) + 1)
  }
  return [...counts].map(([country, events]) => ({ country, events })).sort((a, b) => b.events - a.events || a.country.localeCompare(b.country))
}

/** Sessions and events per period, newest first, with running totals from the oldest period. */
export function periodRows(events: EventRow[], granularity: Granularity): SessionPeriodRow[] {
  const byPeriod = new Map<string, { sessions: Set<string>; events: number }>()
  for (const event of events) {
    const start = periodStart(day(event.created_at), granularity)
    const entry = byPeriod.get(start) ?? { sessions: new Set<string>(), events: 0 }
    entry.events += 1
    if (event.session_id) entry.sessions.add(event.session_id)
    byPeriod.set(start, entry)
  }
  let cumulativeSessions = 0
  let cumulativeEvents = 0
  const rows = [...byPeriod.keys()].sort().map((start) => {
    const entry = byPeriod.get(start)!
    cumulativeSessions += entry.sessions.size
    cumulativeEvents += entry.events
    return {
      granularity,
      period_start: start,
      unique_sessions: entry.sessions.size,
      total_events: entry.events,
      cumulative_sessions: cumulativeSessions,
      cumulative_events: cumulativeEvents,
    }
  })
  return rows.reverse()
}

export function sessionCounts(events: EventRow[]): SessionCountRow[] {
  return periodRows(events, 'day').map(({ period_start, unique_sessions, total_events }) => ({
    day: period_start,
    unique_sessions,
    total_events,
  }))
}

/** Average minutes between the first time each visitor (session, else account) reached consecutive steps. */
export function funnelRow(events: EventRow[]): FunnelRow {
  const firsts = new Map<string, Partial<Record<(typeof FUNNEL_STEPS)[number], number>>>()
  for (const event of events) {
    const step = FUNNEL_STEPS.find((name) => name === event.event_name)
    const key = event.session_id ?? event.user_id
    if (!step || !key) continue
    const entry = firsts.get(key) ?? {}
    const time = Date.parse(event.created_at)
    if (entry[step] === undefined || time < entry[step]!) entry[step] = time
    firsts.set(key, entry)
  }
  const average = (from: (typeof FUNNEL_STEPS)[number], to: (typeof FUNNEL_STEPS)[number]) => {
    const gaps = [...firsts.values()]
      .filter((entry) => entry[from] !== undefined && entry[to] !== undefined)
      .map((entry) => (entry[to]! - entry[from]!) / 60_000)
    return gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null
  }
  return {
    avg_story_to_signup_minutes: average('story_submitted', 'signup_complete'),
    avg_signup_to_docs_minutes: average('signup_complete', 'documents_uploaded'),
    avg_docs_to_report_minutes: average('documents_uploaded', 'report_generated'),
    avg_report_to_download_minutes: average('report_generated', 'report_downloaded'),
  }
}
