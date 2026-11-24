// Migrations 20261204120000 (as-of rule), 20261204120100 (published pages, wallet_provisioning) and 20261204120200
// (IP locations) against the contract's constants, and the loader's support for them. The database runs are in
// scripts/sql/tests/test_standards_as_of_rule.sql (generated from the shared case table),
// scripts/sql/tests/test_standards_published_pages.sql and tests/database/case-ip-locations.test.sql.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  AS_OF_RULES,
  IP_NETWORK_FLAGS,
  TERM_REQUEST_PURPOSES,
  WALLET_PROVISIONING_AUTHENTICATIONS,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import {
  AS_OF_RULE_TEST_SQL_PATH,
  EUPG_LATER_START_TEST,
  buildAsOfRuleTestSql,
  readAsOfRuleCases,
} from '../../scripts/standards/as-of-rule-test-sql.ts'
import { AS_OF_RULES as MANIFEST_AS_OF_RULES, BINDING_LEVELS, readManifest, validateManifest } from '../../scripts/standards/manifest.ts'
import type { Manifest } from '../../scripts/standards/manifest.ts'
import { buildLoadSql } from '../../scripts/standards/sql.ts'

const AS_OF = readFileSync('supabase/migrations/20261204120000_standards_as_of_rule.sql', 'utf8')
const PAGES = readFileSync('supabase/migrations/20261204120100_standards_published_pages.sql', 'utf8')
const IP = readFileSync('supabase/migrations/20261204120200_case_ip_locations.sql', 'utf8')

/** The quoted values of the first `<column> IN (...)` in a CHECK. */
function checkValues(sql: string, column: string): string[] {
  const m = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)`).exec(sql)
  assert.ok(m, `no CHECK on ${column}`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

const lf = (s: string) => s.replace(/\r\n/g, '\n')

test('the term-request purpose check lists exactly the contract TERM_REQUEST_PURPOSES', () => {
  assert.deepEqual(checkValues(PAGES, 'purpose').sort(), [...TERM_REQUEST_PURPOSES].sort())
})

test('wallet_provisioning authentication values are the contract values plus none_stated', () => {
  assert.deepEqual(checkValues(PAGES, 'wallet_authentication_required').sort(),
    [...WALLET_PROVISIONING_AUTHENTICATIONS, 'none_stated'].sort())
})

test('as_of_rule values match the contract and the loader', () => {
  assert.deepEqual(checkValues(AS_OF, 'as_of_rule'), [...AS_OF_RULES])
  assert.deepEqual([...MANIFEST_AS_OF_RULES], [...AS_OF_RULES])
})

test('the as-of read functions are the ones the contract proposes, plus the case-level reads', () => {
  for (const name of ['get_document_as_of_rule_v1', 'read_clause_under_as_of_rule_v1', 'get_statement_for_case_v1']) {
    assert.match(AS_OF, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`))
  }
})

test('the published-page level is in the migration and the loader', () => {
  assert.ok(checkValues(PAGES, 'binding_level').includes('published_page'))
  assert.deepEqual(checkValues(PAGES, 'binding_level').sort(), [...BINDING_LEVELS].sort())
})

