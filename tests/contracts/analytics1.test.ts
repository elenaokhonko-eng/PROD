import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { adClickSource, withoutClickIds } from '../../lib/analytics/click-ids'
import { firstTouchFrom } from '../../lib/analytics/funnel'
import { type EventRow, countryRows, funnelRow, periodRows, periodStart, sessionCounts, sessionRows } from '../../lib/server/analytics1'

// Analytics 1 reads tables, not the never-refreshed views (Elena, 22 Nov 2026). Synthetic rows only.

const tab = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const event = (overrides: Partial<EventRow>): EventRow => ({
  session_id: null,
  user_id: null,
  event_name: 'page_view',
  created_at: '2026-11-20T09:00:00.000Z',
  ip_country: null,
  country: null,
  country_code: null,
  ...overrides,
})

const EVENTS: EventRow[] = [
  event({ session_id: tab(1), ip_country: 'SG' }),
  event({ session_id: tab(1), created_at: '2026-11-20T09:05:00.000Z', ip_country: 'SG' }),
  event({ session_id: tab(2), created_at: '2026-11-21T10:00:00.000Z', country_code: 'MY' }),
  // An older page view with no session counts as an event only.
  event({ created_at: '2026-11-18T08:00:00.000Z' }),
]

test('sessions are the page views that carry a session id', () => {
  const rows = sessionRows(EVENTS)
  assert.deepEqual(rows.map((row) => [row.session_id, row.page_views, row.total_events]), [[tab(1), 2, 2], [tab(2), 1, 1]])
  assert.deepEqual(countryRows(EVENTS), [{ country: 'SG', events: 2 }, { country: 'MY', events: 1 }, { country: 'UNKNOWN', events: 1 }])
})

test('periods start on the day, Monday, month, quarter and year, newest first with running totals', () => {
  assert.equal(periodStart('2026-11-22', 'week'), '2026-11-16')
  assert.equal(periodStart('2026-11-16', 'week'), '2026-11-16')
  assert.equal(periodStart('2026-11-22', 'quarter'), '2026-10-01')
  assert.equal(periodStart('2026-11-22', 'year'), '2026-01-01')
  assert.deepEqual(sessionCounts(EVENTS), [
    { day: '2026-11-21', unique_sessions: 1, total_events: 1 },
    { day: '2026-11-20', unique_sessions: 1, total_events: 2 },
    { day: '2026-11-18', unique_sessions: 0, total_events: 1 },
  ])
  const [week] = periodRows(EVENTS, 'week')
  assert.deepEqual(week, {
    granularity: 'week', period_start: '2026-11-16', unique_sessions: 2, total_events: 4, cumulative_sessions: 2, cumulative_events: 4,
  })
})

test('funnel timing averages the first time each visitor reached consecutive steps', () => {
  const rows = [
    event({ session_id: tab(3), event_name: 'story_submitted', created_at: '2026-11-20T09:00:00.000Z' }),
    event({ session_id: tab(3), event_name: 'signup_complete', created_at: '2026-11-20T09:10:00.000Z' }),
    event({ user_id: tab(9), event_name: 'story_submitted', created_at: '2026-11-20T10:00:00.000Z' }),
    event({ user_id: tab(9), event_name: 'signup_complete', created_at: '2026-11-20T10:20:00.000Z' }),
    event({ user_id: tab(9), event_name: 'signup_complete', created_at: '2026-11-20T11:00:00.000Z' }),
    // No session and no account: not a visitor that can be followed.
    event({ event_name: 'story_submitted' }),
  ]
  assert.deepEqual(funnelRow(rows), {
    avg_story_to_signup_minutes: 15,
    avg_signup_to_docs_minutes: null,
    avg_docs_to_report_minutes: null,
    avg_report_to_download_minutes: null,
  })
})

test('a Google Ads click is named as the channel, and its click id is never kept', () => {
  const landing = 'https://guidebuoyai.sg/?gclid=EXAMPLE-CLICK-ID&gad_source=1'
  assert.equal(firstTouchFrom({ href: landing, referrer: '', width: 390 }).utm_source, 'google-ads')
  assert.equal(firstTouchFrom({ href: `${landing}&utm_source=newsletter`, referrer: '', width: 390 }).utm_source, 'newsletter')
  assert.equal(firstTouchFrom({ href: 'https://guidebuoyai.sg/', referrer: '', width: 390 }).utm_source, null)
  assert.equal(adClickSource(new URLSearchParams('wbraid=x')), 'google-ads')
  assert.equal(withoutClickIds(landing), 'https://guidebuoyai.sg/?gad_source=1')
  assert.equal(withoutClickIds('https://guidebuoyai.sg/check?fbclid=x&step=2'), 'https://guidebuoyai.sg/check?step=2')
  assert.equal(withoutClickIds('https://guidebuoyai.sg/pricing'), 'https://guidebuoyai.sg/pricing')
  assert.equal(withoutClickIds('not an address'), 'not an address')
  assert.equal(withoutClickIds(undefined), null)
  assert.match(readFileSync('lib/analytics/server.ts', 'utf8'), /page_url: withoutClickIds\(payload\.pageUrl\)/)
})

test('Analytics 1 reads tables, and page views have their own tab number', () => {
  const page = readFileSync('app/analytics/page.tsx', 'utf8')
  assert.doesNotMatch(page, /\bmv_[a-z_]+/)
  assert.match(page, /current_app_has_role[\s\S]*notFound\(\)/)
  const tracker = readFileSync('components/analytics/page-view-tracker.tsx', 'utf8')
  assert.match(tracker, /sessionStorage/)
  assert.doesNotMatch(tracker, /gb-funnel|localStorage|document\.cookie/)
  assert.match(readFileSync('app/api/analytics/track/route.ts', 'utf8'), /NOT_A_VISITOR\.test/)
})
