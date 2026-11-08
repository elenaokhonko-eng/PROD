// Free-evaluation corpus run (hardening item 2, 8 Nov): every synthetic story goes through the production code for
// fact extraction, reconciliation, the snapshot and the summary ladder, against the real models, N times. It reports
// how often each check fires, how often the summary version is used, and an independent judge's view of every
// summary that was delivered (a hard-rule bypass is a delivered summary the judge finds contradicting the facts).
//
//   node_modules/.bin/tsx scripts/tier0-corpus/run.ts [--runs 3] [--only id,id] [--concurrency 4]
//
// Needs OPENAI_API_KEY (extraction, judge) and GuideBuoy_EdgeFunction or OPENAI_API_KEY (summary) in the
// environment or .env.staging.local. Results go to test-results/tier0-corpus/<time>/ (git-ignored): results.json has
// the generated texts for review; summary.md has counts only.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildFactExtractionPrompt,
  buildSnapshot,
  buildTier0Input,
  chatSummary,
  documentedFacts,
  type CurrentFinding,
  type FactCandidate,
  isHardCheck,
  MULTI_SELECT_FACT_KEYS,
  type OutputCheck,
  parseFactExtraction,
  produceSummary,
  reconcile,
  type Resolution,
  TIER0_CHECKS,
  TIER0_DEFAULT_MODEL,
  tier0System,
  validateOutput,
} from '@/lib/facts'
import { generateJson, getOpenAiModel } from '@/lib/server/ai/generate-json'
import { type CorpusStory, STORIES } from './stories'

