import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

// Spec principle 3: no report is generated with open findings. For the free stage (C3), the web route refuses
// without the current confirmed snapshot, and the Edge Function refuses again and checks its own output.
// The behaviour behind loadCurrentSnapshot is exercised against a real database in test-facts-reconcile-local.ts.

const route = readFileSync('app/api/edge/tier0/route.ts', 'utf8')
const fn = readFileSync('supabase/functions/bright-function/index.ts', 'utf8')

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
  assert.match(fn, /validateOutput\(outputText\(llm\), facts/)
  assert.match(fn, /reason: "output_validation_failed",[\s\S]{0,300}?\}, 422\)/)
  // The only repair is qualifying document-less or unsure statements; every other failure still refuses.
  assert.match(fn, /if \(failures\.length && failures\.every\(\(f\) => f\.check === "unqualified"\)\)/)
  assert.ok(fn.indexOf('validateOutput(') < fn.indexOf('await upsertNarrative('), 'nothing is written before the output passes')
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
  assert.match(fn, /primary_narrative: storyOverruled \? null : storyRow\?\.story_text \?\? null/)
  assert.match(fn, /if \(resolution\.kind === "value"\) return true;/)
  assert.match(fn, /resolution\.kind === "choice" && !fromStory\(values\[resolution\.index \?\? -1\]\)/)
})
