import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SectionCollector } from '../../supabase/functions/_shared/facts/rules/account-access-sequence.ts'
import {
  createStaticTermRequestSource,
  parseTermRequestRows,
  printFaultDefinition,
  productsForPayment,
  resolveTermRequest,
  TERM_OUTCOMES,
  TERM_PRODUCTS,
  TERM_PURPOSES,
  TERM_QUOTE_MODES,
} from '../../supabase/functions/_shared/facts/rules/institution-terms.ts'
import { createFakeClauseProvider, type DisputedPayment } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { cardOnlyCase, syntheticCorpus } from '../fixtures/fidrec-update/index.ts'

// Brief v5 4e (decision 12): a configured request per institution, product and purpose, resolved as of a date through
// the as-of functions. The rows are synthetic; Lane 5's seeds under supabase/standards/seeds/term-requests/ are read
// with the same parser.

const provider = createFakeClauseProvider(syntheticCorpus)
const MIGRATION = 'supabase/migrations/20261201120000_standards_corpus.sql'

const base = {
  institution: 'example_bank_a',
  product: 'credit_card',
  purpose: 'fault_definition',
  document_key: 'examplebanka.card_terms',
  selector: { clause_keys: ['examplebanka.card_terms/12'] },
  quote_mode: 'quote',
  term_outcome: 'defines',
  term: 'gross negligence',
  confirmed_by: 'synthetic-reviewer',
  confirmed_at: '2025-01-02T00:00:00Z',
}

test('the row shape follows institution_term_requests: products, purposes, quote modes and outcomes', () => {
  const sql = readFileSync(MIGRATION, 'utf8').replace(/\r\n/g, '\n')
  const table = sql.slice(sql.indexOf('CREATE TABLE public.institution_term_requests'), sql.indexOf('CREATE INDEX institution_term_requests'))
  for (const list of [TERM_PRODUCTS, TERM_PURPOSES, TERM_QUOTE_MODES, TERM_OUTCOMES]) {
    for (const v of list) assert.ok(table.includes(`'${v}'`), v)
  }
  for (const col of ['institution', 'product', 'purpose', 'document_key', 'selector', 'quote_mode', 'term_outcome', 'term', 'confirmed_by', 'confirmed_at']) {
    assert.match(table, new RegExp(`\\n  ${col} `), col)
  }
})

test('parse: a valid row, with quote mode defaulting to quote', () => {
  const [row] = parseTermRequestRows([{ ...base, quote_mode: undefined }])
  assert.equal(row.quote_mode, 'quote')
  assert.deepEqual(row.selector, { clause_keys: ['examplebanka.card_terms/12'] })
  const [tags] = parseTermRequestRows([{ ...base, selector: { tags: ['definition_gross_negligence'] }, confirmed_by: null, confirmed_at: null }])
  assert.deepEqual(tags.selector, { tags: ['definition_gross_negligence'] })
})

test('parse: rejects rows the table would refuse', () => {
  const bad: Array<[string, unknown]> = [
    ['product', { ...base, product: 'mortgage' }],
    ['purpose', { ...base, purpose: 'anything' }],
    ['document key', { ...base, document_key: 'Not A Key' }],
    ['selector of another document', { ...base, selector: { clause_keys: ['examplebankb.card_terms/9'] } }],
    ['empty selector', { ...base, selector: { clause_keys: [] } }],
    ['no selector', { ...base, selector: {} }],
    ['unknown tag', { ...base, selector: { tags: ['similar_to_negligence'] } }],
    ['quote mode', { ...base, quote_mode: 'paraphrase' }],
    ['outcome', { ...base, term_outcome: 'maybe' }],
    ['term missing', { ...base, term: null }],
    ['confirmed pair', { ...base, confirmed_at: null }],
  ]
  for (const [name, row] of bad) assert.throws(() => parseTermRequestRows([row]), undefined, name)
  assert.throws(() => parseTermRequestRows([base, { ...base, document_key: 'examplebanka.card_terms' }]), /duplicate/)
  assert.throws(() => parseTermRequestRows({ rows: [] }))
  // not_used needs no term.
  assert.equal(parseTermRequestRows([{ ...base, term_outcome: 'not_used', term: null }])[0].term, null)
})

test('resolve by confirmed clause keys, as of the date', async () => {
  const source = createStaticTermRequestSource(parseTermRequestRows([base]))
  const q = { institution: 'example_bank_a', product: 'credit_card' as const, purpose: 'fault_definition' as const }
  const held = await resolveTermRequest(source, provider, { ...q, onDate: '2025-09-12' })
  assert.equal(held.status, 'held')
  if (held.status === 'held') assert.deepEqual(held.clauses.map((c) => c.clause_key), ['examplebanka.card_terms/12'])
  // Before the first version: not held, naming what is missing.
  const early = await resolveTermRequest(source, provider, { ...q, onDate: '2023-12-31' })
  assert.equal(early.status, 'not_held')
  if (early.status === 'not_held') assert.deepEqual(early.missingClauseKeys, ['examplebanka.card_terms/12'])
  // A partial set is not held.
  const partial = createStaticTermRequestSource(parseTermRequestRows([{ ...base, selector: { clause_keys: ['examplebanka.card_terms/12', 'examplebanka.card_terms/99'] } }]))
  const p = await resolveTermRequest(partial, provider, { ...q, onDate: '2025-09-12' })
  assert.equal(p.status, 'not_held')
  if (p.status === 'not_held') assert.deepEqual(p.missingClauseKeys, ['examplebanka.card_terms/99'])
})

