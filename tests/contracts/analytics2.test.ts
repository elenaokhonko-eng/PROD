import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { deviceClass, firstTouchFrom } from '../../lib/analytics/funnel'
import { NOT_A_VISITOR, firstTouchSchema, funnelEventSchema } from '../../lib/analytics/funnel-schema'
import { type JourneyInputs, percentile, summariseJourney } from '../../lib/server/analytics2'

// Analytics 2 (brief W1 §N; Elena, 14 Nov 2026). Synthetic rows only.

const tab = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 10, 9, 0) + minutes * 60_000).toISOString()

test('the channel is a host name and UTM tags, never a path or the visitor', () => {
  const touch = firstTouchFrom({
    href: 'https://guidebuoyai.sg/?utm_source=facebook&utm_medium=group&utm_campaign=nov',
    referrer: 'https://www.facebook.com/groups/some-group/posts/123?ref=share',
    width: 390,
  })
  assert.deepEqual(touch, { referrer_host: 'www.facebook.com', utm_source: 'facebook', utm_medium: 'group', utm_campaign: 'nov', device_class: 'phone' })
  assert.equal(firstTouchFrom({ href: 'https://guidebuoyai.sg/pricing', referrer: 'https://guidebuoyai.sg/', width: 1440 }).referrer_host, null)
  assert.deepEqual([deviceClass(639), deviceClass(640), deviceClass(1023), deviceClass(1024)], ['phone', 'tablet', 'tablet', 'desktop'])
})

test('the browser may send only the listed steps and channel fields', () => {
  const step = { event: 'story_submitted', anon_session_id: tab(1), path: '/', utm_source: 'facebook', device_class: 'phone' }
  assert.equal(funnelEventSchema.safeParse(step).success, true)
  assert.equal(funnelEventSchema.safeParse({ ...step, event: 'page_view' }).success, false)
  assert.equal(funnelEventSchema.safeParse({ ...step, anon_session_id: 'not-a-uuid' }).success, false)
  assert.equal(funnelEventSchema.safeParse({ ...step, referrer_host: 'https://x.example/path' }).success, false)
  const parsed = funnelEventSchema.parse({ ...step, story: 'my story', email: 'a@example.invalid', user_id: tab(9) })
  assert.deepEqual(Object.keys(parsed).sort(), ['anon_session_id', 'device_class', 'event', 'path', 'utm_source'])
  assert.deepEqual(Object.keys(firstTouchSchema.parse({ utm_source: 'x', case_id: tab(2) })), ['utm_source'])
})

test('crawlers are not counted as visitors', () => {
  for (const agent of ['Googlebot/2.1', 'Mozilla/5.0 (compatible; ClaudeBot/1.0)', 'curl/8.4', 'HeadlessChrome/120']) {
    assert.match(agent, NOT_A_VISITOR)
  }
  assert.doesNotMatch('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', NOT_A_VISITOR)
})

