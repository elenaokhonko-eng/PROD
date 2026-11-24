import assert from 'node:assert/strict'
import test from 'node:test'
import { normaliseInstitution } from '../../supabase/functions/_shared/facts/institutions.ts'
import { FIDREC_CLAUSE_KEYS, FIDREC_RULES } from '../../supabase/functions/_shared/facts/rules/fidrec.ts'
import { SRF_CLAUSE_KEYS, SRF_REASON_CODES } from '../../supabase/functions/_shared/facts/rules/srf.ts'
import { CLAUSE_KEYS, STATEMENT_FRAMEWORKS, STATEMENT_KEYS } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { buildSeedSql, manifestClauses, readInstitutions, readStatements, ruleCitations } from '../../scripts/standards/seeds.ts'

// Lane 1 seeds: institutions (from institutions.ts), statement drafts (brief 4d, 4a), and the server rules' clause-key
// citations (brief section 2, 3.2 rule 7). Clause keys resolve against the committed manifests; the database side
// (approval, as-of reads) is covered by scripts/sql/tests/test_standards_*.sql.

const clauses = manifestClauses()
const statements = readStatements()

test('institutions: fixed codes, unique names and aliases, each the name institutions.ts gives', () => {
  const institutions = readInstitutions()
  const seen = new Set<string>()
  for (const i of institutions) {
    assert.match(i.code, /^[a-z0-9]+(_[a-z0-9]+)*$/, i.code)
    for (const alias of [i.name, ...i.aliases]) {
      const lower = alias.toLowerCase()
      assert.ok(!seen.has(lower), `${alias} is listed twice`)
      seen.add(lower)
    }
    for (const alias of i.aliases) {
      assert.deepEqual(normaliseInstitution(alias), { name: i.name, type: i.type }, `${alias} does not normalise to ${i.name}`)
    }
    // institutions.ts does not match every canonical name on its own (a bare "Wise" is too common a word); such an
    // entry needs an alias that it does match.
    const own = normaliseInstitution(i.name)
    if (own?.type === 'other') assert.ok(i.aliases.length > 0, `${i.name} needs an alias institutions.ts recognises`)
    else assert.deepEqual(own, { name: i.name, type: i.type }, `${i.name} does not normalise to itself`)
  }
  assert.equal(new Set(institutions.map((i) => i.code)).size, institutions.length)
})

test('statement drafts: exactly the contract keys Lane 1 owns, one revision each', () => {
  const owned = [...STATEMENT_KEYS.eupg, ...STATEMENT_KEYS.srf, ...STATEMENT_KEYS.abs, ...STATEMENT_KEYS.mas_reply, ...STATEMENT_KEYS.link]
  assert.deepEqual(statements.map((s) => s.statement_key).sort(), [...owned].sort())
  for (const s of statements) {
    assert.equal(s.revision, 1, s.statement_key)
    assert.ok((STATEMENT_FRAMEWORKS as readonly string[]).includes(s.framework), s.statement_key)
    assert.ok(s.text.trim().length > 0, s.statement_key)
    assert.ok(s.applies_to_instrument.length > 0, s.statement_key)
    const prefix = s.statement_key.split('.')[0]
    assert.ok(s.file.startsWith(`${prefix}.`) || (prefix === 'mas' && s.file === 'mas.reply.json'), `${s.statement_key} is in ${s.file}`)
  }
})

test('every statement clause is held, and passes the approval scope check (exclusions leave the payment types out)', () => {
  for (const s of statements) {
    assert.ok(s.clause_keys.length > 0, s.statement_key)
    for (const key of s.exclusion_clause_keys) assert.ok(s.clause_keys.includes(key), `${s.statement_key}: ${key} flagged but not cited`)
    for (const key of s.clause_keys) {
      const clause = clauses.get(key)
      assert.ok(clause, `${s.statement_key}: ${key} is not in any manifest`)
      if (s.exclusion_clause_keys.includes(key)) {
        assert.ok(s.applies_to_instrument.every((i) => !clause.scope.includes(i)), `${s.statement_key}: ${key} applies to its payment types`)
      } else {
        assert.ok(s.applies_to_instrument.every((i) => clause.scope.includes(i)), `${s.statement_key}: ${key} is narrower than the statement`)
      }
    }
  }
})

test('card statements cite their paragraphs as exclusions; account statements never speak for cards', () => {
  const byKey = new Map(statements.map((s) => [s.statement_key, s]))
  assert.deepEqual(byKey.get('eupg.fault.cards')?.exclusion_clause_keys, ['mas.eupg/5.1', 'mas.eupg/fn3'])
  assert.deepEqual(byKey.get('srf.fault.cards')?.exclusion_clause_keys, ['mas.srf/fn1'])
  for (const key of ['link.srf_4_2', 'link.eupg_s4', 'bridge.mas_requirement']) {
    assert.ok(!byKey.get(key)?.applies_to_instrument.includes('sg_card'), key)
  }
})

test('every rule citation in srf.ts and fidrec.ts resolves to a held clause', () => {
  assert.deepEqual([...SRF_REASON_CODES].sort(), Object.keys(SRF_CLAUSE_KEYS).sort())
  assert.deepEqual(Object.keys(FIDREC_CLAUSE_KEYS).sort(), Object.keys(FIDREC_RULES).sort())
  for (const [code, keys] of Object.entries(SRF_CLAUSE_KEYS)) {
    // The effective date is the version's, not a clause's.
    if (code !== 'before_effective_date') assert.ok(keys.length > 0, code)
  }
  const rows = ruleCitations()
  assert.ok(rows.length > 0)
  for (const row of rows) {
    assert.match(row.rule_id, /^[a-z0-9_]+(\.[a-z0-9_]+)*$/, row.rule_id)
    assert.ok(clauses.has(row.clause_key), `${row.rule_id} cites ${row.clause_key}, which no manifest holds`)
  }
})

test('the contract clause keys of every loaded document resolve', () => {
  const loaded = new Set([...clauses.keys()].map((k) => k.split('/')[0]))
  for (const key of Object.values(CLAUSE_KEYS).flat()) {
    if (loaded.has(key.split('/')[0])) assert.ok(clauses.has(key), `${key} is cited by the contract but not held`)
  }
})

test('the seed SQL writes statements as drafts only and guards every write', () => {
  const sql = buildSeedSql({ institutions: readInstitutions(), statements, citations: ruleCitations() })
  assert.doesNotMatch(sql, /'approved'|approved_by|approved_at|clauses_as_of/)
  assert.match(sql, /standards_seed_statement_not_draft/)
  assert.match(sql, /ON CONFLICT \(code\) DO NOTHING/)
  assert.match(sql, /IS DISTINCT FROM/)
})
