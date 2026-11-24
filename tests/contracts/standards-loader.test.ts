import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { formatManifest, type Manifest, readManifest, validateManifest } from '../../scripts/standards/manifest.ts'
import { cutClauses, hashMismatches, normaliseClauseText, sha256Hex } from '../../scripts/standards/segment.ts'
import { buildLoadSql, sqlLiteral } from '../../scripts/standards/sql.ts'

// The standards loader (scripts/standards): a source file plus a manifest gives a draft version. Synthetic text only;
// the committed manifests are checked for shape, never for clause text (the text stays in private storage).
// Set STANDARDS_TEST_PSQL to a psql command for a local database to also run the load twice against it.

const MANIFEST_DIR = 'supabase/standards/manifests'

const PAGES = [
  'Synthetic Regulator\nSYNTHETIC GUIDELINES\n1\n',
  'Definitions\n1.1 A synthetic duty starts here and\nruns on.2\n2 A synthetic footnote.\n',
  'continues after the footnote. 1.2 A second “quoted” duty [Amended on 1 January 2025]\nwith\u00a0a no-break space.\n',
]

function synthetic(): Manifest {
  const zero = '0'.repeat(64)
  const clause = (key: string, ref: string) => ({
    clause_key: key, clause_ref: ref, heading_path: ['Definitions'], tags: [], instrument_scope: null,
    effective_from_override: null, pages: [], text_sha256: zero,
  })
  return {
    document: {
      document_key: 'test.loader', title: 'Synthetic guidelines', publisher: 'Synthetic regulator', binding_level: 'guideline',
      applies_to: ['bank'], instrument_scope: ['account_transfer'], institution: null, card_scheme: null,
      canonical_url: 'https://example.test/guidelines',
    },
    version: {
      version_label: 'v1', effective_from: '2025-01-01', issued_on: '2024-12-01', retrieved_at: '2026-11-24T00:00:00Z',
      source_url: 'https://example.test/guidelines.pdf', snapshot_path: 'test.loader/v1/guidelines.pdf',
      content_sha256: 'a'.repeat(64), provenance: 'publisher_site', coverage: 'full',
    },
    extraction: { format: 'pdf', extractor: 'synthetic', remove: ['\\[Amended on [^\\]]*\\]', '^\\d+$'] },
    markers: [
      { at: '^Definitions$', clause: null },
      { at: '^1\\.1 ', clause: 'test.loader/1.1', skip: true },
      { at: '^2 (?=[A-Z])', clause: 'test.loader/fn2', skip: true },
      { at_page: 3, clause: 'test.loader/1.1' },
      { at: '(?<=\\s)1\\.2 (?=[A-Z])', clause: 'test.loader/1.2', skip: true },
    ],
    clauses: [clause('test.loader/1.1', '1.1'), clause('test.loader/fn2', 'footnote 2'), clause('test.loader/1.2', '1.2')],
  }
}

test('clauses are cut by marker, a footnote is lifted out of its paragraph, and furniture is removed', () => {
  const cut = cutClauses(synthetic(), PAGES)
  const text = Object.fromEntries(cut.map((c) => [c.clause_key, c.text]))
  assert.equal(text['test.loader/1.1'], 'A synthetic duty starts here and runs on.2 continues after the footnote.')
  assert.equal(text['test.loader/fn2'], 'A synthetic footnote.')
  assert.equal(text['test.loader/1.2'], 'A second “quoted” duty with a no-break space.')
  assert.deepEqual(cut.find((c) => c.clause_key === 'test.loader/1.1')?.pages, [2, 3])
  for (const c of cut) assert.equal(c.text_sha256, sha256Hex(c.text))
})

test('the same pages and manifest always give the same text and hashes', () => {
  const a = cutClauses(synthetic(), PAGES)
  const b = cutClauses(synthetic(), [...PAGES])
  assert.deepEqual(a, b)
  assert.equal(buildLoadSql(synthetic(), a, 'm.json'), buildLoadSql(synthetic(), b, 'm.json'))
})

test('a marker that is missing or out of order stops the cut', () => {
  const missing = synthetic()
  missing.markers[2].at = '^9 (?=[A-Z])'
  assert.throws(() => cutClauses(missing, PAGES), /marker 2 .* not found/)
  const backwards = synthetic()
  backwards.markers = [backwards.markers[0], backwards.markers[4], backwards.markers[1]]
  assert.throws(() => cutClauses(backwards, PAGES), /not found/)
})

test('a recorded hash that does not match the cut text is reported', () => {
  const m = synthetic()
  const cut = cutClauses(m, PAGES)
  m.clauses[0].text_sha256 = cut[0].text_sha256
  assert.deepEqual(hashMismatches(m, cut).map((x) => x.clause_key), ['test.loader/fn2', 'test.loader/1.2'])
})

test('text is stored NFKC with whitespace collapsed', () => {
  assert.equal(normaliseClauseText('  ﬁnal\u00a0 text\n\tend\u00ad '), 'final text end')
})