test('steps, drop-off, channels and journey times from synthetic rows', () => {
  const funnel: JourneyInputs['funnel'] = []
  const step = (n: number, event: JourneyInputs['funnel'][number]['event'], minutes: number, source: string | null, device = 'phone') =>
    funnel.push({ event, anon_session_id: tab(n), created_at: at(minutes), device_class: device, utm_source: source, referrer_host: null })
  // Tab 1 goes all the way; tab 2 submits but never reaches sign-up; tab 3 only looks; tab 4 reaches sign-up and stops.
  step(1, 'home_viewed', 0, 'facebook'); step(1, 'story_started', 2, 'facebook'); step(1, 'story_submitted', 10, 'facebook')
  step(1, 'signup_reached', 11, 'facebook'); step(1, 'case_created', 14, 'facebook')
  step(2, 'home_viewed', 0, 'facebook'); step(2, 'story_started', 1, 'facebook'); step(2, 'story_submitted', 20, 'facebook')
  step(3, 'home_viewed', 5, null, 'desktop')
  step(4, 'home_viewed', 0, null); step(4, 'story_started', 1, null); step(4, 'story_submitted', 6, null); step(4, 'signup_reached', 7, null)
  step(1, 'home_viewed', 30, 'facebook')

  const view = summariseJourney(
    {
      funnel,
      accounts: [{ created_at: at(13) }],
      cases: [
        { id: 'case-a', created_at: at(14), first_touch: { utm_source: 'facebook', device_class: 'phone' } },
        { id: 'case-b', created_at: at(100), first_touch: null },
      ],
      evaluations: [{ case_id: 'case-a', created_at: at(74) }],
      interest: [{ created_at: at(80), source: 'stage2:bank_pack,stage2:fidrec_pack' }, { created_at: at(90), source: 'landing_page' }],
      purchases: [
        { case_id: 'case-a', product_code: 'self_serve_report', paid_at: at(134), payment_status: 'paid' },
        { case_id: 'case-a', product_code: 'escalation_pack', paid_at: null, payment_status: 'pending' },
      ],
    },
    30,
  )

  const count = (key: string) => view.steps.find((s) => s.key === key)!
  assert.equal(count('home_viewed').count, 4)
  assert.equal(count('story_submitted').count, 3)
  assert.equal(count('signup_reached').fromPrevious, 66.7)
  assert.equal(count('case_created').count, 1)
  assert.equal(count('evaluation_delivered').count, 1)
  assert.equal(count('bank_interest').count, 1)
  assert.equal(count('fidrec_interest').count, 1)
  assert.equal(count('bank_paid').count, 1)
  assert.equal(count('fidrec_paid').count, 0)
  assert.deepEqual(view.dropOff.map((d) => [d.count, d.of]), [[1, 3], [1, 2]])

  const source = view.splits.find((s) => s.dimension === 'UTM source')!
  assert.deepEqual(source.rows.find((r) => r.value === 'facebook')!.counts.story_submitted, 2)
  const evaluated = view.evaluationsByChannel.find((s) => s.dimension === 'UTM source')!
  assert.deepEqual(evaluated.rows.map((r) => [r.value, r.counts.cases, r.counts.evaluations]), [['facebook', 1, 1], ['(none)', 1, 0]])

  const time = (label: string) => view.timings.find((t) => t.label.startsWith(label))!
  assert.equal(time('Home viewed').medianMinutes, 10)
  assert.equal(time('Story submitted').medianMinutes, 4)
  assert.equal(time('Case created').medianMinutes, 60)
  assert.equal(time('Free evaluation → Bank').medianMinutes, 60)
  assert.equal(time('Free evaluation → FIDReC').count, 0)
})

test('percentile uses the nearest rank', () => {
  assert.equal(percentile([], 0.5), null)
  assert.equal(percentile([5, 1, 3, 2], 0.5), 2)
  assert.equal(percentile([5, 1, 3, 2], 0.75), 3)
})

test('the funnel table and the case column hold no personal fields', () => {
  const migration = readFileSync('supabase/migrations/20261115120000_funnel_events.sql', 'utf8')
  const table = migration.slice(migration.indexOf('create table'), migration.indexOf(');'))
  for (const forbidden of ['ip', 'user_agent', 'user_id', 'case_id', 'email', 'narrative', 'story']) {
    assert.doesNotMatch(table, new RegExp(`\\n\\s+${forbidden}\\b`), forbidden)
  }
  assert.match(migration, /revoke all on public\.funnel_events from anon, authenticated/)
  assert.match(migration, /first_touch - array\['referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'device_class'\] = '\{\}'::jsonb/)
})

test('Analytics 1 and its tracker are unchanged by Analytics 2', () => {
  for (const file of ['app/analytics/page.tsx', 'components/analytics/page-view-tracker.tsx', 'app/api/analytics/track/route.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /funnel_events|analytics2|trackFunnel/, file)
  }
  assert.match(readFileSync('app/analytics2/page.tsx', 'utf8'), /current_app_has_role[\s\S]*notFound\(\)/)
})