function loadEnv() {
  try {
    for (const line of readFileSync('.env.staging.local', 'utf8').split(/\r?\n/)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // Environment only.
  }
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

type RunRecord = {
  id: string
  run: number
  tags: string[]
  ok: boolean
  stage?: 'extraction' | 'snapshot' | 'summary' | 'judge'
  error?: string
  blocked?: string[]
  labels?: Record<string, string>
  facts?: unknown
  findings?: unknown
  source?: 'model' | 'fallback'
  fallbackReason?: string | null
  attempts?: number
  firedChecks?: OutputCheck[][]
  firedDetails?: Array<Array<{ check: string; detail: string }>>
  summary?: string
  judge?: Array<{ kind: string; quote: string }>
  ms: { extraction: number; summary: number }
}

const JUDGE_MODEL = 'gpt-4.1-2025-04-14'


// Several values from the same source (a story listing the amount per account) are parts of one answer, which a
// person ticks together on the multi-select card; a story and a document disagreeing are alternatives.
function partsOfOneAnswer(f: CurrentFinding): boolean {
  if (!MULTI_SELECT_FACT_KEYS.has(f.factKey)) return false
  const kinds = f.values.map((v) => [...new Set(v.sources.map((s) => s.sourceType))].sort().join('+'))
  return new Set(kinds).size === 1
}

function settle(findings: CurrentFinding[], policy: CorpusStory['policy']): CurrentFinding[] {
  return findings.map((f) => {
    let resolution: Resolution | null = null
    if (policy === 'unsure') resolution = { kind: 'not_sure' }
    else if (f.findingType === 'agreed') resolution = null
    else if (f.findingType === 'conflict') {
      const docIndex = f.values.findIndex((v) => v.sources.some((s) => s.sourceType === 'document'))
      resolution = policy === 'prefer_documents' && docIndex >= 0
        ? { kind: 'choice', index: docIndex }
        : partsOfOneAnswer(f) ? { kind: 'choices', indices: f.values.map((_, i) => i) } : { kind: 'choice', index: 0 }
    } else if (f.findingType === 'unsupported') resolution = { kind: 'acknowledged' }
    else if (f.findingType === 'missing') resolution = { kind: 'not_sure' }
    return { ...f, resolution, status: resolution ? (resolution.kind === 'not_sure' ? 'not_sure' : 'resolved') : f.status }
  })
}

async function judge(facts: unknown, story: string | null, summary: string): Promise<Array<{ kind: string; quote: string }>> {
  const prompt = `You audit a summary written to a scam victim against the facts they confirmed. Statuses: "confirmed" may be stated as fact; "claimant_only" must be attributed to the person (e.g. "You told us that", "you say", "you reported"); "not_sure"/"not_known" must not be stated as known.
The person's own STORY may be used for background and the order of events (what the message said, what they clicked, who called): that is not a problem. A problem is a specific amount, date, institution, reference or yes/no event (told the bank, reported to police, bank replied) that is not in FACTS or differs from FACTS, or a FACTS value stated with the wrong certainty. An amount equal to the sum of confirmed payments is supported.
List every problem in the summary of these kinds only:
- "contradiction": states something that contradicts a confirmed fact (different amount, date, institution, yes/no).
- "invented": states a specific amount, date, institution, reference or event that is not in the facts.
- "unqualified": states a claimant_only, not_sure or not_known fact as certain.
Ignore style. Quote the exact sentence. Return JSON {"issues":[{"kind":"...","quote":"..."}]} and an empty list if there are none.

FACTS:
${JSON.stringify(facts, null, 2)}

STORY (null if withheld):
${story ?? 'null'}

SUMMARY:
${summary}`
  // A stronger model than the one under test, at temperature 0.
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: JUDGE_MODEL, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!resp.ok) throw new Error(`judge ${resp.status}`)
  const out = JSON.parse((await resp.json()).choices[0].message.content) as { issues?: Array<{ kind: string; quote: string }> }
  return Array.isArray(out?.issues) ? out.issues : []
}

async function runOne(story: CorpusStory, run: number): Promise<RunRecord> {
  const record: RunRecord = { id: story.id, run, tags: story.tags, ok: false, ms: { extraction: 0, summary: 0 } }
  const t0 = Date.now()
  let candidates: FactCandidate[] = []
  try {
    const sources = [
      { sourceType: 'story' as const, text: story.story, sourceRef: { sourceKey: `story:${story.id}` } },
      ...(story.documents ?? []).map((d, i) => ({ sourceType: 'document' as const, text: d.text, sourceRef: { sourceKey: `document:${story.id}:${i}`, fileName: d.name } })),
    ]
    for (const source of sources) {
      const raw = await generateJson({ prompt: buildFactExtractionPrompt(source.sourceType, source.text), schemaName: `facts_${source.sourceType}`, timeoutMs: 30_000, maxRetries: 1 })
      candidates.push(...parseFactExtraction(raw, source.text, { sourceType: source.sourceType, sourceRef: source.sourceRef }))
    }
  } catch (e) {
    return { ...record, stage: 'extraction', error: e instanceof Error ? e.message.slice(0, 200) : 'extraction failed' }
  }
  record.ms.extraction = Date.now() - t0

  const reconciled = await reconcile(candidates)
  let findings: CurrentFinding[] = reconciled.map((f, i) => ({ id: `f${i}`, factKey: f.factKey, findingType: f.findingType, values: f.values, status: 'open', resolution: null }))
  findings = settle(findings, story.policy)
  record.findings = findings.map((f) => ({ key: f.factKey, type: f.findingType, values: f.values.map((v) => ({ value: v.value, from: v.sources.map((s) => s.sourceType) })), resolution: f.resolution }))
  let snapshot = buildSnapshot(findings, 'free')
  // A real user fixes a block on the confirm screen; here the blocked fact becomes "not sure" (at most 3 rounds).
  const blocked: string[] = []
  for (let round = 0; round < 3 && snapshot.blocks.length; round++) {
    for (const block of snapshot.blocks) {
      blocked.push(block.reason)
      findings = findings.map((f) => (f.factKey === block.factKey ? { ...f, status: 'not_sure', resolution: { kind: 'not_sure' } } : f))
    }
    snapshot = buildSnapshot(findings, 'free')
  }
  record.blocked = blocked
  if (snapshot.blocks.length) return { ...record, stage: 'snapshot', error: `blocked: ${snapshot.blocks.map((b) => b.reason).join(', ')}` }
  const facts = snapshot.facts
  record.labels = Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, v!.label]))
  record.facts = facts

  const input = buildTier0Input({
    facts,
    findings: findings.map((f) => ({ fact_key: f.factKey, finding_type: f.findingType, values: f.values, resolution: f.resolution })),
    storyText: story.story,
    fidrecCheck: null,
  })
  const user = `INPUT JSON:\n${JSON.stringify(input, null, 2)}`
  const checks = { ...TIER0_CHECKS, documented: documentedFacts(findings.map((f) => ({ fact_key: f.factKey, finding_type: f.findingType, values: f.values, resolution: f.resolution }))) }
  const apiKey = process.env.GuideBuoy_EdgeFunction || process.env.OPENAI_API_KEY || ''
  const details: Array<Array<{ check: string; detail: string }>> = []
  const t1 = Date.now()
  try {
    const result = await produceSummary({
      facts,
      options: checks,
      generate: async (previous) => {
        const summary = await chatSummary({ fetch, apiKey, model: process.env.TIER0_MODEL || TIER0_DEFAULT_MODEL, system: tier0System(previous), user, deadline: Date.now() + 90_000 })
        details.push(validateOutput([summary], facts, checks).map((f) => ({ check: f.check, detail: f.detail })))
        return summary
      },
    })
    record.ms.summary = Date.now() - t1
    Object.assign(record, { ok: true, source: result.source, fallbackReason: result.fallbackReason, attempts: result.attempts, firedChecks: result.firedChecks, firedDetails: details, summary: result.summary })
    if (result.source === 'model') {
      try {
        record.judge = await judge(input.confirmed_facts, input.primary_narrative, result.summary)
      } catch (e) {
        record.judge = [{ kind: 'judge_error', quote: e instanceof Error ? e.message.slice(0, 120) : 'judge failed' }]
      }
    }
  } catch (e) {
    return { ...record, stage: 'summary', error: e instanceof Error ? e.message.slice(0, 200) : 'summary failed' }
  }
  return record
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-')
const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0)

