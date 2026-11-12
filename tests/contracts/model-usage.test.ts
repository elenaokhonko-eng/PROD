import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  backoffMs,
  breakerFor,
  dailyBreaker,
  dailyCapUsd,
  estimateCostUsd,
  geminiUsage,
  openAiUsage,
  recordModelUsage,
  type UsageClient,
  usageEnvironment,
} from '../../supabase/functions/_shared/model-usage'

// Cost-controls spec §5 (approved 8 Nov): metering, the daily breaker, output caps and backoff.

test('costs follow the inventory prices, with cached input and thinking tokens counted correctly', () => {
  assert.equal(estimateCostUsd('gpt-4.1-mini', { inputTokens: 1_000_000, outputTokens: 0 }), 0.4)
  assert.equal(estimateCostUsd('gpt-4.1-mini', { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 }), 0.1)
  assert.equal(estimateCostUsd('gpt-4o-mini-2024-07-18', { inputTokens: 0, outputTokens: 1_000_000 }), 0.6)
  assert.equal(estimateCostUsd('gemini-3.8-flash', { inputTokens: 1_000_000, outputTokens: 0 }, new Date('2026-12-31T12:00:00+08:00')), 0.75)
  assert.equal(estimateCostUsd('gemini-3.8-flash', { inputTokens: 1_000_000, outputTokens: 0 }, new Date('2027-01-01T00:00:00+08:00')), 1.5)
  assert.equal(estimateCostUsd('some-new-model', { inputTokens: 0, outputTokens: 1_000_000 }), 8, 'unknown models are priced high')
  assert.deepEqual(openAiUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } }), { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5 })
  assert.deepEqual(openAiUsage({ usage: { input_tokens: 7, output_tokens: 3, input_tokens_details: { cached_tokens: 0 } } }), { inputTokens: 7, cachedInputTokens: 0, outputTokens: 3 })
  assert.deepEqual(geminiUsage({ usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, thoughtsTokenCount: 6 } }), { inputTokens: 9, cachedInputTokens: 0, outputTokens: 10 })
  assert.deepEqual(openAiUsage(null), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 })
})

test('the daily breaker warns at 80% and opens at 100% of a cap of at least US$20', async () => {
  assert.equal(dailyCapUsd({}), 20)
  assert.equal(dailyCapUsd({ MODEL_DAILY_CAP_USD: '5' }), 20, 'never below the spec minimum')
  assert.equal(dailyCapUsd({ MODEL_DAILY_CAP_USD: '50' }), 50)
  assert.equal(breakerFor(15.99, 20).state, 'ok')
  assert.equal(breakerFor(16, 20).state, 'warn')
  assert.equal(breakerFor(20, 20).state, 'open')
  const spent = (value: unknown, error: unknown = null) => ({ from: () => ({ insert: async () => ({ error: null }) }), rpc: async () => ({ data: value, error }) }) as unknown as UsageClient
  assert.equal((await dailyBreaker(spent(21), 'staging', {})).state, 'open')
  assert.equal((await dailyBreaker(spent(null, { code: 'x' }), 'staging', {})).state, 'ok', 'a metering outage does not stop the service')
})

test('a usage row holds numbers and IDs only, and recording never throws', async () => {
  const rows: Array<Record<string, unknown>> = []
  const client = { from: () => ({ insert: async (row: Record<string, unknown>) => { rows.push(row); return { error: null } } }), rpc: async () => ({ data: 0, error: null }) } as unknown as UsageClient
  await recordModelUsage(client, 'staging', { caller: 'web', purpose: 'fact_extraction', provider: 'openai', model: 'gpt-4.1-mini', usage: { inputTokens: 100, outputTokens: 50 }, outcome: 'ok', caseId: '00000000-0000-4000-8000-000000000001', userId: 'not-a-uuid' })
  assert.deepEqual(Object.keys(rows[0]).sort(), ['cached_input_tokens', 'caller', 'case_id', 'environment', 'estimated_cost_usd', 'http_status', 'input_tokens', 'job_id', 'latency_ms', 'model', 'outcome', 'output_tokens', 'provider', 'purpose', 'user_id'])
  assert.equal(rows[0].user_id, null, 'only UUIDs are stored as IDs')
  const broken = { from: () => ({ insert: async () => { throw new Error('down') } }), rpc: async () => ({ data: 0, error: null }) } as unknown as UsageClient
  await recordModelUsage(broken, 'staging', { caller: 'web', purpose: 'x', provider: 'openai', model: 'm', outcome: 'ok' })
})

test('the environment comes from the deployment or the Supabase project; backoff honours Retry-After', () => {
  assert.equal(usageEnvironment({ HARBOR_DEPLOYMENT_ENVIRONMENT: 'production' }), 'production')
  assert.equal(usageEnvironment({ GUIDEBUOY_URL: 'https://ottnvtqltxinxasedbjp.supabase.co' }), 'production')
  assert.equal(usageEnvironment({ SUPABASE_URL: 'https://yqqkkftfddxuxmpxwbcj.supabase.co' }), 'staging')
  assert.equal(usageEnvironment({}), 'development')
  assert.equal(backoffMs(1, '3'), 3000)
  for (let i = 0; i < 20; i++) assert.ok(backoffMs(3, null, 500, 8000) < 2000)
})

test('every stage-1 model call is metered and capped', () => {
  const read = (p: string) => readFileSync(p, 'utf8')
  assert.match(read('lib/server/ai/generate-json.ts'), /await recordUsage\(\{ \.\.\.meter, outcome: "ok", usage: openAiUsage\(response\)/)
  assert.match(read('lib/server/ai/generate-json.ts'), /throw new ModelBudgetExceeded\(\)/)
  assert.match(read('supabase/functions/run_case_extract_v4/index.ts'), /max_output_tokens: OUTPUT_CAPS\.case_extraction/)
  assert.match(read('supabase/functions/run_case_extract_v4/index.ts'), /purpose: "case_extraction"/)
  const evidence = read('supabase/functions/evidence_processed_v2/index.ts')
  assert.match(evidence, /max_output_tokens: OUTPUT_CAPS\.evidence,\s*thinking_config: \{ thinking_budget: GEMINI_THINKING_BUDGET\.evidence \}/)
  assert.match(evidence, /purpose: "evidence"/)
  assert.match(read('supabase/functions/bright-function/index.ts'), /purpose: "summary"/)
})
