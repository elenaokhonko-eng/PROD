import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  chatSummary,
  fallbackSummary,
  FALLBACK_INTRO,
  isHardCheck,
  produceSummary,
  ProviderFailure,
  type SnapshotFacts,
  validateOutput,
  type ValidateOptions,
} from '../../lib/facts'

// Free-evaluation hardening (8 Nov): a checker rejection or a provider failure ends in the summary version, never in
// "failed". All facts and texts are synthetic.

const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const event = (value: 'yes' | 'no', date: string | null) => ({ value, date, reference: null, channel: null })
const facts: SnapshotFacts = {
  scam_type: { value: ['phishing'], label: 'confirmed' },
  phishing_channel: { value: 'sms', label: 'confirmed' },
  institution_names: { value: [{ name: 'Synthetic Bank', type: 'bank' }], label: 'confirmed' },
  total_loss: { value: { ...sgd(3000), account: null, portions: [{ amount: sgd(2400), account: 'savings_or_current' }, { amount: sgd(600), account: 'credit_card' }] }, label: 'confirmed' },
  transactions: { value: null, label: 'not_sure' },
  date_discovered: { value: '2026-10-03', label: 'confirmed' },
  reported_to_bank: { value: event('yes', '2026-10-03'), label: 'confirmed' },
  reported_to_police: { value: event('yes', '2026-10-04'), label: 'claimant_only' },
}
const options: ValidateOptions = { secondPerson: true, userFacing: { minWords: 8, maxWords: 200 } }
const GOOD = 'On 3 Oct 2026 you received an SMS and lost S$3,000 in total from your Synthetic Bank accounts. You told Synthetic Bank the same day.'

function scripted(...outputs: Array<string | ProviderFailure>) {
  const calls: Array<string | null> = []
  return {
    calls,
    generate: async (previous: string | null) => {
      calls.push(previous)
      const next = outputs[calls.length - 1]
      if (next instanceof ProviderFailure) throw next
      return next
    },
  }
}

test('hard and soft rules are classified as agreed: facts are hard, style is soft', () => {
  for (const check of ['amount', 'date', 'institution', 'reference', 'contradiction', 'unqualified', 'forbidden'] as const) assert.ok(isHardCheck(check), check)
  for (const check of ['person', 'internal', 'length'] as const) assert.ok(!isHardCheck(check), check)
})

test('a faithful first answer is delivered as written', async () => {
  const model = scripted(GOOD)
  const result = await produceSummary({ facts, options, generate: model.generate })
  assert.equal(result.source, 'model')
  assert.equal(result.summary, GOOD)
  assert.deepEqual(model.calls, [null])
})

test('a soft violation is regenerated with the violation fed back', async () => {
  const model = scripted(GOOD.replace('you received', 'the user received'), GOOD)
  const result = await produceSummary({ facts, options, generate: model.generate })
  assert.equal(result.source, 'model')
  assert.equal(result.attempts, 2)
  assert.match(model.calls[1]!, /^- person: write to the person as "you"/)
  assert.deepEqual(result.firedChecks, [['person'], []])
})

test('internal names and field names are a soft violation', () => {
  assert.deepEqual(validateOutput(['You confirmed reported_to_bank on 3 Oct 2026 with Synthetic Bank.'], facts, options).map((f) => f.check), ['internal'])
  assert.deepEqual(validateOutput(['The Tier-0 evaluation found that you lost S$3,000.'], facts, options).map((f) => f.check), ['internal'])
  assert.deepEqual(validateOutput(['Short.'], facts, options).map((f) => f.check), ['length'])
})

test('a document-less fact stated as certain is repaired in code, without another model call', async () => {
  const model = scripted(`${GOOD} You reported it to the police on 4 Oct 2026.`)
  const result = await produceSummary({ facts, options, generate: model.generate })
  assert.equal(result.source, 'model')
  assert.equal(model.calls.length, 1)
  assert.match(result.summary, /You told us that you reported it to the police on 4 Oct 2026\./)
})

