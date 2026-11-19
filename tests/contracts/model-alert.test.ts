import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { alertEmail, confirmFailures, failureKind, type ModelCheck, type ModelHealth } from '../../lib/server/ai/model-health'

// The model alert says what actually went wrong (Elena, 19 Nov): on 17 Nov two OpenAI 504s produced emails telling her
// to change the model ID, which was not the problem.

const check = (status: number | null, model = 'gpt-4.1-mini'): ModelCheck =>
  ({ where: 'edge', use: 'run_case_extract_v4', provider: 'openai', model, status, ok: status !== null && status < 300 })
const health = (...checks: ModelCheck[]): ModelHealth =>
  ({ ok: checks.every((c) => c.ok), checks, checkedAt: '2026-11-19T00:00:00.000Z' })

test('each failure is classed by its cause', () => {
  assert.equal(failureKind(null), 'not-responding')
  assert.equal(failureKind(504), 'not-responding')
  assert.equal(failureKind(500), 'not-responding')
  assert.equal(failureKind(401), 'key-refused')
  assert.equal(failureKind(403), 'key-refused')
  assert.equal(failureKind(404), 'model-missing')
  assert.equal(failureKind(400), 'other')
})

test('a provider that does not answer gets the "not responding" email, not "change the model ID"', () => {
  const { subject, html } = alertEmail(health(check(504), check(null, 'text-embedding-3-small')), 'production')
  assert.equal(subject, 'GuideBuoy AI provider not responding (production)')
  assert.match(html, /did not answer in time, twice, a minute apart/)
  assert.match(html, /HTTP 504/)
  assert.match(html, /HTTP no response/)
  assert.doesNotMatch(html, /model setting is changed/)
})

test('a missing model and a refused key keep their own advice', () => {
  const { subject, html } = alertEmail(health(check(404), check(401, 'text-embedding-3-small'), check(200, 'gemini-3.8-flash')), 'staging')
  assert.equal(subject, 'GuideBuoy AI model unavailable (staging)')
  assert.match(html, /The model ID is not available to the deployed key[\s\S]*HTTP 404[\s\S]*changed to an available model ID/)
  assert.match(html, /The provider refused the deployed key[\s\S]*HTTP 401/)
  assert.doesNotMatch(html, /gemini-3\.8-flash/, 'healthy checks are not listed')
})

test('a provider that recovers within a minute sends nothing; one that stays down is reported', async () => {
  const waits: number[] = []
  const sleep = async (ms: number) => { waits.push(ms) }
  const runs = (...results: ModelHealth[]) => { let i = 0; return async () => results[Math.min(i++, results.length - 1)] }

  const recovered = await confirmFailures(runs(health(check(504)), health(check(200))), 60_000, sleep)
  assert.equal(recovered.ok, true)
  assert.deepEqual(waits, [60_000])

  const stillDown = await confirmFailures(runs(health(check(504)), health(check(503))), 60_000, sleep)
  assert.equal(stillDown.ok, false)
  assert.equal(stillDown.checks[0].status, 503)

  waits.length = 0
  const missing = await confirmFailures(runs(health(check(404))), 60_000, sleep)
  assert.equal(missing.checks[0].status, 404)
  assert.deepEqual(waits, [], 'a missing model is reported at once')
})

test('only the scheduled checks wait; the release health endpoint answers at once', () => {
  assert.match(readFileSync('instrumentation-node.ts', 'utf8'), /checkModelHealth\(\{ force: true, confirm: true \}\)/)
  assert.match(readFileSync('app/api/health/release/route.ts', 'utf8'), /checkModelHealth\(\)/)
})
