// The database-backed ClauseProvider (Lane 6, assembly). Two parts:
// 1) Always: the provider maps the functions' rows into the contract's shapes, remembers each read, and its errors
//    name only the function and the code.
// 2) With a local database (FIDREC_UPDATE_TEST_DATABASE_URL, a localhost URL with every migration applied): the
//    synthetic corpus and the shared as-of case table (tests/fixtures/fidrec-update/as-of-rule-cases.json) are
//    loaded inside a transaction that is rolled back, and the database provider must give what the fake provider
//    gives for every read. Never a hosted database. Synthetic data only.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import pg from 'pg'
import {
  type AsOfRuleCase,
  type ClauseAsOf,
  type ClauseProvider,
  createFakeClauseProvider,
  type FakeCorpus,
  type FakeCorpusVersion,
  readUnderAsOfRule,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { createDbClauseProvider, type RpcCall } from '../../supabase/functions/_shared/facts/update/db-clause-provider.ts'
import { syntheticCorpus } from '../fixtures/fidrec-update/index.ts'

const AS_OF_CASES = (JSON.parse(readFileSync('tests/fixtures/fidrec-update/as-of-rule-cases.json', 'utf8')) as { cases: AsOfRuleCase[] }).cases

// ---------------------------------------------------------------------------------------------------------------
// 1) Without a database
// ---------------------------------------------------------------------------------------------------------------

const ROW = {
  clause_id: '00000000-0000-4000-8000-000000000001',
  clause_key: 'mas.eupg/4.7',
  clause_ref: '4.7',
  heading_path: '{Section 4,"Cooling off"}',
  text_content: 'Placeholder text of 4.7.',
  text_sha256: 'a'.repeat(64),
  tags: [],
  version_id: '00000000-0000-4000-8000-000000000002',
  version_label: 'A',
  effective_from: '2024-12-16',
  effective_to: null,
  document_key: 'mas.eupg',
  title: 'Synthetic EUPG',
  publisher: 'Synthetic regulator',
  binding_level: 'guideline',
  institution: null,
  card_scheme: null,
  source_url: 'https://example.com/eupg.pdf',
  coverage: 'full',
  instrument_scope: ['account_transfer', 'ewallet'],
}

function cannedRpc(answers: Record<string, unknown>, calls: string[] = []): RpcCall {
  return (fn, args) => {
    calls.push(`${fn}:${JSON.stringify(args)}`)
    if (fn in answers) return Promise.resolve({ data: answers[fn], error: null })
    return Promise.resolve({ data: null, error: { code: 'PGRST202', message: `function ${fn} with the case's facts` } })
  }
}

test('db provider: rows map to the contract shapes, arrays and dates included', async () => {
  const p = createDbClauseProvider(cannedRpc({
    get_clause_as_of_v1: [ROW],
    get_clause_nearest_v1: [{ ...ROW, relation: 'later_version', effective_from: '2025-06-16T00:00:00' }],
    get_statement_as_of_v1: [{ statement_id: 's1', statement_key: 'eupg.fault.term', revision: 2, framework: 'eupg', applies_to_instrument: '{account_transfer}', text: 'Placeholder.', clause_keys: ['mas.eupg/5.2'], clauses_as_of: '2025-01-01', approved_by: 'synthetic', approved_at: '2025-01-02T00:00:00Z' }],
    get_document_as_of_rule_v1: 'any_date',
    get_clauses_by_tag_v1: [ROW, { ...ROW, clause_key: 'mas.eupg/5.2' }],
  }))
  const c = await p.getClauseAsOf('mas.eupg/4.7', '2025-03-01')
  assert.deepEqual(c?.heading_path, ['Section 4', 'Cooling off'])
  assert.deepEqual(c?.instrument_scope, ['account_transfer', 'ewallet'])
  assert.equal(c?.effective_to, null)
  const n = await p.getNearestClause('mas.eupg/4.7', '2025-03-01')
  assert.equal(n?.relation, 'later_version')
  assert.equal(n?.clause.effective_from, '2025-06-16')
  const s = await p.getStatementAsOf('eupg.fault.term', '2025-03-01')
  assert.deepEqual(s?.applies_to_instrument, ['account_transfer'])
  assert.equal(s?.revision, 2)
  assert.equal(await p.getAsOfRule('mas.reply.20260113'), 'any_date')
  assert.equal((await p.getClausesByTag('customer_security_duty', 'example_bank_a', '2025-03-01')).length, 2)
})

test('db provider: an empty answer is "not held"; a statement with no approved revision is null (under review)', async () => {
  const p = createDbClauseProvider(cannedRpc({ get_clause_as_of_v1: [], get_statement_as_of_v1: [], get_clause_nearest_v1: [], get_document_as_of_rule_v1: [{ get_document_as_of_rule_v1: 'event_date' }] }))
  assert.equal(await p.getClauseAsOf('mas.eupg/4.21', '2025-03-01'), null)
  assert.equal(await p.getStatementAsOf('eupg.section8.charges', '2025-03-01'), null)
  assert.equal(await p.getNearestClause('visa.core_rules/11.2.2', '2025-03-01'), null)
  assert.equal(await p.getAsOfRule('mas.eupg'), 'event_date')
})

test('db provider: each read is made once per pack; a failed read is not remembered; errors carry no values', async () => {
  const calls: string[] = []
  const p = createDbClauseProvider(cannedRpc({ get_clause_as_of_v1: [ROW] }, calls))
  await p.getClauseAsOf('mas.eupg/4.7', '2025-03-01')
  await p.getClauseAsOf('mas.eupg/4.7', '2025-03-01')
  await p.getClauseAsOf('mas.eupg/4.7', '2025-03-02')
  assert.equal(calls.length, 2)
  await assert.rejects(p.getStatementAsOf('eupg.fault.term', '2025-03-01'), (e: Error) => {
    assert.equal(e.message, 'clause provider: get_statement_as_of_v1 failed (PGRST202)')
    return true
  })
  await assert.rejects(p.getStatementAsOf('eupg.fault.term', '2025-03-01'))
  assert.equal(calls.filter((c) => c.startsWith('get_statement_as_of_v1')).length, 2, 'retried, not remembered')
  // As in the fake provider, a date that is not YYYY-MM-DD is refused before any call.
  assert.throws(() => p.getClauseAsOf('mas.eupg/4.7', '1 March 2025'), /not a date/)
})

test('db provider: two versions in force on one date is an error, as in the fake', async () => {
  const p = createDbClauseProvider(cannedRpc({ get_clause_as_of_v1: [ROW, { ...ROW, version_label: 'B' }] }))
  await assert.rejects(p.getClauseAsOf('mas.eupg/4.7', '2025-03-01'), /in force in 2 versions/)
})

// ---------------------------------------------------------------------------------------------------------------
// 2) Against a local database
// ---------------------------------------------------------------------------------------------------------------

const DATABASE_URL = process.env.FIDREC_UPDATE_TEST_DATABASE_URL
const NO_DATABASE = !DATABASE_URL

function requireLocal(url: string): void {
  const host = new URL(url).hostname
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) throw new Error('FIDREC_UPDATE_TEST_DATABASE_URL must be a local database')
}