test('a hard violation regenerates once; still failing, the summary version is delivered and the text is never shown', async () => {
  const wrong = 'You lost S$9,999 to an SMS scam and told Synthetic Bank on 3 Oct 2026.'
  const model = scripted(wrong, wrong)
  const result = await produceSummary({ facts, options, generate: model.generate })
  assert.equal(result.source, 'fallback')
  assert.equal(result.fallbackReason, 'checks')
  assert.deepEqual(result.hardChecks, ['amount'])
  assert.equal(model.calls.length, 2)
  assert.doesNotMatch(result.summary, /9,999/)
  assert.ok(result.summary.startsWith(FALLBACK_INTRO))
})

test('a provider failure after its retry delivers the summary version', async () => {
  for (const kind of ['rate_limited', 'provider_error', 'timeout', 'malformed', 'empty', 'refusal'] as const) {
    const result = await produceSummary({ facts, options, generate: scripted(new ProviderFailure(kind)).generate })
    assert.equal(result.source, 'fallback', kind)
    assert.equal(result.fallbackReason, kind)
  }
  const later = await produceSummary({ facts, options, generate: scripted(GOOD.replace('you received', 'the user received'), new ProviderFailure('timeout')).generate })
  assert.equal(later.fallbackReason, 'timeout')
})

test('the summary version states only confirmed facts, with the same qualifiers, and passes the value checks', () => {
  const text = fallbackSummary(facts)
  assert.match(text, /- Amount lost: S\$3,000 in total: .*S\$2,400, .*S\$600/)
  assert.match(text, /- The payments you dispute: not sure/)
  assert.match(text, /- Whether you reported this to the police: you told us: Yes, 4 Oct 2026 \(no document yet\)/)
  const valueChecks = validateOutput([text], facts, { secondPerson: true }).filter((f) => ['amount', 'date', 'institution', 'person', 'internal'].includes(f.check))
  assert.deepEqual(valueChecks, [])
  const empty = fallbackSummary({ scam_type: { value: null, label: 'not_sure' } })
  assert.match(empty, /How it started\n- Type of scam: not sure$/)
})

function fakeFetch(...responses: Array<Response | Error>) {
  let i = 0
  const fn = (async () => {
    const r = responses[Math.min(i++, responses.length - 1)]
    if (r instanceof Error) throw r
    return r.clone()
  }) as unknown as typeof fetch
  return { fn, count: () => i }
}
const ok = (content: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, ...extra }] }), { status: 200 })
const req = (f: typeof fetch) => ({ fetch: f, apiKey: 'test', model: 'm', system: 's', user: 'u', deadline: Date.now() + 60_000, sleep: async () => {} })

test('provider responses: 429 and 5xx retry once, then fail; malformed or empty output retries; refusal does not', async () => {
  const retried = fakeFetch(new Response('', { status: 429 }), ok({ summary: GOOD }))
  assert.equal(await chatSummary(req(retried.fn)), GOOD)
  assert.equal(retried.count(), 2)

  const down = fakeFetch(new Response('', { status: 503 }))
  await assert.rejects(chatSummary(req(down.fn)), (e: ProviderFailure) => e.kind === 'provider_error' && e.status === 503)
  assert.equal(down.count(), 2)

  const malformed = fakeFetch(ok('{"summary": "cut off'), ok({ summary: GOOD }))
  assert.equal(await chatSummary(req(malformed.fn)), GOOD)

  const empty = fakeFetch(ok(''))
  await assert.rejects(chatSummary(req(empty.fn)), (e: ProviderFailure) => e.kind === 'empty')

  const noSummary = fakeFetch(ok({ other: 'x' }))
  await assert.rejects(chatSummary(req(noSummary.fn)), (e: ProviderFailure) => e.kind === 'empty')

  const refused = fakeFetch(new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: "I can't help with that." } }] }), { status: 200 }))
  await assert.rejects(chatSummary(req(refused.fn)), (e: ProviderFailure) => e.kind === 'refusal')
  assert.equal(refused.count(), 1)

  const filtered = fakeFetch(ok('', { finish_reason: 'content_filter' }))
  await assert.rejects(chatSummary(req(filtered.fn)), (e: ProviderFailure) => e.kind === 'refusal')

  const timedOut = fakeFetch(new DOMException('aborted', 'TimeoutError'))
  await assert.rejects(chatSummary(req(timedOut.fn)), (e: ProviderFailure) => e.kind === 'timeout')
  assert.equal(timedOut.count(), 2)

  const late = fakeFetch(ok({ summary: GOOD }))
  await assert.rejects(chatSummary({ ...req(late.fn), deadline: Date.now() + 1_000 }), (e: ProviderFailure) => e.kind === 'timeout')
  assert.equal(late.count(), 0)
})

