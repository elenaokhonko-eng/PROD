import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { buildConfirmSql } from '../../scripts/standards/confirm-sql.ts'
import {
  clausesSha256, type ConfirmationFile, describePlan, type NamedManifest, planConfirmations, readConfirmations,
  statementTextSha256, validateConfirmationFile,
} from '../../scripts/standards/confirmations.ts'
import { type Manifest, readManifest } from '../../scripts/standards/manifest.ts'
import { MANIFEST_DIR, readStatements, type RuleCitation, ruleCitations, type SeedStatement } from '../../scripts/standards/seeds.ts'
import { sha256Hex } from '../../scripts/standards/segment.ts'
import { buildLoadSql, sqlLiteral } from '../../scripts/standards/sql.ts'

// Confirmations (scripts/standards/confirm.ts): a person's record, tied to content by hash, becomes reviews, a
// verified version and approved statements. Synthetic documents, statements and reviewer only.
// Set STANDARDS_TEST_PSQL to a psql command for a local database to also apply the SQL there. A verified version
// cannot be deleted, so that test leaves its rows behind under a key made for the run; use a throwaway database.

type File = ConfirmationFile & { file: string }

const BY = 'Synthetic reviewer'
const AT = '2026-11-25T10:00:00+08:00'

function world(tag = 'x') {
  const key = `test.confirm-${tag}`
  const texts = { v1: { a: 'A synthetic duty.', b: 'A second synthetic duty.' }, v2: { a: 'A synthetic duty.', b: 'A second synthetic duty, reworded.' } }
  const manifest = (label: 'v1' | 'v2', from: string): Manifest => ({
    document: {
      document_key: key, title: 'Synthetic guidelines', publisher: 'Synthetic regulator', binding_level: 'guideline',
      applies_to: ['bank'], instrument_scope: ['account_transfer'], institution: null, card_scheme: null,
      canonical_url: 'https://example.test/guidelines',
    },
    version: {
      version_label: label, effective_from: from, issued_on: from, retrieved_at: '2026-11-24T00:00:00Z',
      source_url: `https://example.test/${label}.pdf`, snapshot_path: `${key}/${label}/guidelines.pdf`,
      content_sha256: sha256Hex(`${key} ${label}`), provenance: 'publisher_site', coverage: 'full',
    },
    extraction: { format: 'pdf', extractor: 'synthetic', remove: [] },
    markers: [],
    clauses: (['a', 'b'] as const).map((ref) => ({
      clause_key: `${key}/${ref}`, clause_ref: ref, heading_path: ['Duties'], tags: [], instrument_scope: null,
      effective_from_override: null, pages: [1], text_sha256: sha256Hex(texts[label][ref]),
    })),
  })
  const manifests: NamedManifest[] = [
    { file: `${key}.v1.json`, manifest: manifest('v1', '2025-01-01') },
    { file: `${key}.v2.json`, manifest: manifest('v2', '2026-01-01') },
  ]
  const stem = `test.confirm_${tag}`
  const statement = (name: string, ref: string): SeedStatement => ({
    statement_key: `${stem}.${name}`, revision: 1, framework: 'eupg', applies_to_instrument: ['account_transfer'],
    text: `Synthetic statement ${name}.`, clause_keys: [`${key}/${ref}`], exclusion_clause_keys: [],
  })
  const statements = [statement('one', 'a'), statement('two', 'b')]
  const citations: RuleCitation[] = [{ rule_id: `${stem}.rule`, clause_key: `${key}/a`, source_file: 'synthetic.ts' }]
  const version = (i: number) => ({
    manifest: manifests[i].file, content_sha256: manifests[i].manifest.version.content_sha256,
    clauses_sha256: clausesSha256(manifests[i].manifest),
  })
  const review = (i: number, s: SeedStatement) => ({
    manifest: manifests[i].file, statement_key: s.statement_key, revision: 1, text_sha256: statementTextSha256(s.text), outcome: 'unchanged' as const,
  })
  const approval = (s: SeedStatement, asOf: string) => ({
    statement_key: s.statement_key, revision: 1, text_sha256: statementTextSha256(s.text), clauses_as_of: asOf,
  })
  const cut = (i: number) => manifests[i].manifest.clauses.map((c) => ({
    clause_key: c.clause_key, text: texts[i === 0 ? 'v1' : 'v2'][c.clause_ref as 'a' | 'b'], text_sha256: c.text_sha256, pages: [1],
  }))
  return { key, stem, manifests, statements, citations, version, review, approval, cut }
}

