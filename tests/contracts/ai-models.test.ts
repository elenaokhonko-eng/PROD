import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { getOpenAiModel } from '../../lib/server/ai/generate-json'
import { isReachable } from '../../lib/server/ai/model-health'
import { CHECKED_MODEL_IDS, getGeminiModel } from '../../lib/server/ai/models'

// Google returns 404 for gemini-2.0-* and gemini-2.5-* on API keys created after their retirement for new users,
// which silently broke evidence processing and transcription on the November 2026 staging keys.
const retiredGeminiModel = /gemini-2\.(?:0|5)-(?:flash|pro)/

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

test('no app, lib or Edge function code defaults to a retired Gemini model', () => {
  const offenders = ['app', 'lib', 'supabase/functions']
    .flatMap(sources)
    .filter((path) => retiredGeminiModel.test(readFileSync(path, 'utf8')))
  assert.deepEqual(offenders, [])
})

test('OPENAI_MODEL is normalised to the lower-case model ID', () => {
  const previous = process.env.OPENAI_MODEL
  try {
    process.env.OPENAI_MODEL = ' GPT-4.1-mini '
    assert.equal(getOpenAiModel(), 'gpt-4.1-mini')
    delete process.env.OPENAI_MODEL
    assert.equal(getOpenAiModel(), 'gpt-4.1-mini')
  } finally {
    if (previous === undefined) delete process.env.OPENAI_MODEL
    else process.env.OPENAI_MODEL = previous
  }
})

const modelLiteral = /["'`]((?:gpt|gemini|text-embedding|o\d)-[0-9a-z.-]+)["'`]/g
const healthFunction = readFileSync('supabase/functions/ai_model_health_v1/index.ts', 'utf8')

function edgeModels() {
  const block = healthFunction.slice(healthFunction.indexOf('EDGE_MODELS'), healthFunction.indexOf('];'))
  return [...block.matchAll(/use: "([^"]+)", provider: "(\w+)", env: (?:"(\w+)"|null), fallback: "([^"]+)"/g)].map(
    ([, use, provider, env, fallback]) => ({ fn: use.split(' ')[0], provider, env, fallback }),
  )
}

test('the Edge model health check probes every model each Edge function uses, with the same default', () => {
  const listed = edgeModels()
  assert.ok(listed.length >= 6)
  for (const { fn, env, fallback } of listed) {
    const source = readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8')
    if (env) assert.ok(source.includes(`Deno.env.get("${env}") ?? "${fallback}"`), `${fn} defaults ${env} to ${fallback}`)
    else assert.ok(source.includes(`"${fallback}"`), `${fn} uses ${fallback}`)
  }
  for (const fn of readdirSync('supabase/functions').filter((name) => !name.startsWith('_') && name !== 'ai_model_health_v1')) {
    const source = readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8')
    for (const [, model] of source.matchAll(modelLiteral)) {
      assert.ok(
        listed.some((entry) => entry.fn === fn && entry.fallback === model),
        `${fn} uses ${model}, which ai_model_health_v1 doesn't check`,
      )
    }
  }
})

test('every default model ID, app and Edge, is in the verified list check-env-set enforces', () => {
  const app = ['app', 'lib'].flatMap(sources).flatMap((path) => [...readFileSync(path, 'utf8').matchAll(modelLiteral)].map((m) => m[1]))
  const edge = edgeModels().map((entry) => entry.fallback)
  const verified = new Set<string>(CHECKED_MODEL_IDS)
  assert.deepEqual([...new Set([...app, ...edge])].filter((model) => !verified.has(model)), [])
})

test('the Edge model health check reuses its result for 60 seconds', () => {
  assert.match(healthFunction, /const RESULT_CACHE_MS = 60_000;/)
  assert.match(healthFunction, /return jsonResponse\(\{ checks: await currentChecks\(\) \}\)/)
})

test('app model IDs come only from the settings the app model health check probes', () => {
  const allowed = new Set(['lib/server/ai/models.ts', 'lib/server/ai/generate-json.ts', 'lib/server/ai/generate-embedding.ts'])
  const offenders = ['app', 'lib', 'hooks', 'components']
    .flatMap(sources)
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => !allowed.has(path) && [...readFileSync(path, 'utf8').matchAll(modelLiteral)].length > 0)
  assert.deepEqual(offenders, [])
})

test('GOOGLE_GENERATIVE_AI_MODEL falls back when unset or blank', () => {
  const previous = process.env.GOOGLE_GENERATIVE_AI_MODEL
  try {
    process.env.GOOGLE_GENERATIVE_AI_MODEL = '  '
    assert.equal(getGeminiModel(), 'gemini-3.8-flash')
    process.env.GOOGLE_GENERATIVE_AI_MODEL = ' gemini-3.8-flash '
    assert.equal(getGeminiModel(), 'gemini-3.8-flash')
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_GENERATIVE_AI_MODEL
    else process.env.GOOGLE_GENERATIVE_AI_MODEL = previous
  }
})

test('a model counts as available on 2xx or 429 only', () => {
  for (const status of [200, 429]) assert.equal(isReachable(status), true)
  for (const status of [null, 400, 401, 403, 404, 500, 503]) assert.equal(isReachable(status), false)
})