const SIGNATURES: Record<string, string> = {
  get_clause_as_of_v1: 'public.get_clause_as_of_v1($1::text, $2::date)',
  get_clauses_by_tag_v1: 'public.get_clauses_by_tag_v1($1::text, $2::text, $3::date)',
  get_statement_as_of_v1: 'public.get_statement_as_of_v1($1::text, $2::date)',
  get_clause_nearest_v1: 'public.get_clause_nearest_v1($1::text, $2::date)',
}

function pgRpc(client: pg.Client): RpcCall {
  return async (fn, args) => {
    try {
      if (fn === 'get_document_as_of_rule_v1') {
        const r = await client.query('select public.get_document_as_of_rule_v1($1::text) as rule', [args.p_document_key])
        return { data: r.rows[0].rule, error: null }
      }
      const r = await client.query(`select coalesce(json_agg(t), '[]'::json) as rows from ${SIGNATURES[fn]} t`, Object.values(args))
      return { data: r.rows[0].rows, error: null }
    } catch (e) {
      return { data: null, error: { code: (e as { code?: string }).code ?? null } }
    }
  }
}

/** Loads a fake corpus: documents, versions in date order (drafts stay drafts), clauses; then approved statements. */
async function loadCorpus(client: pg.Client, corpus: FakeCorpus): Promise<{ statementsLoaded: string[] }> {
  const documents = new Map<string, string>()
  const versions = [...corpus.versions].sort((a, b) => (a.effective_from ?? '').localeCompare(b.effective_from ?? ''))
  for (const v of versions) {
    let documentId = documents.get(v.document_key)
    if (!documentId) {
      if (v.institution) {
        await client.query('insert into public.standard_institutions (code, name) values ($1, $2) on conflict do nothing', [v.institution, `Synthetic ${v.institution}`])
      }
      const level = v.as_of_rule === 'any_date' ? 'announcement' : v.binding_level
      const r = await client.query(
        `insert into public.standard_documents (document_key, title, publisher, binding_level, applies_to, instrument_scope, institution, card_scheme, as_of_rule)
         values ($1, $2, $3, $4, '{bank}', $5::text[], $6, $7, $8) returning id`,
        [v.document_key, v.title, v.publisher, level, v.document_instrument_scope, v.institution, v.card_scheme, v.as_of_rule ?? 'event_date'],
      )
      documentId = r.rows[0].id as string
      documents.set(v.document_key, documentId)
    }
    const version = await client.query(
      `insert into public.standard_document_versions (document_id, version_label, effective_from, effective_to, provenance, coverage)
       values ($1, $2, $3::date, $4::date, 'publisher_site', $5) returning id`,
      [documentId, v.version_label, v.effective_from, v.effective_to, v.coverage],
    )
    const versionId = version.rows[0].id as string
    for (const c of v.clauses) {
      await client.query(
        `insert into public.standard_clauses (version_id, clause_key, clause_ref, heading_path, text_content, text_sha256, tags, effective_from_override, instrument_scope)
         values ($1, $2, $3, $4::text[], $5, $6, $7::text[], $8::date, $9::text[])`,
        [versionId, c.clause_key, c.clause_ref ?? null, c.heading_path ?? [], c.text_content, c.text_sha256, c.tags ?? [], c.effective_from_override ?? null, c.instrument_scope ?? null],
      )
    }
    if (v.status === 'verified') {
      await client.query(
        `update public.standard_document_versions
         set status = 'verified', source_url = coalesce($2, 'https://example.test/synthetic.pdf'), snapshot_path = 'synthetic/' || $1::text,
             content_sha256 = repeat('d', 64), retrieved_at = now(), verified_by = 'synthetic reviewer', verified_at = now()
         where id = $1`,
        [versionId, v.source_url],
      )
    }
  }
  const statementsLoaded: string[] = []
  for (const s of [...corpus.statements].sort((a, b) => a.revision - b.revision)) {
    if (s.status !== 'approved') continue
    await client.query('savepoint statement')
    try {
      await client.query(
        `insert into public.definition_statements (statement_key, revision, framework, applies_to_instrument, text, clause_keys, status, approved_by, approved_at, clauses_as_of)
         values ($1, $2, $3, $4::text[], $5, $6::text[], 'approved', $7, $8::timestamptz, $9::date)`,
        [s.statement_key, s.revision, s.framework, s.applies_to_instrument, s.text, s.clause_keys, s.approved_by, s.approved_at, s.clauses_as_of],
      )
      await client.query('release savepoint statement')
      statementsLoaded.push(`${s.statement_key} r${s.revision}`)
    } catch {
      await client.query('rollback to savepoint statement')
    }
  }
  return { statementsLoaded }
}

