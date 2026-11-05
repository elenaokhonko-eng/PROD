import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Principle 4 of the spec: generated text is never input. Pipelines read the user's story revisions, answers and
// documents, never GuideBuoy's own narrative rows (the free draft), reports or packs.

const extract = readFileSync('supabase/functions/run_case_extract_v4/index.ts', 'utf8')

test('the extract reads the latest story revision and the answers', () => {
  assert.match(extract, /\.from\("case_story_revisions"\)/)
  assert.match(extract, /\.from\("case_responses"\)/)
  assert.match(extract, /`STORY: \$\{JSON\.stringify\(story\)\}`/)
  assert.match(extract, /`ANSWERS: \$\{JSON\.stringify\(answers\)\}`/)
})

test('the extract never reads generated narratives, reports or packs', () => {
  for (const table of ['case_narratives', 'reports', 'case_findings', 'case_themes']) {
    assert.doesNotMatch(extract, new RegExp(`\\.from\\("${table}"\\)`), table)
  }
})

test('the fact runner reads user-authored sources only', () => {
  const runner = readFileSync('lib/server/facts/run-reconcile.ts', 'utf8')
  const tables = [...runner.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1])
  const reads = new Set(tables)
  for (const generated of ['case_narratives', 'reports', 'case_extract_runs', 'case_decision_runs']) {
    assert.ok(!reads.has(generated), `runner must not read ${generated}`)
  }
  assert.ok(reads.has('case_story_revisions') && reads.has('case_response_revisions') && reads.has('case_document_extractions'))
})

test('the privacy export includes every fact reconciliation table', () => {
  const exportRoute = readFileSync('app/api/privacy/export/route.ts', 'utf8')
  const migration = readFileSync('supabase/migrations/20261106120000_fact_reconciliation_foundation.sql', 'utf8')
  const tables = [...migration.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((m) => m[1])
  assert.equal(tables.length, 7)
  for (const table of tables) assert.match(exportRoute, new RegExp(`"${table}"`), table)
})

test('fact extraction calls are bounded so the confirm screen cannot wait for minutes', () => {
  const runner = readFileSync('lib/server/facts/run-reconcile.ts', 'utf8')
  assert.match(runner, /const MODEL_TIMEOUT_MS = 30_000/)
  assert.match(runner, /generateJson\(\{ prompt, schemaName, timeoutMs: MODEL_TIMEOUT_MS, maxRetries: MODEL_RETRIES \}\)/)
  assert.match(readFileSync('lib/server/ai/generate-json.ts', 'utf8'), /timeout: timeoutMs/)
})