test('resolve by tags: only the request\'s own document and institution', async () => {
  const rows = parseTermRequestRows([
    { ...base, selector: { tags: ['definition_gross_negligence'] } },
    { ...base, institution: 'example_bank_b', document_key: 'examplebankb.card_terms', selector: { tags: ['definition_gross_negligence'] } },
  ])
  const source = createStaticTermRequestSource(rows)
  const a = await resolveTermRequest(source, provider, { institution: 'example_bank_a', product: 'credit_card', purpose: 'fault_definition', onDate: '2025-09-12' })
  assert.equal(a.status, 'held')
  if (a.status === 'held') assert.deepEqual(a.clauses.map((c) => c.clause_key), ['examplebanka.card_terms/12', 'examplebanka.card_terms/3'])
  const b = await resolveTermRequest(source, provider, { institution: 'example_bank_b', product: 'credit_card', purpose: 'fault_definition', onDate: '2025-09-12' })
  assert.equal(b.status, 'held')
  if (b.status === 'held') assert.deepEqual(b.clauses.map((c) => c.clause_key), ['examplebankb.card_terms/9'])
  // A tag no clause carries: not held.
  const none = createStaticTermRequestSource(parseTermRequestRows([{ ...base, selector: { tags: ['conclusive_evidence'] } }]))
  assert.equal((await resolveTermRequest(none, provider, { institution: 'example_bank_a', product: 'credit_card', purpose: 'fault_definition', onDate: '2025-09-12' })).status, 'not_held')
})

test('no request: an unknown institution, another product or purpose, or no institution code', async () => {
  const source = createStaticTermRequestSource(parseTermRequestRows([base]))
  for (const q of [
    { institution: 'example_bank_c', product: 'credit_card' as const, purpose: 'fault_definition' as const },
    { institution: 'example_bank_a', product: 'debit_card' as const, purpose: 'fault_definition' as const },
    { institution: 'example_bank_a', product: 'credit_card' as const, purpose: 'customer_security_duty' as const },
    { institution: null, product: 'credit_card' as const, purpose: 'fault_definition' as const },
  ]) {
    assert.equal((await resolveTermRequest(source, provider, { ...q, onDate: '2025-09-12' })).status, 'no_request', JSON.stringify(q))
  }
})

test('products a payment was made on', () => {
  const p = (instrument: DisputedPayment['instrument']) => ({ ...cardOnlyCase.data.payments[0], instrument })
  assert.deepEqual(productsForPayment(p('account_transfer'), []), ['account', 'digital_banking'])
  assert.deepEqual(productsForPayment(p('ewallet'), []), ['ewallet'])
  assert.deepEqual(productsForPayment(p('sg_card'), ['credit_card']), ['credit_card'])
  assert.deepEqual(productsForPayment(p('sg_card'), ['savings_or_current', 'debit_card']), ['debit_card'])
  assert.deepEqual(productsForPayment(p('sg_card'), []), ['credit_card', 'debit_card'])
  assert.deepEqual(productsForPayment(p('other'), []), [])
})

test('print: quoted clause with attribution, or reference and link; the fixed line from the person-set outcome', async () => {
  const lines = async (row: object, onDate = '2025-09-12') => {
    const out = new SectionCollector({ ...cardOnlyCase.data, provider })
    const resolved = await resolveTermRequest(createStaticTermRequestSource(parseTermRequestRows([row])), provider, {
      institution: 'example_bank_a',
      product: 'credit_card',
      purpose: 'fault_definition',
      onDate,
    })
    printFaultDefinition(out, resolved, 'Example Bank A')
    return { texts: out.lines.map((l) => (l.kind === 'text' ? l.text : '')), out }
  }
  const quoted = await lines(base)
  assert.deepEqual(quoted.texts, [
    "Example Bank A's Synthetic card terms of Example Bank A, version in force on 12 September 2025, clause 12:",
    '"Placeholder definition clause of Example Bank A."',
    "The clause defines 'gross negligence'.",
  ])
  assert.equal(quoted.out.citations[0].clauseId, 'cl-bank-a-12')
  const ref = await lines({ ...base, quote_mode: 'reference_only', term_outcome: 'uses_undefined' })
  assert.deepEqual(ref.texts, [
    "Example Bank A's Synthetic card terms of Example Bank A, version in force on 12 September 2025, clause 12: https://example.com/bank-a-card-terms.pdf",
    "The terms use 'gross negligence' and do not define it.",
  ])
  assert.ok(!ref.texts.some((t) => t.includes('Placeholder definition clause')), 'reference_only never quotes')
  const notUsed = await lines({ ...base, term_outcome: 'not_used', term: null })
  assert.equal(notUsed.texts[notUsed.texts.length - 1], 'The terms in force on 12 September 2025 do not use the terms negligence, gross negligence or recklessness.')
  const unset = await lines({ ...base, term_outcome: null, term: null })
  assert.equal(unset.texts.length, 2, 'no fixed line until a person sets the outcome')
  const early = await lines(base, '2023-06-01')
  assert.deepEqual(early.texts, ["Example Bank A's terms in force on 1 June 2023 are not held."])
  assert.deepEqual(early.out.flags, [{ code: 'clause_not_held', key: 'examplebanka.card_terms/12', onDate: '2023-06-01' }])
})
