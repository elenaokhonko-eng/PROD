import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { type CostAlertStore, dueCostAlerts, evaluateCostAlerts, singaporeDay } from '../../lib/server/cost-alerts'
import { summariseCosts, USAGE_COLUMNS, type UsageRow } from '../../lib/server/cost-dashboard'

// Cost-controls spec §6 (Elena, 8 Nov): the admin cost page and the hourly cost alerts. Synthetic values only.

const NOW = new Date('2026-11-09T06:00:00Z') // 14:00 in Singapore
const CASE_A = 'a0000000-0000-4000-8000-0000000000c1'
const CASE_B = 'b0000000-0000-4000-8000-0000000000c2'
const row = (over: Partial<UsageRow>): UsageRow => ({
  created_at: '2026-11-09T02:00:00Z', purpose: 'summary', model: 'gpt-4o-mini-2024-07-18', outcome: 'ok',
  http_status: 200, estimated_cost_usd: 0.001, case_id: CASE_A, ...over,
})

test('the cost page summarises today and the last 7 days by purpose and model, with fallback rate and cost per evaluation', () => {
  const rows = [
    row({}),
    row({ purpose: 'fact_extraction', model: 'gpt-4.1-mini', estimated_cost_usd: '0.004' }),
    row({ purpose: 'evidence', model: 'gemini-3.8-flash', http_status: 429, estimated_cost_usd: 0, case_id: CASE_B }),
    // 15:00 on 8 Nov in Singapore: yesterday.
    row({ created_at: '2026-11-08T07:00:00Z', estimated_cost_usd: 0.01, case_id: CASE_B }),
  ]
  const events = [
    { event_name: 'free_evaluation_summary', created_at: '2026-11-09T02:00:00Z' },
    { event_name: 'free_evaluation_summary_version', created_at: '2026-11-08T07:00:00Z' },
  ]
  const d = summariseCosts('staging', rows, events, NOW)
  assert.equal(d.today.calls, 3)
  assert.equal(d.today.usd, 0.005)
  assert.equal(d.today.rateLimited, 1)
  assert.equal(d.today.evaluations, 1)
  assert.equal(d.today.costPerEvaluation, 0.005)
  assert.equal(d.today.fallbackRate, 0)
  assert.equal(d.week.calls, 4)
  assert.equal(d.week.fallbackRate, 0.5)
  assert.deepEqual(d.week.byPurpose.map((l) => l.key), ['summary', 'fact_extraction', 'evidence'])
  assert.deepEqual(d.topCases.map((c) => c.caseId), [CASE_B, CASE_A])
})

function store(over: Partial<CostAlertStore> & { sent?: string[] } = {}): CostAlertStore & { marked: string[] } {
  const marked: string[] = []
  return {
    marked,
    spendToday: async () => 0,
    caseSpendToday: async () => [],
    lastHourCalls: async () => ({ calls: 0, rateLimited: 0 }),
    alreadySent: async (kind) => (over.sent ?? []).includes(kind),
    markSent: async (kind, day) => { marked.push(`${kind}:${day}`) },
    ...over,
  }
}
const env = { MODEL_USAGE_ENVIRONMENT: 'staging', MODEL_DAILY_CAP_USD: '20', COST_ALERT_EMAIL: 'alerts@example.invalid' }