test('IP network flags match the contract', () => {
  const flags = [...IP.matchAll(/flags <@ ARRAY\[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
  assert.equal(flags.length, 2)
  for (const f of flags) assert.deepEqual(f, [...IP_NETWORK_FLAGS])
})

test('the as-of SQL test is generated from the shared case table and runs every case', () => {
  const cases = readAsOfRuleCases()
  const committed = lf(readFileSync(AS_OF_RULE_TEST_SQL_PATH, 'utf8'))
  assert.equal(committed, buildAsOfRuleTestSql(cases), 'regenerate: npx tsx scripts/standards/as-of-rule-test-sql.ts')
  for (const c of cases) assert.ok(committed.includes(`as-of case ${c.id}:`), `case ${c.id} not run`)
})

test('as-of case table: every later-start EUPG case before its start expects not_held', () => {
  const early = readAsOfRuleCases().filter((c) => c.asOfRule === 'event_date' && c.clauseStart !== null && c.eventDate < c.clauseStart)
  assert.ok(early.length >= 2)
  for (const c of early) assert.equal(c.expected, 'not_held', c.id)
})

test(EUPG_LATER_START_TEST, { skip: !process.env.STANDARDS_TEST_PSQL }, () => {
  const run = spawnSync(process.env.STANDARDS_TEST_PSQL as string, { shell: true, input: readFileSync(AS_OF_RULE_TEST_SQL_PATH, 'utf8'), encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.doesNotMatch(run.stderr, /ERROR/, run.stderr)
  assert.match(run.stdout, /standards as-of rule: all checks passed/)
})

test('the MAS replies of 7 January 2025, 13 January 2026 and 3 February 2026 are read on any date', () => {
  for (const f of ['mas.reply.20250107.2025-01-07.json', 'mas.reply.20260113.2026-01-13.json', 'mas.reply.20260203.2026-02-03.json']) {
    assert.equal(readManifest(`supabase/standards/manifests/${f}`).document.as_of_rule, 'any_date', f)
  }
})

test('the loader checks as_of_rule, the published-page institution and the archive date', () => {
  const base = readManifest('supabase/standards/manifests/mas.reply.20260113.2026-01-13.json')
  const copy = (): Manifest => JSON.parse(JSON.stringify(base))
  assert.deepEqual(validateManifest(copy()), [])

  const guideline = copy()
  guideline.document.binding_level = 'guideline'
  assert.ok(validateManifest(guideline).some((e) => /any_date is only for an announcement/.test(e)))

  const page = copy()
  page.document.binding_level = 'published_page'
  delete page.document.as_of_rule
  assert.ok(validateManifest(page).some((e) => /names its institution/.test(e)))
  page.document.institution = 'uob'
  assert.deepEqual(validateManifest(page), [])

  const archived = copy()
  archived.version.provenance = 'web_archive'
  assert.ok(validateManifest(archived).some((e) => /archived_at/.test(e)))
  archived.version.archived_at = '2025-10-01'
  assert.deepEqual(validateManifest(archived), [])
  const ours = copy()
  ours.version.archived_at = '2025-10-01'
  assert.ok(validateManifest(ours).some((e) => /archived_at/.test(e)))

  const sql = buildLoadSql(archived, base.clauses.map((c) => ({ clause_key: c.clause_key, text: 'x', text_sha256: c.text_sha256, pages: [1] })) as never, 'm.json')
  assert.match(sql, /canonical_url, as_of_rule\)/)
  assert.match(sql, /manifest_path, archived_at\)/)
  assert.match(sql, /'2025-10-01'::date/)
  assert.match(sql, /'any_date'/)
})

test('the MAS reply of 3 February 2026 prints for an earlier event, marked as after the events', { skip: !process.env.STANDARDS_TEST_PSQL }, () => {
  // The loaded version is a draft and drafts are never read, so a synthetic copy carries the manifest's own rule and
  // date through the database read. Rolled back.
  const m = readManifest('supabase/standards/manifests/mas.reply.20260203.2026-02-03.json')
  assert.equal(m.document.as_of_rule, 'any_date')
  const date = m.version.effective_from as string
  const sql = `BEGIN;
INSERT INTO public.standard_documents (document_key, title, publisher, binding_level, as_of_rule)
VALUES ('test.reply_20260203', 'Synthetic copy', 'Synthetic', '${m.document.binding_level}', '${m.document.as_of_rule}');
INSERT INTO public.standard_document_versions (document_id, version_label, effective_from, provenance)
SELECT id, 'v1', '${date}', 'publisher_site' FROM public.standard_documents WHERE document_key = 'test.reply_20260203';
INSERT INTO public.standard_clauses (version_id, clause_key, text_content, text_sha256)
SELECT v.id, 'test.reply_20260203/3.hold', 'Synthetic sentence.', '' FROM public.standard_document_versions v
JOIN public.standard_documents d ON d.id = v.document_id WHERE d.document_key = 'test.reply_20260203';
UPDATE public.standard_document_versions v SET status = 'verified', source_url = 'https://example.test/r.html',
  snapshot_path = 'synthetic/r.html', content_sha256 = repeat('f', 64), retrieved_at = now(), verified_by = 'synthetic', verified_at = now()
FROM public.standard_documents d WHERE d.id = v.document_id AND d.document_key = 'test.reply_20260203';
\\pset format unaligned
\\pset tuples_only on
SELECT 'early=' || outcome || '/' || read_on FROM public.read_clause_under_as_of_rule_v1('test.reply_20260203/3.hold', '2025-10-01', '2026-11-24');
SELECT 'same=' || outcome FROM public.read_clause_under_as_of_rule_v1('test.reply_20260203/3.hold', '${date}', '2026-11-24');
ROLLBACK;
`
  const run = spawnSync(process.env.STANDARDS_TEST_PSQL as string, { shell: true, input: sql, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.doesNotMatch(run.stderr, /ERROR/, run.stderr)
  assert.match(run.stdout, /early=held_after_the_events\/2026-11-24/)
  assert.match(run.stdout, /^same=held$/m)
})
