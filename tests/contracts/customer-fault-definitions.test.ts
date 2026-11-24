import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ABS_MAS_REPLY_CLOSING_LINE,
  ACCOUNT_STATEMENT_KEYS,
  buildCustomerFaultDefinitions,
  CARD_STATEMENT_KEYS,
  createCustomerFaultDefinitionsBuilder,
} from '../../supabase/functions/_shared/facts/rules/customer-fault-definitions.ts'
import { createStaticTermRequestSource, parseTermRequestRows } from '../../supabase/functions/_shared/facts/rules/institution-terms.ts'
import {
  ALL_STATEMENT_KEYS,
  createFakeClauseProvider,
  type SectionLine,
  type SectionResult,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import {
  accountSrfCase,
  cardOnlyCase,
  EUPG_A_TO,
  FIDREC_UPDATE_CASES,
  mixedCase,
  noTechnicalRecordsCase,
  syntheticCorpus,
} from '../fixtures/fidrec-update/index.ts'
import { H, lane4Corpus, statement, verdictFree } from './sequence-fault-corpus.ts'

// Brief v5 4d (decisions 11, 13): per framework that applies to the payments, the reviewed statements by key, in the
// revision approved for the wording in force on the payment date; then the institution's terms (4e).

const fake = createFakeClauseProvider(syntheticCorpus)
const statements = (r: SectionResult) =>
  r.lines.filter((l): l is Extract<SectionLine, { kind: 'statement' }> => l.kind === 'statement').map((l) => l.statement)
const texts = (r: SectionResult) => r.lines.filter((l): l is Extract<SectionLine, { kind: 'text' }> => l.kind === 'text').map((l) => l.text)

const ACCOUNT = [...ACCOUNT_STATEMENT_KEYS.eupg, ...ACCOUNT_STATEMENT_KEYS.srf]
const CARD_SECTION5 = ['eupg.fault.level1', 'eupg.fault.level2', 'eupg.fault.institution', 'eupg.fault.reasons', 'eupg.fault.examples', 'eupg.fault.term']

test('every statement key the section prints is a contract key', () => {
  for (const k of [...ACCOUNT, ...Object.values(CARD_STATEMENT_KEYS).flat(), 'mas.reply.20250107.3ds', 'mas.reply.20250107.no3ds']) {
    assert.ok((ALL_STATEMENT_KEYS as readonly string[]).includes(k), k)
  }
})

test('account case: EUPG then SRF account statements, in brief order; no card statements', async () => {
  const r = await buildCustomerFaultDefinitions({ ...accountSrfCase.data, provider: fake })
  assert.equal(r.sectionId, 'customer_fault_definitions')
  assert.deepEqual(statements(r).map((s) => s.statementKey), ACCOUNT)
  // eupg.fault.term is approved in the Step 0 corpus; the rest print by key with "summary under review".
  const term = statements(r)[0]
  assert.equal(term.text, 'Placeholder statement eupg.fault.term, revision 1.')
  assert.equal(term.onDate, '2025-07-03')
  assert.ok(r.citations.some((c) => c.clauseKey === 'mas.eupg/5.2' && c.versionLabel === 'A'))
  for (const s of statements(r).slice(1)) assert.equal(s.text, null, s.statementKey)
  assert.ok(r.flags.some((f) => f.code === 'statement_under_review' && f.key === 'srf.fault.terms'))
  assert.ok(!r.flags.some((f) => f.key === 'eupg.fault.term'))
})

test('card-only case: the EUPG and SRF card exclusions and the card code; no EUPG Section 5 statement', async () => {
  const r = await buildCustomerFaultDefinitions({ ...cardOnlyCase.data, provider: fake })
  const keys = statements(r).map((s) => s.statementKey)
  assert.deepEqual(keys, ['eupg.fault.cards', 'srf.fault.cards', ...CARD_STATEMENT_KEYS.abs, 'mas.reply.20250107.3ds'])
  for (const k of CARD_SECTION5) assert.ok(!keys.includes(k as never), k)
  assert.ok(!keys.includes('mas.reply.20250107.no3ds'), 'no payment without authentication')
})

test('mixed case: account and card statements, the no-3DS reply dated by the payment without authentication', async () => {
  const r = await buildCustomerFaultDefinitions({ ...mixedCase.data, provider: fake })
  const s = statements(r)
  assert.deepEqual(s.map((x) => x.statementKey), [
    ...ACCOUNT_STATEMENT_KEYS.eupg,
    'eupg.fault.cards',
    ...ACCOUNT_STATEMENT_KEYS.srf,
    'srf.fault.cards',
    ...CARD_STATEMENT_KEYS.abs,
    'mas.reply.20250107.3ds',
    'mas.reply.20250107.no3ds',
  ])
  assert.equal(s.find((x) => x.statementKey === 'mas.reply.20250107.no3ds')!.onDate, '2025-05-21')
  assert.equal(s.find((x) => x.statementKey === 'mas.reply.20250107.3ds')!.onDate, '2025-05-20')
})

test('e-wallet case with no technical record: the account statements, and the institution\'s terms not held', async () => {
  const r = await buildCustomerFaultDefinitions({ ...noTechnicalRecordsCase.data, provider: fake })
  assert.deepEqual(statements(r).map((s) => s.statementKey), ACCOUNT)
  assert.deepEqual(texts(r), ["Example Pay's terms in force on 2 August 2025 are not held."])
})

test('a case spanning a version change prints each revision, each with its own date', async () => {
  const corpus = lane4Corpus([
    statement('eupg.fault.institution', 'eupg', [['mas.eupg/4.7', H.eupg47a]], { revision: 1 }),
    statement('eupg.fault.institution', 'eupg', [['mas.eupg/4.7', H.eupg47b]], { revision: 2 }),
  ])
  const payments = accountSrfCase.data.payments.map((p, i) => ({ ...p, date: i === 0 ? '2025-12-31' : EUPG_A_TO }))
  const r = await buildCustomerFaultDefinitions({ ...accountSrfCase.data, payments, provider: createFakeClauseProvider(corpus) })
  const inst = statements(r).filter((s) => s.statementKey === 'eupg.fault.institution')
  assert.deepEqual(inst.map((s) => [s.revision, s.onDate]), [[1, '2025-12-31'], [2, EUPG_A_TO]])
  // Unchanged wording prints once.
  assert.equal(statements(r).filter((s) => s.statementKey === 'eupg.fault.term').length, 1)
})

test('a statement whose clause hash no longer matches does not print its text', async () => {
  const corpus = lane4Corpus([statement('eupg.fault.level2', 'eupg', [['mas.eupg/4.7', H.eupg47a]])])
  const payments = accountSrfCase.data.payments.map((p) => ({ ...p, date: EUPG_A_TO }))
  const r = await buildCustomerFaultDefinitions({ ...accountSrfCase.data, payments, provider: createFakeClauseProvider(corpus) })
  assert.equal(statements(r).find((s) => s.statementKey === 'eupg.fault.level2')!.text, null)
  assert.ok(r.flags.some((f) => f.code === 'statement_under_review' && f.key === 'eupg.fault.level2' && f.onDate === EUPG_A_TO))
})

test('eupg.fault.examples is followed by footnote 20 printed from the corpus', async () => {
  const corpus = lane4Corpus([statement('eupg.fault.examples', 'eupg', [['mas.eupg/fn20', H.fn20]])])
  const r = await buildCustomerFaultDefinitions({ ...accountSrfCase.data, provider: createFakeClauseProvider(corpus) })
  const i = r.lines.findIndex((l) => l.kind === 'statement' && l.statement.statementKey === 'eupg.fault.examples')
  const next = r.lines[i + 1]
  assert.equal(next.kind, 'text')
  if (next.kind === 'text') {
    assert.equal(next.text, '"Placeholder text of footnote 20."')
    assert.deepEqual(next.clauseKeys, ['mas.eupg/fn20'])
  }
  assert.ok(r.citations.some((c) => c.clauseKey === 'mas.eupg/fn20'))
})

test('the closing line prints only when both the card code and the MAS reply statements print', async () => {
  const abs = statement('abs.fault.term', 'abs_card_code', [['abs.card_code/5', H.abs5]])
  const reply = statement('mas.reply.20250107.3ds', 'mas_reply', [['mas.reply_20250107/3ds', H.reply]])
  const both = await buildCustomerFaultDefinitions({ ...cardOnlyCase.data, provider: createFakeClauseProvider(lane4Corpus([abs, reply])) })
  assert.ok(texts(both).includes(ABS_MAS_REPLY_CLOSING_LINE))
  const one = await buildCustomerFaultDefinitions({ ...cardOnlyCase.data, provider: createFakeClauseProvider(lane4Corpus([abs])) })
  assert.ok(!texts(one).includes(ABS_MAS_REPLY_CLOSING_LINE))
})

test('the institution\'s configured definition prints as of the payment date, quoted, with the person-set line', async () => {
  const rows = parseTermRequestRows([
    {
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
    },
  ])
  const build = createCustomerFaultDefinitionsBuilder({ termRequests: createStaticTermRequestSource(rows) })
  const r = await build({ ...cardOnlyCase.data, provider: fake })
  const t = texts(r)
  assert.deepEqual(t.slice(-3), [
    "Example Bank A's Synthetic card terms of Example Bank A, version in force on 12 September 2025, clause 12:",
    '"Placeholder definition clause of Example Bank A."',
    "The clause defines 'gross negligence'.",
  ])
  assert.ok(r.citations.some((c) => c.clauseKey === 'examplebanka.card_terms/12' && c.onDate === '2025-09-12'))
  // A payment before the terms' first version: not held.
  const early = cardOnlyCase.data.payments.map((p) => ({ ...p, date: '2023-06-01' }))
  const r2 = await build({ ...cardOnlyCase.data, payments: early, provider: fake })
  assert.ok(texts(r2).includes("Example Bank A's terms in force on 1 June 2023 are not held."))
  assert.ok(r2.flags.some((f) => f.code === 'clause_not_held' && f.key === 'examplebanka.card_terms/12'))
})

test('no verdict wording in any line the section writes', async () => {
  assert.equal(verdictFree('The complainant was negligent.'), false)
  const provider = createFakeClauseProvider(lane4Corpus())
  for (const c of FIDREC_UPDATE_CASES) {
    const r = await buildCustomerFaultDefinitions({ ...c.data, provider })
    for (const t of texts(r)) assert.ok(verdictFree(t), `${c.id}: ${t}`)
  }
})