/** The shared as-of case table as one fake corpus: one version per document, as Lane 1's SQL test loads it. */
function asOfCorpus(): FakeCorpus {
  const byDocument = new Map<string, FakeCorpusVersion>()
  for (const c of AS_OF_CASES) {
    const v = byDocument.get(c.documentKey) ?? {
      version_id: `ver-${c.documentKey}`,
      document_key: c.documentKey,
      title: 'Synthetic document',
      publisher: 'Synthetic publisher',
      binding_level: c.asOfRule === 'any_date' ? 'announcement' : 'guideline',
      institution: null,
      card_scheme: null,
      document_instrument_scope: ['account_transfer', 'sg_card'],
      version_label: 'v1',
      effective_from: c.documentDate,
      effective_to: null,
      status: 'verified',
      source_url: `https://example.test/${c.documentKey}.pdf`,
      coverage: 'full',
      as_of_rule: c.asOfRule,
      clauses: [],
    } satisfies FakeCorpusVersion
    if (!v.clauses.some((x) => x.clause_key === c.clauseKey)) {
      v.clauses.push({ clause_id: `cl-${c.clauseKey}`, clause_key: c.clauseKey, text_content: `Synthetic text of ${c.clauseKey}.`, text_sha256: 'e'.repeat(64), effective_from_override: c.clauseStart })
    }
    byDocument.set(c.documentKey, v)
  }
  return { versions: [...byDocument.values()], statements: [] }
}

