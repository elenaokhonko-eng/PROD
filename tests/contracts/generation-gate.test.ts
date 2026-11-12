import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

// Spec principle 3: no report is generated with open findings. For the free stage (C3), the web route refuses
// without the current confirmed snapshot, and the Edge Function refuses again and checks its own output.
// The behaviour behind loadCurrentSnapshot is exercised against a real database in test-facts-reconcile-local.ts.

const route = readFileSync('app/api/edge/tier0/route.ts', 'utf8')
const fn = readFileSync('supabase/functions/bright-function/index.ts', 'utf8')
// The summary's input, prompt and checks live in a shared module the corpus also runs (hardening, 8 Nov).
const tier0 = readFileSync('supabase/functions/_shared/facts/tier0.ts', 'utf8')

test('the free-evaluation route refuses without a current confirmed snapshot', () => {
  assert.match(route, /if \(!snapshotId\) \{\s*return NextResponse\.json\(\{ error: 'Confirm your facts first', reason: 'facts_unconfirmed' \}, \{ status: 409 \}\)/)
  assert.match(route, /loadCurrentSnapshot\(createServiceClient\(\), caseId, 'free', snapshotId\)/)
  assert.match(route, /if \(!snapshot\) \{\s*return NextResponse\.json\(\{[^}]*reason: 'facts_unconfirmed' \}, \{ status: 409 \}\)/)
  assert.ok(route.indexOf('loadCurrentSnapshot(') < route.indexOf('proxyEdgeFunction({'), 'the snapshot is checked before the Edge Function is called')
  assert.match(route, /if \(!access\.isOwner\)/)
})

test('the free-evaluation Edge Function requires the latest free snapshot and validates its output', () => {
  assert.match(fn, /if \(!fact_snapshot_id\) return json\(\{ ok: false, reason: "facts_unconfirmed"/)
  assert.match(fn, /\.from\("case_fact_snapshots"\)[\s\S]*?\.eq\("stage", "free"\)[\s\S]*?snapshot\.id !== fact_snapshot_id/)
  // Hardening (8 Nov): model text is shown only when it passes every check (summary-ladder.test.ts); otherwise the
  // summary version from the confirmed facts is written instead. Nothing is written before the ladder has decided.
  assert.match(fn, /const result = await produceSummary\(\{\s*facts,\s*options: checks,/)
  assert.match(fn, /text_content: result\.summary,/)
  assert.ok(fn.indexOf('await produceSummary(') < fn.indexOf('await upsertNarrative('), 'nothing is written before the summary is decided')
})

test('the free evaluation reads confirmed facts and the user story, never generated rows', () => {
  const tables = new Set([...fn.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]))
  for (const generated of ['case_extract_runs', 'case_decision_runs', 'reports', 'case_intake']) {
    assert.ok(!tables.has(generated), `bright-function must not read ${generated}`)
  }
  assert.ok(tables.has('case_fact_snapshots') && tables.has('case_story_revisions'))
})

test('nothing starts the free evaluation automatically any more', () => {
  assert.equal(existsSync('hooks/state-machine/layer1/use-tier0-auto-fire.ts'), false)
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.doesNotMatch(dashboard, /useTier0AutoFire/)
  assert.match(dashboard, /confirmFactsHref=\{`\/app\/case\/\$\{caseId\}\/facts\?stage=free`\}/)
})

test('the story is withheld from the model once the user has overruled it on the confirm screen (staging run, 5 Nov)', () => {
  assert.match(fn, /buildTier0Input\(\{ facts, findings: findings \?\? \[\], storyText: storyRow\?\.story_text \?\? null, fidrecCheck \}\)/)
  assert.match(tier0, /primary_narrative: storyOverruled \? null : args\.storyText/)
  assert.match(tier0, /if \(resolution\.kind === "value"\) return true;/)
  assert.match(tier0, /resolution\.kind === "choice" && !fromStory\(values\[resolution\.index \?\? -1\]\)/)
})

test('the story is withheld exactly when a story value was overruled (behaviour)', async () => {
  const { buildTier0Input } = await import('../../lib/facts')
  const story = { sourceType: 'story' }
  const doc = { sourceType: 'document' }
  const findings = (resolution: unknown) => [{ fact_key: 'total_loss', finding_type: 'conflict', values: [{ sources: [story] }, { sources: [doc] }], resolution }]
  const narrative = (resolution: unknown) => buildTier0Input({ facts: {}, findings: findings(resolution), storyText: 'Synthetic story.', fidrecCheck: null }).primary_narrative
  assert.equal(narrative({ kind: 'choice', index: 0 }), 'Synthetic story.')
  assert.equal(narrative({ kind: 'choice', index: 1 }), null)
  assert.equal(narrative({ kind: 'value', value: 1 }), null)
  assert.equal(narrative(null), 'Synthetic story.')
})

test('the SRF assessment is server-only: the model gives no verdict and its text may not mention one (Elena, 5 Nov)', () => {
  assert.doesNotMatch(fn, /"srf_signals": \{/, 'the model output schema has no SRF signals')
  assert.match(fn, /text_content: srfAssessmentText\(assessSrf\(srfFactsFromSnapshot\(facts\)\)\)/)
  assert.match(tier0, /forbidden: \[\{ pattern: SRF_VERDICT/)
  assert.match(tier0, /secondPerson: true/)
  assert.match(fn, /const checks = \{ \.\.\.TIER0_CHECKS, documented: documentedFacts\(findings \?\? \[\]\) \};/)
  assert.match(fn, /options: checks,/)
  assert.doesNotMatch(tier0, /evidence_checklist/, 'the model is no longer asked for a checklist it would not be shown')
  // Every model text that is shown is checked; the evidence checklist shown is the server's (C2), not the model's.
  assert.match(fn, /return chatSummary\(\{\s*fetch,\s*apiKey: OPENAI_API_KEY,\s*model: TIER0_MODEL,[\s\S]*?system: tier0System\(previousFailures\),\s*user,\s*deadline,/)
  // Cost controls (8 Nov): capped output and no model call once the daily budget is used up.
  assert.match(fn, /maxTokens: OUTPUT_CAPS\.summary,/)
  assert.match(fn, /if \(breaker\.state === "open"\) \{[\s\S]*?outcome: "blocked"[\s\S]*?throw new ProviderFailure\("budget"\)/)
  assert.match(fn, /text_content: evidenceListsText\(facts, /)
  assert.doesNotMatch(fn, /text_content: llm\.evidence_checklist/)
})