// A summary version caused by a fact the story states but extraction missed (so it was never confirmed): the check was
// right to refuse it; the gap is in extraction, not in the summary.
function extractionMiss(r: RunRecord): boolean {
  const story = (STORIES.find((s) => s.id === r.id)?.story ?? '').toLowerCase().replace(/[,\s]/g, '')
  const last = r.firedDetails?.at(-1) ?? []
  const valueChecks = last.filter((f) => ['amount', 'institution', 'reference', 'date'].includes(f.check))
  return valueChecks.length > 0 && valueChecks.every((f) => {
    const v = f.detail.toLowerCase().replace(/^(?:s\$|sgd|usd|\$)\s?/, '').replace(/[,\s]/g, '').replace(/\/posb$/, '')
    return f.check === 'date' ? true : story.includes(v)
  })
}

function summarise(records: RunRecord[], meta: Record<string, string>) {
  const done = records.filter((r) => r.ok)
  const model = done.filter((r) => r.source === 'model')
  const fallback = done.filter((r) => r.source === 'fallback')
  const checks = ['amount', 'date', 'institution', 'reference', 'contradiction', 'unqualified', 'forbidden', 'person', 'internal', 'length'] as OutputCheck[]
  const firstAttempt = (c: OutputCheck) => done.filter((r) => r.firedChecks?.[0]?.includes(c)).length
  const anyAttempt = (c: OutputCheck) => done.filter((r) => r.firedChecks?.some((a) => a.includes(c))).length
  const judged = model.filter((r) => r.judge && !r.judge.some((j) => j.kind === 'judge_error'))
  const flagged = judged.filter((r) => r.judge!.length)
  const lines = [
    `# Free-evaluation corpus run`,
    '',
    ...Object.entries(meta).map(([k, v]) => `- ${k}: ${v}`),
    '',
    `| Measure | Result |`,
    `|---|---|`,
    `| Runs | ${records.length} (${new Set(records.map((r) => r.id)).size} stories) |`,
    `| Pipeline errors (extraction / snapshot / summary) | ${records.filter((r) => r.stage === 'extraction').length} / ${records.filter((r) => r.stage === 'snapshot').length} / ${records.filter((r) => r.stage === 'summary').length} |`,
    `| Delivered from the model | ${model.length} (${pct(model.length, done.length)}) |`,
    `| Summary version used | ${fallback.length} (${pct(fallback.length, done.length)}) |`,
    `| of which the rejected value is in the story but was not extracted | ${fallback.filter(extractionMiss).length} |`,
    `| Model summaries the judge flagged | ${flagged.length} of ${judged.length} |`,
    `| Summary time p50 / p95 | ${(quantile(done.map((r) => r.ms.summary), 0.5) / 1000).toFixed(1)} s / ${(quantile(done.map((r) => r.ms.summary), 0.95) / 1000).toFixed(1)} s |`,
    '',
    '| Check | Class | Fired on 1st attempt | Fired on any attempt |',
    '|---|---|---|---|',
    ...checks.map((c) => `| ${c} | ${isHardCheck(c) ? 'hard' : 'soft'} | ${firstAttempt(c)} (${pct(firstAttempt(c), done.length)}) | ${anyAttempt(c)} (${pct(anyAttempt(c), done.length)}) |`),
    '',
    '| Story | Runs | Model | Summary version | Checks fired (all attempts) | Judge flags |',
    '|---|---|---|---|---|---|',
    ...[...new Set(records.map((r) => r.id))].map((id) => {
      const rs = records.filter((r) => r.id === id)
      const fired = rs.flatMap((r) => r.firedChecks?.flat() ?? [])
      const counts = Object.entries(fired.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {})).map(([c, n]) => `${c}×${n}`).join(', ')
      return `| ${id} | ${rs.length} | ${rs.filter((r) => r.source === 'model').length} | ${rs.filter((r) => r.source === 'fallback').length}${rs.some((r) => r.error) ? ` (${rs.filter((r) => r.error).length} error)` : ''} | ${counts || '-'} | ${rs.reduce((n, r) => n + (r.judge?.filter((j) => j.kind !== 'judge_error').length ?? 0), 0)} |`
    }),
  ]
  return lines.join('\n')
}

