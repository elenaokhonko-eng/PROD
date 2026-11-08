import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { clientIp } from '../../lib/rate-limit'
import { bundleFindings, publicNameFindings } from '../../scripts/check-client-bundle.mts'

// Cost-controls spec (approved 8 Nov): §3 A1 no server key in the browser; §5 B1/B2 limits on everything that starts
// model work; B5/B6 caps and metering on the web routes' Gemini calls; privacy export of the metering. Synthetic values.

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const headers = (h: Record<string, string>) => new Headers(h)

test('the client address is never the client-set first X-Forwarded-For entry', () => {
  assert.equal(clientIp(headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }), null, false), '203.0.113.9', 'right-most, added by the proxy')
  assert.equal(clientIp(headers({ 'x-forwarded-for': '203.0.113.9' }), null, false), '203.0.113.9')
  assert.equal(clientIp(headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1, 172.64.0.1' }), null, true), '198.51.100.7', 'behind Cloudflare')
  assert.equal(clientIp(headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.9' }), null, false), '203.0.113.9', 'a forged CF header is ignored without Cloudflare')
  assert.equal(clientIp(headers({}), '192.0.2.1', false), '192.0.2.1')
})

test('limits default to the spec and can be raised per environment', async () => {
  const { USAGE_LIMITS, LIMIT_MESSAGE } = await import('../../lib/server/usage-limits')
  const keys = ['USAGE_LIMIT_CASES_PER_ACCOUNT_PER_DAY', 'USAGE_LIMIT_EVALUATIONS_PER_CASE_PER_DAY'] as const
  const saved = keys.map((k) => process.env[k])
  try {
    for (const k of keys) delete process.env[k]
    assert.deepEqual(
      { cases: USAGE_LIMITS.casesPerAccountPerDay, evaluations: USAGE_LIMITS.evaluationsPerCasePerDay, uploads: USAGE_LIMITS.documentUploadsPerAccountPerDay, ip: USAGE_LIMITS.modelRequestsPerIpPerHour, preSignIn: USAGE_LIMITS.preSignInRequestsPerIpPerHour },
      { cases: 5, evaluations: 3, uploads: 20, ip: 30, preSignIn: 10 },
    )
    process.env.USAGE_LIMIT_CASES_PER_ACCOUNT_PER_DAY = '12'
    assert.equal(USAGE_LIMITS.casesPerAccountPerDay, 12)
    process.env.USAGE_LIMIT_CASES_PER_ACCOUNT_PER_DAY = 'nonsense'
    assert.equal(USAGE_LIMITS.casesPerAccountPerDay, 5)
  } finally {
    keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])))
  }
  assert.equal(LIMIT_MESSAGE, "You've reached today's limit. Please try again tomorrow, or email info@guidebuoyai.sg.")
})