test('manifest validation: keys, paths, markers, and no clause text', () => {
  assert.deepEqual(validateManifest(synthetic()).filter((e) => !/sha256/.test(e)), [])
  const bad = synthetic() as Manifest & { clauses: Array<Record<string, unknown>> }
  bad.clauses[0].text = 'clause text must not be committed'
  bad.clauses[1].clause_key = 'test.other/fn2'
  bad.version.snapshot_path = 'C:\\private\\guidelines.pdf'
  bad.markers.push({ clause: 'test.loader/1.2' })
  const errors = validateManifest(bad as Manifest).join('\n')
  assert.match(errors, /must not hold clause text/)
  assert.match(errors, /does not belong to test\.loader/)
  assert.match(errors, /snapshot_path must be relative/)
  assert.match(errors, /needs either at or at_page/)
})

test('the load SQL writes drafts only, guards every write, and checks the database hash', () => {
  const m = synthetic()
  const cut = cutClauses(m, PAGES)
  for (const c of m.clauses) c.text_sha256 = cut.find((x) => x.clause_key === c.clause_key)!.text_sha256
  const sql = buildLoadSql(m, cut, 'supabase/standards/manifests/test.loader.v1.json')
  assert.doesNotMatch(sql, /'verified'|'approved'|verified_by|verified_at/)
  assert.match(sql, /ON CONFLICT \(document_key\) DO NOTHING/)
  assert.match(sql, /IS DISTINCT FROM/)
  assert.match(sql, /standards_loader_version_not_draft/)
  assert.match(sql, /standards_loader_hash_mismatch/)
  assert.match(sql, /'A second “quoted” duty with a no-break space\.'/)
  assert.equal(sqlLiteral("it's"), "'it''s'")
})

test('every committed manifest is valid, with keys unique across manifests and no clause text', () => {
  const files = existsSync(MANIFEST_DIR) ? readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.json')) : []
  const seen = new Map<string, string>()
  for (const file of files) {
    const path = join(MANIFEST_DIR, file)
    const m = readManifest(path)
    assert.equal(file, `${m.document.document_key}.${m.version.effective_from ?? 'undated'}.json`, `${file}: name is <document_key>.<effective_from>.json`)
    assert.equal(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), formatManifest(m) + '\n', `${file} is not in the loader's format`)
    for (const c of m.clauses) {
      const versionKey = `${c.clause_key}@${m.version.version_label}`
      assert.ok(!seen.has(versionKey), `${versionKey} also in ${seen.get(versionKey)}`)
      seen.set(versionKey, file)
      assert.notEqual(c.text_sha256, '0'.repeat(64), `${c.clause_key}: hash never recorded`)
      assert.ok(c.pages.length > 0, `${c.clause_key}: no source page`)
    }
  }
})

test('loading twice changes nothing, and the database hashes are the manifest hashes', { skip: !process.env.STANDARDS_TEST_PSQL }, () => {
  const psql = process.env.STANDARDS_TEST_PSQL as string
  const m = synthetic()
  const cut = cutClauses(m, PAGES)
  for (const c of m.clauses) c.text_sha256 = cut.find((x) => x.clause_key === c.clause_key)!.text_sha256
  const sql = buildLoadSql(m, cut, 'supabase/standards/manifests/test.loader.v1.json')
  const run = (input: string) => spawnSync(psql, { shell: true, input, encoding: 'utf8' })
  const cleanup = `DELETE FROM public.standard_clauses WHERE clause_key LIKE 'test.loader/%';
    DELETE FROM public.standard_document_versions WHERE document_id IN (SELECT id FROM public.standard_documents WHERE document_key = 'test.loader');
    DELETE FROM public.standard_documents WHERE document_key = 'test.loader';`
  run(cleanup)
  try {
    const first = run(sql)
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stderr, /"v1" \(draft\): 5 row\(s\) changed, 3 clause\(s\)/)
    const second = run(sql)
    assert.equal(second.status, 0, second.stderr)
    assert.match(second.stderr, /"v1" \(draft\): 0 row\(s\) changed, 3 clause\(s\)/)
    const hashes = run(`\\pset format unaligned\n\\pset tuples_only on\nSELECT string_agg(clause_key || '=' || text_sha256, ',' ORDER BY clause_key) FROM public.standard_clauses WHERE clause_key LIKE 'test.loader/%';`)
    const expected = [...m.clauses].sort((a, b) => (a.clause_key < b.clause_key ? -1 : 1)).map((c) => `${c.clause_key}=${c.text_sha256}`).join(',')
    assert.equal(hashes.stdout.trim(), expected)
    // A changed clause text in a draft is updated in place; the second run is again a no-op.
    m.extraction.remove.push('no-break space')
    const recut = cutClauses(m, PAGES)
    for (const c of m.clauses) c.text_sha256 = recut.find((x) => x.clause_key === c.clause_key)!.text_sha256
    const third = run(buildLoadSql(m, recut, 'supabase/standards/manifests/test.loader.v1.json'))
    assert.match(third.stderr, /1 row\(s\) changed/)
  } finally {
    run(cleanup)
  }
})