async function main() {
  loadEnv()
  const runs = Number(arg('runs') ?? 3)
  const only = arg('only')?.split(',')
  const stories = STORIES.filter((s) => !only || only.includes(s.id))
  const jobs = stories.flatMap((s) => Array.from({ length: runs }, (_, i) => ({ s, run: i + 1 })))
  const started = new Date()
  const records = await pool(jobs, Number(arg('concurrency') ?? 4), async ({ s, run }) => {
    const r = await runOne(s, run)
    process.stdout.write(`${r.id}#${r.run} ${r.ok ? r.source : `error(${r.stage})`} ${r.firedChecks?.map((a) => `[${a.join(',')}]`).join('') ?? ''}${r.judge?.length ? ` judge:${r.judge.length}` : ''}\n`)
    return r
  })
  const dir = join('test-results', 'tier0-corpus', started.toISOString().replace(/[:.]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'results.json'), JSON.stringify(records, null, 2))
  const meta = {
    started: started.toISOString(),
    'summary model': process.env.TIER0_MODEL || TIER0_DEFAULT_MODEL,
    'extraction model': getOpenAiModel(),
    'judge model': JUDGE_MODEL,
    'runs per story': String(runs),
  }
  writeFileSync(join(dir, 'summary.md'), summarise(records, meta))
  console.log(`\n${summarise(records, meta)}\n\nWritten to ${dir}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'corpus run failed')
  process.exit(1)
})