/** What both providers must agree on (ids differ, and the database hashes the text itself; the fake's hashes are stand-ins). */
const same = (c: ClauseAsOf | null) =>
  c && {
    clause_key: c.clause_key,
    clause_ref: c.clause_ref,
    text_content: c.text_content,
    version_label: c.version_label,
    effective_from: c.effective_from,
    effective_to: c.effective_to,
    document_key: c.document_key,
    institution: c.institution,
    instrument_scope: [...c.instrument_scope].sort(),
    tags: [...c.tags].sort(),
  }

async function withDatabase(run: (client: pg.Client) => Promise<void>): Promise<void> {
  requireLocal(DATABASE_URL as string)
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    await client.query('begin')
    await run(client)
  } finally {
    await client.query('rollback').catch(() => undefined)
    await client.end()
  }
}

test('db provider (local database): every row of the shared as-of case table gives the expected outcome, as the fake does', { skip: NO_DATABASE }, async () => {
  await withDatabase(async (client) => {
    const corpus = asOfCorpus()
    await loadCorpus(client, corpus)
    const db = createDbClauseProvider(pgRpc(client))
    const fake = createFakeClauseProvider(corpus)
    assert.ok(AS_OF_CASES.length >= 8)
    for (const c of AS_OF_CASES) {
      const fromDb = await readUnderAsOfRule(db, c.documentKey, c.clauseKey, c.eventDate, c.generatedOn)
      const fromFake = await readUnderAsOfRule(fake, c.documentKey, c.clauseKey, c.eventDate, c.generatedOn)
      assert.equal(fromDb.outcome, c.expected, `${c.id}: ${c.standsFor}`)
      assert.equal(fromDb.outcome, fromFake.outcome, c.id)
      assert.equal(fromDb.readOn, fromFake.readOn, c.id)
      assert.deepEqual(same(fromDb.clause), same(fromFake.clause), c.id)
    }
  })
})

test('db provider (local database): clause, tag, statement and nearest-version reads match the fake provider on the synthetic corpus', { skip: NO_DATABASE }, async () => {
  await withDatabase(async (client) => {
    const { statementsLoaded } = await loadCorpus(client, syntheticCorpus)
    // The approval trigger records the wording in force on clauses_as_of, which is what the fake's checked_wording holds.
    assert.deepEqual(statementsLoaded.sort(), ['eupg.fault.term r1', 'link.eupg_s4 r1', 'srf.newdevice.bank r1', 'srf.newdevice.bank r2'])
    const db: ClauseProvider = createDbClauseProvider(pgRpc(client))
    const fake = createFakeClauseProvider(syntheticCorpus)
    const dates = ['2023-12-31', '2024-01-01', '2024-12-15', '2024-12-16', '2025-06-15', '2025-06-16', '2025-12-31', '2026-01-01', '2026-06-01', '2026-11-24']
    const keys = [...new Set(syntheticCorpus.versions.flatMap((v) => v.clauses.map((c) => c.clause_key))), 'mas.eupg/4.21']
    for (const onDate of dates) {
      for (const key of keys) {
        assert.deepEqual(same(await db.getClauseAsOf(key, onDate)), same(await fake.getClauseAsOf(key, onDate)), `${key} on ${onDate}`)
        const [n1, n2] = [await db.getNearestClause(key, onDate), await fake.getNearestClause(key, onDate)]
        assert.equal(n1?.relation ?? null, n2?.relation ?? null, `nearest ${key} on ${onDate}`)
        assert.deepEqual(same(n1?.clause ?? null), same(n2?.clause ?? null), `nearest ${key} on ${onDate}`)
      }
      for (const institution of ['example_bank_a', 'example_bank_b', null]) {
        const a = (await db.getClausesByTag('definition_gross_negligence', institution, onDate)).map(same)
        const b = (await fake.getClausesByTag('definition_gross_negligence', institution, onDate)).map(same)
        assert.deepEqual(a, b, `tag for ${institution} on ${onDate}`)
      }
      for (const key of ['eupg.fault.term', 'srf.newdevice.bank', 'link.eupg_s4', 'abs.fault.term', 'eupg.section8.charges']) {
        const [s1, s2] = [await db.getStatementAsOf(key, onDate), await fake.getStatementAsOf(key, onDate)]
        assert.equal(s1?.revision ?? null, s2?.revision ?? null, `${key} on ${onDate}`)
        assert.equal(s1?.text ?? null, s2?.text ?? null, `${key} on ${onDate}`)
      }
    }
    assert.equal(await db.getAsOfRule('mas.eupg'), 'event_date')
    assert.equal(await db.getAsOfRule('test.not_held'), 'event_date')
  })
})