test('alerts fire at 80% of the daily cap, a case over US$2, and over 5% of at least 20 calls rate-limited', async () => {
  assert.deepEqual(await dueCostAlerts(store({ spendToday: async () => 15.99 }), env), [])
  assert.deepEqual((await dueCostAlerts(store({ spendToday: async () => 16 }), env)).map((a) => a.kind), ['daily_spend'])
  assert.deepEqual(await dueCostAlerts(store({ caseSpendToday: async () => [{ caseId: CASE_A, usd: 2 }] }), env), [])
  const single = await dueCostAlerts(store({ caseSpendToday: async () => [{ caseId: CASE_A, usd: 2.01 }] }), env)
  assert.deepEqual(single.map((a) => a.kind), ['single_case'])
  assert.match(single[0].text, new RegExp(`- ${CASE_A}: US\\$2\\.01`))
  assert.deepEqual(await dueCostAlerts(store({ lastHourCalls: async () => ({ calls: 19, rateLimited: 19 }) }), env), [], 'needs at least 20 calls')
  assert.deepEqual(await dueCostAlerts(store({ lastHourCalls: async () => ({ calls: 100, rateLimited: 5 }) }), env), [], '5% is not over 5%')
  assert.deepEqual((await dueCostAlerts(store({ lastHourCalls: async () => ({ calls: 100, rateLimited: 6 }) }), env)).map((a) => a.kind), ['rate_limited'])
})

test('each alert is emailed at most once per Singapore day, with numbers and case IDs only', async () => {
  const sentMail: Array<{ to: string; subject: string; text: string }> = []
  const send = async (a: { subject: string; text: string }, to: string) => { sentMail.push({ to, subject: a.subject, text: a.text }) }
  const s = store({ spendToday: async () => 25, caseSpendToday: async () => [{ caseId: CASE_A, usd: 3 }], sent: ['single_case'] })
  assert.deepEqual(await evaluateCostAlerts(s, env, send, NOW), ['daily_spend'])
  assert.deepEqual(s.marked, [`daily_spend:${singaporeDay(NOW)}`])
  assert.equal(sentMail[0].to, 'alerts@example.invalid')
  for (const m of sentMail) assert.match(`${m.subject}\n${m.text}`, /^[A-Za-z0-9 $.,:%()\-\/\n"'@]+$/, 'only numbers, IDs and fixed wording')
  assert.deepEqual(await evaluateCostAlerts(s, { ...env, COST_ALERT_EMAIL: '', ADMIN_EMAIL: '' }, send, NOW), [], 'no recipient, no alert')
  assert.equal(singaporeDay(new Date('2026-11-08T16:30:00Z')), '2026-11-09', 'the day turns at midnight Singapore time')
})

test('alerts and the cost page read only numeric and ID columns; the worker runs alerts hourly and never fatally', () => {
  const alerts = readFileSync('lib/server/cost-alerts.ts', 'utf8')
  const selects = [...alerts.matchAll(/\.select\("([^"]+)"\)/g)].map((m) => m[1])
  assert.deepEqual(selects, ['case_id, estimated_cost_usd', 'http_status', 'id'])
  assert.equal(USAGE_COLUMNS, 'created_at, purpose, model, outcome, http_status, estimated_cost_usd, case_id')
  const dashboard = readFileSync('lib/server/cost-dashboard.ts', 'utf8')
  assert.deepEqual([...dashboard.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]), ['model_usage', 'analytics_events'])
  assert.match(dashboard, /\.select\("event_name, created_at"\)/)
  const worker = readFileSync('worker/index.ts', 'utf8')
  assert.match(worker, /setInterval\(\(\) => void runCostAlerts\(\), COST_ALERT_INTERVAL_MS\)\.unref\(\)/)
  assert.match(worker, /async function runCostAlerts\(\): Promise<void> \{\s*try \{[\s\S]*?\} catch \(err\) \{/)
})

test('the cost page is behind the existing admin check: non-admins get 404 before any model_usage read', () => {
  const page = readFileSync('app/analytics/page.tsx', 'utf8')
  const gate = page.indexOf('if (roleError || !isAdmin) notFound()')
  assert.ok(gate > 0, 'admin role check')
  assert.ok(page.indexOf('if (!currentUser) notFound()') < gate)
  assert.match(page, /rpc\("current_app_has_role", \{\s*p_role: "admin",\s*\}\)/)
  assert.ok(page.indexOf('loadCostDashboard(') > gate, 'costs are loaded only after the admin check')
})