test('provider errors never carry the response text, and the review log holds IDs and check names only', () => {
  assert.equal(new ProviderFailure('provider_error', 500).message, 'provider provider_error 500')
  const fn = readFileSync('supabase/functions/bright-function/index.ts', 'utf8')
  const review = /const review = \{([\s\S]*?)\n    \};/.exec(fn)?.[1] ?? ''
  const fields = [...review.matchAll(/^\s+(\w+)[,:]/gm)].map((m) => m[1])
  assert.deepEqual(fields, ['case_id', 'fact_snapshot_id', 'source', 'fallback_reason', 'attempts', 'fired_checks', 'hard_checks', 'model', 'prompt_version', 'release'])
  assert.doesNotMatch(fn, /output_validation_failed/, 'a checker rejection no longer fails the request')
  assert.match(fn, /title: result\.source === "fallback" \? FALLBACK_TITLE : "Free evaluation summary"/)
  assert.match(fn, /const TIER0_MODEL = \(Deno\.env\.get\("TIER0_MODEL"\) \?\? "gpt-4o-mini-2024-07-18"\)/, 'the model is pinned to a dated snapshot')
})

test('the summary version replaces the same row as a model summary (one tier0_summary per case)', () => {
  const fn = readFileSync('supabase/functions/bright-function/index.ts', 'utf8')
  const summaryWrite = /narrative_type: "tier0_summary",[\s\S]*?source_ref,\n/.exec(fn.replace(/\r\n/g, '\n'))
  assert.ok(summaryWrite, 'the summary is written with the run source_ref, marked only by its title')
  assert.doesNotMatch(fn, /summary-version`/)
})

test('cost controls: the summary call is capped, switches model on a rate limit, and reports every attempt without text (8 Nov)', async () => {
  const bodies: Array<{ model: string; max_tokens?: number }> = []
  const responses = [new Response('', { status: 429, headers: { 'retry-after': '1' } }), ok({ summary: GOOD }, {})]
  let i = 0
  const fn = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return responses[i++].clone()
  }) as unknown as typeof fetch
  const calls: Array<{ model: string; kind: string; httpStatus: number | null }> = []
  const slept: number[] = []
  const summary = await chatSummary({
    ...req(fn), model: 'main-model', secondaryModel: 'second-model', maxTokens: 800,
    sleep: async (ms) => { slept.push(ms) },
    onCall: (c) => { calls.push({ model: c.model, kind: c.kind, httpStatus: c.httpStatus }) },
  })
  assert.equal(summary, GOOD)
  assert.deepEqual(bodies.map((b) => [b.model, b.max_tokens]), [['main-model', 800], ['second-model', 800]])
  assert.deepEqual(slept, [], 'no waiting before the secondary model')
  assert.deepEqual(calls, [{ model: 'main-model', kind: 'rate_limited', httpStatus: 429 }, { model: 'second-model', kind: 'ok', httpStatus: 200 }])

  // Without a secondary model, a retry waits as the provider asks (Retry-After), with jittered backoff otherwise.
  const waits: number[] = []
  const again = [new Response('', { status: 429, headers: { 'retry-after': '1' } }), ok({ summary: GOOD }, {})]
  let j = 0
  const fn2 = (async () => again[j++].clone()) as unknown as typeof fetch
  await chatSummary({ ...req(fn2), sleep: async (ms) => { waits.push(ms) } })
  assert.deepEqual(waits, [1000])
})
