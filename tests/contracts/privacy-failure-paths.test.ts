import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { safeError, safeErrorText, scrubErrorText } from '../../lib/server/safe-error'

// Free-evaluation hardening item 6 (8 Nov): logs, error responses and stored job errors carry case ID, job ID, rule
// names, status codes and the commit, never the story, generated text or other case content. All values synthetic.

const read = (path: string) => readFileSync(path, 'utf8')
const edgeFunctions = readdirSync('supabase/functions').filter((name) => !name.startsWith('_'))

test('an error is reduced to its name, code, status and a scrubbed message', () => {
  let parseError: unknown
  try {
    JSON.parse('{"summary": "You lost S$9,999 to Synthetic Bank')
  } catch (e) {
    parseError = e
  }
  assert.deepEqual(safeError(parseError), { name: 'SyntaxError', code: null, status: null, message: 'malformed JSON' })
  const pg = Object.assign(new Error('invalid input syntax for type numeric: "S$9,999"'), { code: '22P02', details: 'Failing row contains (Synthetic Story)' })
  assert.equal(safeErrorText(pg), 'Error [22P02]: invalid input syntax for type numeric: "…"')
  assert.equal(scrubErrorText('Gemini failed: 503 {"error": {"message": "echo of the document"}}'), 'Gemini failed: 503 {…}')
  assert.equal(scrubErrorText('reference 12345678 and amount 9,999.50'), 'reference # and amount #')
  // Lease and readiness markers, which the worker reads from error text, survive.
  assert.equal(scrubErrorText('worker_lease_lost: lease was lost'), 'worker_lease_lost: lease was lost')
  assert.equal(scrubErrorText('documents_not_ready'), 'documents_not_ready')
})

test('Edge Functions never log or return raw errors, provider bodies or model text', () => {
  for (const fn of edgeFunctions) {
    const source = read(`supabase/functions/${fn}/index.ts`)
    assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^)]*String\(e(?:rror)?\)/, `${fn}: String(e) in a log`)
    assert.doesNotMatch(source, /json\(\{ ok: false, error: String\(e\)/, `${fn}: String(e) in a response`)
    assert.doesNotMatch(source, /throw new Error\(`[^`]*\$\{(?:raw|rawErr|outText|bodyText)\b/, `${fn}: provider body or model text in an error`)
    assert.doesNotMatch(source, /raw\.slice\(0, 2000\)/, `${fn}: provider payload in an error`)
    assert.doesNotMatch(source, /new Response\(`[^`]*\$\{\w+Err\.message\}`/, `${fn}: database message in a response`)
    assert.doesNotMatch(source, /\$\{e\.stack/, `${fn}: stack in a log or response`)
  }
  assert.match(read('supabase/functions/bright-function/index.ts'), /console\.error\(`Tier-0 error: \$\{safeErrorText\(e\)\}`\);/)
  assert.match(read('supabase/functions/bright-function/index.ts'), /return json\(\{ ok: false, error: "internal_error" \}, 500\);/)
  assert.match(read('supabase/functions/evidence_processed_v2/index.ts'), /const message = safeErrorText\(error\);\s*log\("GLOBAL_ERROR"/)
  assert.match(read('supabase/functions/evidence_processed_v2/index.ts'), /p_error: safeErrorText\(error\)/)
  const extract = read('supabase/functions/run_case_extract_v4/index.ts')
  assert.match(extract, /const details = safeError\(e\);/)
  assert.doesNotMatch(extract, /details: err\?\.details/, 'Postgres details quote the failing row')
  assert.doesNotMatch(extract, /reported_loss: serverFacts\.reported_loss,|institution_name_guess: serverFacts\.institution_name_guess,/, 'stage logs carry no values')
})

test('the web app and worker log no raw error objects, model output, file names, provider bodies or email subjects', () => {
  const routes = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? routes(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []))
  for (const path of routes('app/api')) {
    const source = read(path)
    assert.doesNotMatch(source, /console\.(?:error|warn)\("[^"]*",? *(?:err|error|[a-zA-Z]*Error)\)/, `${path}: raw error object in a log`)
    assert.doesNotMatch(source, /JSON\.stringify\(response(?:Data)?, null, 2\)/, `${path}: provider response in a log`)
  }
  assert.doesNotMatch(read('app/api/router/questions/route.ts'), /console\.error\([^)]*rawText/)
  assert.doesNotMatch(read('app/api/router/classify/route.ts'), /rawPreview/)
  assert.doesNotMatch(read('app/api/transcribe/route.ts'), /console\.log\([^)]*file\.name/)
  assert.match(read('lib/server/ai/generate-json.ts'), /safeErrorText\(error\)/)
  assert.doesNotMatch(read('worker/index.ts'), /failed \(\$\{res\.status\}\): \$\{rawBody/)
  const mail = read('lib/mail.ts')
  assert.doesNotMatch(mail, /subject: options\.subject/)
  assert.doesNotMatch(mail, /to: options\.to/)
})

test('the privacy export and the deletion runbook cover every fact table, and the review log rows', () => {
  const migration = read('supabase/migrations/20261106120000_fact_reconciliation_foundation.sql')
  const tables = [...migration.matchAll(/CREATE TABLE public\.(\w+) \(/g)].map((m) => m[1]).sort()
  for (const table of tables) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?case_id uuid NOT NULL REFERENCES public\\.cases\\(id\\) ON DELETE CASCADE`), `${table} cascades with its case`)
  }
  const exported = /const FACT_TABLES = \[([\s\S]*?)\] as const/.exec(read('app/api/privacy/export/route.ts'))![1]
  assert.deepEqual([...exported.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort(), tables)
  const runbook = read('docs/runbooks/privacy-case-deletion.md')
  for (const table of tables) assert.ok(runbook.includes(`\`${table}\``), `runbook names ${table}`)
  assert.match(runbook, /delete from public\.analytics_events where event_data->>'case_id' = '<case id>'/)
  assert.match(runbook, /delete from public\.edge_request_nonces where case_id = '<case id>'/)
})