test('signed-in model work is limited per account (database) and per IP: cases, uploads, free evaluations', () => {
  const bootstrap = read('app/api/cases/bootstrap/route.ts')
  assert.match(bootstrap, /if \(await overCaseLimit\(user\.supabaseUuid\)\) return limitResponse\(\)\n\s*if \(overIpModelLimit\(req\)\) return limitResponse\(HOURLY_LIMIT_MESSAGE\)/)
  const upload = read('app/api/evidence/upload/route.ts')
  assert.match(upload, /if \(await overUploadLimit\(user\.supabaseUuid\)\) return limitResponse\(\)\n\s*if \(overIpModelLimit\(request\)\) return limitResponse\(HOURLY_LIMIT_MESSAGE\)/)
  const tier0 = read('app/api/edge/tier0/route.ts')
  assert.match(tier0, /if \(await overEvaluationLimit\(caseId, access\.profileId\)\) return limitResponse\(\)/)
  assert.ok(tier0.indexOf('overEvaluationLimit(') > tier0.indexOf('loadCurrentSnapshot('), 'a stale request still gets 409 before the limit')
  assert.ok(tier0.indexOf('overEvaluationLimit(') < tier0.indexOf('proxyEdgeFunction('), 'checked before the model is called')
  const limits = read('lib/server/usage-limits.ts')
  assert.match(limits, /\.from\("cases"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("user_id", profileId\)/)
  assert.match(limits, /\.from\("evidence"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("user_id", profileId\)/)
  assert.match(limits, /\.in\("event_name", \["free_evaluation_summary", "free_evaluation_summary_version"\]\)\s*\.eq\("event_data->>case_id", caseId\)/)
})

test('people see the limit message, not a generic error', () => {
  assert.match(read('components/state-machine/facts/confirm-and-evaluate.tsx'), /reason === 'usage_limit'\s*\?\s*generate\.error\.message/)
  assert.match(read('hooks/state-machine/layer1/use-upload-evidence.ts'), /if \(uploadResponse\.status === 429 && uploadJson\?\.error\) throw new UsageLimitError\(uploadJson\.error\)/)
  assert.match(read('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx'), /uploadEvidence\.error instanceof UsageLimitError\s*\?\s*uploadEvidence\.error\.message/)
  assert.match(read('app/(auth)/onboarding/page.tsx'), /response\.status === 429 && data\?\.error/)
  for (const page of ['app/router/classify/page.tsx', 'app/router/questions/page.tsx']) assert.match(read(page), /response\.status === 429/, page)
})

test('model calls before sign-in are limited per IP, capped, metered and stop at the daily cap', () => {
  for (const [route, purpose, cap] of [
    ['app/api/router/classify/route.ts', 'router_classify', 'router'],
    ['app/api/router/questions/route.ts', 'router_questions', 'router'],
    ['app/api/transcribe/route.ts', 'transcription', 'transcription'],
  ] as const) {
    const src = read(route)
    assert.match(src, /if \(overPreSignInLimit\((?:request|req)\)\) return limitResponse\(HOURLY_LIMIT_MESSAGE\)/, route)
    assert.match(src, new RegExp(`cappedConfig\\([^)]*OUTPUT_CAPS\\.${cap}, GEMINI_THINKING_BUDGET\\.${cap}\\)`), route)
    assert.match(src, new RegExp(`meteredGenerate\\(model, [^)]+, \\{ purpose: "${purpose}", modelName \\}\\)`), route)
    assert.match(src, /\(await currentBreaker\(\)\)\.state === "open"/, route)
    assert.doesNotMatch(src, /model\.generateContent\(/, `${route}: every call goes through the meter`)
  }
  assert.match(read('app/api/triage/analyze/route.ts'), /if \(overPreSignInLimit\(request\)\) return limitResponse\(HOURLY_LIMIT_MESSAGE\)/)
  const transcribe = read('app/api/transcribe/route.ts')
  assert.match(transcribe, /if \(file\.size > MAX_AUDIO_BYTES\) \{[\s\S]*?status: 413/)
  assert.doesNotMatch(transcribe, /error: message/, 'no raw error text to the browser')
  const meter = read('lib/server/ai/gemini-metered.ts')
  assert.match(meter, /maxOutputTokens, thinkingConfig: \{ thinkingBudget \}/)
  assert.match(meter, /outcome: "ok"[\s\S]*outcome: status === 429 \? "retry" : "error"/, 'failures are recorded too')
})

test('§3 A1: the client-bundle check finds server secrets and runs in CI after the build', () => {
  const fake = (body: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(body).toString('base64url')}.c2lnbmF0dXJlLXN5bnRoZXRpYw`
  const files: Array<[string, string]> = [
    ['a.js', 'const k = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX123"'],
    ['b.js', `const t = "${fake('{"role":"service_role","iss":"synthetic"}')}"`],
    ['c.js', `const t = "${fake('{"role":"anon","iss":"synthetic"}')}"`],
    ['d.js', 'x="synthetic-server-key-value-0001"'],
    ['e.js', 'const g = "AIzaSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS"'],
  ]
  const found = bundleFindings(files, { OPENAI_API_KEY: 'synthetic-server-key-value-0001', CLERK_SECRET_KEY: 'sk_test_build_placeholder' })
  assert.deepEqual(found.sort(), ['Google API key (AIza…) in e.js', 'OpenAI key (sk-…) in a.js', 'service_role JWT in b.js', 'value of OPENAI_API_KEY in d.js'].sort())
  assert.deepEqual(publicNameFindings(['process.env.NEXT_PUBLIC_SUPABASE_URL process.env.NEXT_PUBLIC_OPENAI_KEY']), ['NEXT_PUBLIC_ variable looks like a server secret: NEXT_PUBLIC_OPENAI_KEY'])
  const workflow = read('.github/workflows/harbor-release-gates.yml')
  assert.match(workflow, /- name: Production build\n\s+run: pnpm build\n\s+- name: No server secret in the client bundle\n\s+run: pnpm exec tsx scripts\/check-client-bundle\.mts/)
})

test('the privacy export includes the model-call metering for the person\'s cases and account', () => {
  const route = read('app/api/privacy/export/route.ts')
  assert.match(route, /service\.from\("model_usage"\)\.select\(MODEL_USAGE_COLUMNS\)\.in\("case_id", caseIds\)/)
  assert.match(route, /service\.from\("model_usage"\)\.select\(MODEL_USAGE_COLUMNS\)\.eq\("user_id", profileId\)/)
  assert.match(route, /model_usage: usageResult\.data,/)
  assert.match(route, /modelUsageFor\(ownedCaseIds, user\.supabaseUuid\)/, 'scoped to the cases the user\'s own client returned')
})