const file = (name: string, body: Partial<ConfirmationFile>): File => ({ file: name, by: BY, at: AT, ...body })

test('a confirmed first version waits on every statement and rule that rests on it', () => {
  const w = world()
  const plan = planConfirmations({ files: [file('a.json', { versions: [w.version(0)] })], manifests: w.manifests, statements: w.statements, citations: w.citations })
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.versions[0].changedKeys, [`${w.key}/a`, `${w.key}/b`])
  assert.deepEqual(plan.versions[0].waitingOn, [`statement ${w.stem}.one r1`, `statement ${w.stem}.two r1`, `rule ${w.stem}.rule`])
  assert.equal(buildConfirmSql(plan), null)
  assert.match(describePlan(plan), /^WAIT {3}test\.confirm-x, v1: text confirmed by Synthetic reviewer; waiting on 3:/)
})

test('with its reviews a version is ready, and a statement is ready once every clause it rests on is held', () => {
  const w = world()
  const [one, two] = w.statements
  const files = [file('a.json', {
    versions: [w.version(0)],
    statement_reviews: [w.review(0, one), w.review(0, two)],
    rule_reviews: [{ manifest: w.manifests[0].file, rule_id: `${w.stem}.rule`, outcome: 'unchanged' }],
    statements: [w.approval(one, '2025-06-01'), w.approval(two, '2024-06-01')],
  })]
  const plan = planConfirmations({ files, manifests: w.manifests, statements: w.statements, citations: w.citations })
  assert.deepEqual(plan.versions[0].waitingOn, [])
  assert.deepEqual(plan.approvals[0].waitingOn, [])
  // 2024-06-01 is before the version comes into force.
  assert.match(plan.approvals[1].waitingOn[0], /no verified version of test\.confirm-x holds it on 2024-06-01/)
  const sql = buildConfirmSql(plan)!
  assert.match(sql, /holds a different source file from the one confirmed/)
  assert.match(sql, /holds different clauses from the ones confirmed/)
  assert.match(sql, /is not loaded with the wording that was reviewed/)
  assert.equal((sql.match(/SET status = 'verified'/g) ?? []).length, 1)
  assert.equal((sql.match(/SET status = 'approved'/g) ?? []).length, 1)
  assert.match(sql, new RegExp(`verified_by = ${sqlLiteral(BY).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.doesNotMatch(sql, /now\(\)/)
})

test('a later version waits only on what rests on the clauses it changed', () => {
  const w = world()
  const [one, two] = w.statements
  const base = {
    versions: [w.version(0), w.version(1)],
    statement_reviews: [w.review(0, one), w.review(0, two)],
    rule_reviews: [{ manifest: w.manifests[0].file, rule_id: `${w.stem}.rule`, outcome: 'unchanged' as const }],
  }
  const plan = planConfirmations({ files: [file('a.json', base)], manifests: w.manifests, statements: w.statements, citations: w.citations })
  assert.deepEqual(plan.versions[1].changedKeys, [`${w.key}/b`])
  assert.deepEqual(plan.versions[1].waitingOn, [`statement ${w.stem}.two r1`])
})

test('a record covers only the content it was made for', () => {
  const w = world()
  const [one] = w.statements
  const files = [file('a.json', { versions: [w.version(0)], statement_reviews: [w.review(0, one)], statements: [w.approval(one, '2025-06-01')] })]
  // The manifest's clause text changes after the confirmation; so does the statement's wording.
  w.manifests[0].manifest.clauses[0].text_sha256 = sha256Hex('A different duty.')
  w.statements[0] = { ...one, text: 'Synthetic statement one, reworded.' }
  const plan = planConfirmations({ files, manifests: w.manifests, statements: w.statements, citations: w.citations })
  assert.equal(plan.versions.length, 0)
  assert.equal(plan.approvals.length, 0)
  assert.equal(plan.stale.length, 3)
  assert.match(plan.stale[0], /the manifest has changed since it was confirmed/)
  assert.match(plan.stale[1], /the statement's wording has changed since it was reviewed/)
  assert.match(plan.stale[2], /the statement's wording has changed since it was approved/)
  assert.equal(buildConfirmSql(plan), null)
})

test('malformed and contradicting records stop everything', () => {
  const w = world()
  assert.match(validateConfirmationFile({ file: 'a.json', by: '', at: '25 Nov', versions: [{ manifest: 'm', content_sha256: 'x', clauses_sha256: 'y' }] }).join('\n'),
    /by is missing[\s\S]*at must be a date and time with an offset[\s\S]*content_sha256 and clauses_sha256 are required/)
  const twice = planConfirmations({
    files: [file('a.json', { versions: [w.version(0)] }), { ...file('b.json', { versions: [w.version(0)] }), by: 'Another reviewer' }],
    manifests: w.manifests, statements: w.statements, citations: w.citations,
  })
  assert.match(twice.errors[0], /is confirmed twice/)
  assert.equal(buildConfirmSql(twice), null)
})

test('the committed records are well formed and still cover what the repo holds', () => {
  const manifests: NamedManifest[] = readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: f, manifest: readManifest(join(MANIFEST_DIR, f)) }))
  const plan = planConfirmations({ files: readConfirmations(), manifests, statements: readStatements(), citations: ruleCitations() })
  assert.deepEqual(plan.errors, [])
  // A manifest or statement edited after it was confirmed must have its record removed or renewed in the same change.
  assert.deepEqual(plan.stale, [])
})

test('against a database: refused while unreviewed, then verified and approved, and a second run changes nothing', { skip: !process.env.STANDARDS_TEST_PSQL }, () => {
  const psql = process.env.STANDARDS_TEST_PSQL as string
  const run = (input: string) => spawnSync(psql, { shell: true, input, encoding: 'utf8' })
  const ok = (input: string) => {
    const r = run(input)
    assert.equal(r.status, 0, r.stderr)
    return r
  }
  const one_ = (query: string) => ok(`\\pset format unaligned\n\\pset tuples_only on\n${query}`).stdout.trim().split('\n').pop() ?? ''
  const w = world(randomBytes(4).toString('hex'))
  const [one, two] = w.statements
  const rule = `${w.stem}.rule`
  const input = (files: File[]) => planConfirmations({ files, manifests: w.manifests, statements: w.statements, citations: w.citations })

  ok(buildLoadSql(w.manifests[0].manifest, w.cut(0), `supabase/standards/manifests/${w.manifests[0].file}`))
  ok(`INSERT INTO public.definition_statements (statement_key, revision, framework, applies_to_instrument, text, clause_keys, exclusion_clause_keys) VALUES
    ${w.statements.map((s) => `(${sqlLiteral(s.statement_key)}, 1, 'eupg', '{account_transfer}', ${sqlLiteral(s.text)}, ARRAY[${sqlLiteral(s.clause_keys[0])}], '{}')`).join(', ')};
    INSERT INTO public.standard_rule_citations (rule_id, clause_key, source_file) VALUES (${sqlLiteral(rule)}, ${sqlLiteral(`${w.key}/a`)}, 'synthetic.ts');`)

  // The plan asks for exactly what the database's own check asks for.
  const waiting = input([file('a.json', { versions: [w.version(0)] })])
  const refused = run(`\\set ON_ERROR_STOP on
    UPDATE public.standard_document_versions SET status = 'verified', verified_by = 'x', verified_at = now()
    WHERE document_id = (SELECT id FROM public.standard_documents WHERE document_key = ${sqlLiteral(w.key)});`)
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /standard_version_dependants_unreviewed/)
  for (const item of waiting.versions[0].waitingOn) assert.ok(refused.stderr.includes(item), `${item} in: ${refused.stderr}`)

  const first: File = file('a.json', {
    versions: [w.version(0)],
    statement_reviews: [w.review(0, one), w.review(0, two)],
    rule_reviews: [{ manifest: w.manifests[0].file, rule_id: rule, outcome: 'unchanged' }],
    statements: [w.approval(one, '2025-06-01'), w.approval(two, '2025-06-01')],
  })
  const sql = buildConfirmSql(input([first]))!
  ok(sql)
  const state = () => one_(`SELECT string_agg(x, ' | ' ORDER BY x) FROM (
      SELECT 'version ' || v.version_label || ' ' || v.status || ' ' || COALESCE(v.verified_by, '-') || ' ' || COALESCE(to_char(v.verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI'), '-') || ' to ' || COALESCE(v.effective_to::text, '-') AS x
      FROM public.standard_document_versions v JOIN public.standard_documents d ON d.id = v.document_id WHERE d.document_key = ${sqlLiteral(w.key)}
      UNION ALL SELECT 'statement ' || s.statement_key || ' ' || s.status || ' ' || COALESCE(s.approved_by, '-') || ' ' || COALESCE(s.clauses_as_of::text, '-')
      FROM public.definition_statements s WHERE s.statement_key LIKE ${sqlLiteral(`${w.stem}.%`)}
      UNION ALL SELECT 'reviews ' || count(*) FROM public.standard_dependant_reviews r
      JOIN public.standard_document_versions v ON v.id = r.version_id JOIN public.standard_documents d ON d.id = v.document_id WHERE d.document_key = ${sqlLiteral(w.key)}) t`)
  const after = state()
  assert.equal(after, [
    'reviews 3',
    `statement ${w.stem}.one approved ${BY} 2025-06-01`,
    `statement ${w.stem}.two approved ${BY} 2025-06-01`,
    `version v1 verified ${BY} 2026-11-25T02:00 to -`,
  ].join(' | '))
  const again = ok(sql)
  assert.doesNotMatch(again.stderr, /NOTICE|ERROR/)
  assert.equal(state(), after)

  // The next version: only the statement on the changed clause is asked for, by the plan and by the database.
  ok(buildLoadSql(w.manifests[1].manifest, w.cut(1), `supabase/standards/manifests/${w.manifests[1].file}`))
  const second = input([first, file('b.json', { versions: [w.version(1)] })])
  assert.deepEqual(second.versions[1].waitingOn, [`statement ${one.statement_key.replace('.one', '.two')} r1`])
  const refusedAgain = run(`\\set ON_ERROR_STOP on
    UPDATE public.standard_document_versions SET status = 'verified', verified_by = 'x', verified_at = now()
    WHERE version_label = 'v2' AND document_id = (SELECT id FROM public.standard_documents WHERE document_key = ${sqlLiteral(w.key)});`)
  assert.match(refusedAgain.stderr, new RegExp(`DETAIL:\\s+statement ${two.statement_key.replace(/\./g, '\\.')} r1\\s*$`, 'm'))
  ok(buildConfirmSql(input([first, file('b.json', { versions: [w.version(1)], statement_reviews: [w.review(1, two)] })]))!)
  assert.match(state(), /version v1 verified Synthetic reviewer 2026-11-25T02:00 to 2026-01-01 \| version v2 verified Synthetic reviewer 2026-11-25T02:00 to -$/)

  // A record made for other content is refused by the SQL itself, and nothing in that run is kept.
  const other = world(randomBytes(4).toString('hex'))
  ok(buildLoadSql(other.manifests[0].manifest, other.cut(0), `supabase/standards/manifests/${other.manifests[0].file}`))
  other.manifests[0].manifest.clauses[0].text_sha256 = sha256Hex('Not what the database holds.')
  const mismatch = buildConfirmSql(planConfirmations({ files: [file('c.json', { versions: [other.version(0)] })], manifests: other.manifests, statements: [], citations: [] }))!
  const stopped = run(mismatch)
  assert.notEqual(stopped.status, 0)
  assert.match(stopped.stderr, /holds different clauses from the ones confirmed/)
  assert.equal(one_(`SELECT v.status FROM public.standard_document_versions v JOIN public.standard_documents d ON d.id = v.document_id WHERE d.document_key = ${sqlLiteral(other.key)}`), 'draft')
})
