import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildCardDisputeComparison,
  calendarDaysBetween,
  CARD_DISPUTE_CLAUSE_KEYS,
  CARD_DISPUTE_RULE_CLAUSE_KEYS,
  SCHEME_STANDING_SENTENCE,
} from '../../supabase/functions/_shared/facts/rules/card-dispute-checks.ts'
import {
  ALL_STATEMENT_KEYS,
  type CardAuthEvent,
  CLAUSE_KEYS,
  type ComparisonLine,
  createFakeClauseProvider,
  type FakeCorpus,
  type FakeStatement,
  type SectionInput,
  type SectionLine,
  type SectionResult,
  type StatementKey,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { accountSrfCase, cardOnlyCase, type CaseSectionData, mixedCase, noTechnicalRecordsCase } from '../fixtures/fidrec-update/index.ts'

// Lane 5, brief v5 Phase 7: card_dispute_comparison against the contract and the fake provider. The corpus below is
// synthetic: placeholder clause texts and stand-in hashes, not the schemes' wording.

const sha = (c: string) => c.repeat(64)
const VISA_FROM = '2024-01-01'
const MC_FROM = '2024-06-01'
const V = CARD_DISPUTE_CLAUSE_KEYS.visa
const M = CARD_DISPUTE_CLAUSE_KEYS.mastercard

const visaClauses = [
  { clause_id: 'cl-visa-11.2.2', clause_key: V.resolve, clause_ref: '11.2.2', text_content: 'Placeholder 11.2.2.', text_sha256: sha('1') },
  { clause_id: 'cl-visa-11.3.2', clause_key: V.permitted, clause_ref: '11.3.2', text_content: 'Placeholder 11.3.2.', text_sha256: sha('2') },
  { clause_id: 'cl-visa-11.8.4', clause_key: V.cardPresentKeyEntered, clause_ref: '11.8.4', text_content: 'Placeholder 11.8.4.', text_sha256: sha('3') },
  { clause_id: 'cl-visa-11.8.5', clause_key: V.cardAbsent, clause_ref: '11.8.5', text_content: 'Placeholder 11.8.5.', text_sha256: sha('4') },
]
const mcClauses = [
  { clause_id: 'cl-mc-4837-cb', clause_key: M.chargeback, clause_ref: '4837 Issuer Chargeback', text_content: 'Placeholder 4837 chargeback.', text_sha256: sha('5') },
  { clause_id: 'cl-mc-4837-in', clause_key: M.ineligible, clause_ref: '4837 Transactions ineligible', text_content: 'Placeholder 4837 ineligible.', text_sha256: sha('6') },
]

const approved = (key: StatementKey, clauseKeys: string[], hashes: Record<string, string>, status: FakeStatement['status'] = 'approved'): FakeStatement => ({
  statement_id: `st-${key}`,
  statement_key: key,
  revision: 1,
  framework: 'scheme',
  applies_to_instrument: ['sg_card'],
  text: `Placeholder statement ${key}.`,
  clause_keys: clauseKeys,
  status,
  clauses_as_of: status === 'approved' ? '2025-01-01' : null,
  approved_by: status === 'approved' ? 'synthetic-reviewer' : null,
  approved_at: status === 'approved' ? '2025-01-02T00:00:00Z' : null,
  checked_wording: clauseKeys.map((k) => ({ clause_key: k, text_sha256: hashes[k] })),
})

const hashes = Object.fromEntries([...visaClauses, ...mcClauses].map((c) => [c.clause_key, c.text_sha256]))

function corpus(opts: { draftStatements?: StatementKey[] } = {}): FakeCorpus {
  const status = (k: StatementKey) => (opts.draftStatements?.includes(k) ? 'draft' : 'approved')
  return {
    versions: [
      {
        version_id: 'ver-visa-syn',
        document_key: 'visa.core_rules',
        title: 'Synthetic Visa Rules',
        publisher: 'Synthetic scheme',
        binding_level: 'scheme_rule',
        institution: null,
        card_scheme: 'visa',
        document_instrument_scope: ['sg_card'],
        version_label: 'Synthetic edition 1',
        effective_from: VISA_FROM,
        effective_to: null,
        status: 'verified',
        source_url: 'https://example.com/visa-synthetic.pdf',
        coverage: 'selected_sections',
        clauses: visaClauses,
      },
      {
        version_id: 'ver-mc-syn',
        document_key: 'mastercard.chargeback_guide',
        title: 'Synthetic Mastercard Chargeback Guide',
        publisher: 'Synthetic scheme',
        binding_level: 'scheme_rule',
        institution: null,
        card_scheme: 'mastercard',
        document_instrument_scope: ['sg_card'],
        version_label: 'Synthetic edition 2',
        effective_from: MC_FROM,
        effective_to: null,
        status: 'verified',
        source_url: 'https://example.com/mc-synthetic.pdf',
        coverage: 'selected_sections',
        clauses: mcClauses,
      },
    ],
    statements: [
      approved('visa.3ds.authenticated', [V.cardAbsent], hashes, status('visa.3ds.authenticated')),
      approved('visa.3ds.attempted', [V.cardAbsent], hashes, status('visa.3ds.attempted')),
      approved('visa.token.authenticated', [V.cardAbsent], hashes, status('visa.token.authenticated')),
      approved('visa.no3ds', [V.cardAbsent], hashes, status('visa.no3ds')),
      approved('mc.authenticated', [M.ineligible], hashes, status('mc.authenticated')),
      approved('mc.pin', [M.ineligible], hashes, status('mc.pin')),
    ],
  }
}

async function run(data: CaseSectionData, c: FakeCorpus = corpus()): Promise<SectionResult> {
  const input: SectionInput = { ...data, provider: createFakeClauseProvider(c) }
  return buildCardDisputeComparison(input)
}

const comparisons = (r: SectionResult): ComparisonLine[] =>
  r.lines.flatMap((l) => (l.kind === 'comparison' ? [l.comparison] : []))
const texts = (r: SectionResult): string[] => r.lines.flatMap((l) => (l.kind === 'text' ? [l.text] : []))
const statementKeys = (r: SectionResult) => r.lines.flatMap((l) => (l.kind === 'statement' ? [l.statement.statementKey] : []))
const lineText = (l: SectionLine): string[] => {
  switch (l.kind) {
    case 'comparison':
      return [l.comparison.record, l.comparison.expected]
    case 'text':
      return [l.text]
    case 'statement':
      return [l.statement.text ?? '']
    case 'record':
      return Object.values(l.fields).map((v) => v ?? '')
  }
}

/** The card-only case with each card payment event changed. */
function withPayments(data: CaseSectionData, patch: Partial<CardAuthEvent>, extra: Partial<CaseSectionData['facts']> = {}): CaseSectionData {
  const events = data.facts.card_auth_events!.value!.map((e) => (e.transactionIndex === null ? e : { ...e, ...patch }))
  return { ...data, facts: { ...data.facts, card_auth_events: { value: events, label: 'confirmed' }, ...extra } }
}

function datedRequest(date: string): Partial<CaseSectionData['facts']> {
  return { card_dispute_requested: { value: { value: 'yes', date, reference: null, channel: 'email' }, label: 'confirmed' } }
}

test('visa keys are the ones the contract lists for card_dispute_comparison, and the statements it prints are contract keys', () => {
  for (const key of CLAUSE_KEYS.card_dispute_comparison) assert.ok(CARD_DISPUTE_RULE_CLAUSE_KEYS.includes(key), key)
  for (const key of ['visa.3ds.authenticated', 'visa.3ds.attempted', 'visa.token.authenticated', 'visa.no3ds', 'mc.authenticated', 'mc.pin']) {
    assert.ok(ALL_STATEMENT_KEYS.includes(key as StatementKey), key)
  }
})

test('calendar days count whole days across months', () => {
  assert.equal(calendarDaysBetween('2025-09-12', '2025-09-14'), 2)
  assert.equal(calendarDaysBetween('2025-01-31', '2025-03-01'), 29)
  assert.equal(calendarDaysBetween('2024-01-31', '2024-03-01'), 30)
})

test('account transfers only: the section prints nothing', async () => {
  for (const c of [accountSrfCase]) {
    const r = await run(c.data)
    assert.equal(r.sectionId, 'card_dispute_comparison')
    assert.deepEqual(r.lines, [])
    assert.deepEqual(r.citations, [])
    assert.deepEqual(r.flags, [])
  }
})

test('card-only case: 3-D Secure payments approved with a token are set beside the invalid-dispute list', async () => {
  const r = await run(cardOnlyCase.data)
  assert.deepEqual(r.flags, [])
  assert.equal(texts(r)[0], SCHEME_STANDING_SENTENCE)
  assert.match(texts(r)[1], /selected sections of Visa's rules \(Synthetic Visa Rules\), edition dated Synthetic edition 1/)

  const lines = comparisons(r)
  assert.equal(lines.length, 3 * 5, 'five comparisons per payment')
  for (let i = 0; i < 3; i++) {
    const [denial, env, invalid, time, reported] = lines.slice(i * 5, i * 5 + 5)
    assert.equal(denial.clauseKey, V.cardAbsent)
    assert.equal(denial.outcome, 'matches')
    assert.match(denial.record, /device labelled 'Phone model EX-300' is not hers/)
    assert.equal(env.outcome, 'matches')
    assert.equal(invalid.outcome, 'differs')
    assert.match(invalid.record, /3-D Secure approved with a digital token, result 'authenticated'/)
    assert.match(invalid.record, /does not show the electronic commerce indicator/)
    assert.deepEqual(invalid.evidenceIds, ['E6'])
    assert.equal(time.outcome, 'matches')
    assert.equal(reported.outcome, 'not_shown')
  }
  assert.deepEqual(statementKeys(r), ['visa.3ds.authenticated'], 'printed once for the three payments')
  const statement = r.lines.find((l) => l.kind === 'statement')
  assert.ok(statement && statement.kind === 'statement')
  assert.equal(statement.statement.text, 'Placeholder statement visa.3ds.authenticated.')
  assert.equal(statement.statement.onDate, '2025-09-12')

  assert.ok(texts(r).includes('The complainant asked the institution to dispute these payments on 2025-09-14.'))
  assert.ok(texts(r).includes("The institution's letter states that it did not raise a dispute because 'the payments were authenticated with the registered digital token'."))
  assert.equal(texts(r).some((t) => t.startsWith('On the records provided')), false, 'no summary: each payment is within a listed case')
  assert.deepEqual(new Set(r.citations.map((c) => c.clauseKey)), new Set([V.cardAbsent]))
})

test('card-absent payments with no authentication recorded: conditions shown, summary names the count and the declined request', async () => {
  const r = await run(withPayments(cardOnlyCase.data, { authentication: 'none_recorded', authenticationResult: 'not_known' }))
  assert.equal(comparisons(r).filter((l) => l.outcome === 'differs').length, 0)
  assert.deepEqual(statementKeys(r), ['visa.no3ds'])
  const summary = texts(r).find((t) => t.startsWith('On the records provided'))
  assert.ok(summary)
  assert.match(summary, /shown for 3 payment\(s\)\. The complainant asked the institution to dispute them on 2025-09-14\. The institution did not raise a dispute\./)
  assert.match(summary, /allow, and do not require, an issuer to raise a dispute/)
  const line = r.lines.find((l) => l.kind === 'text' && l.text === summary)
  assert.ok(line && line.kind === 'text')
  assert.deepEqual(line.clauseKeys, [V.permitted, V.resolve])
  assert.deepEqual(new Set(r.citations.map((c) => c.clauseKey)), new Set([V.cardAbsent, V.resolve, V.permitted]))
})

test('attempted authentication and authenticated token payments print their own statements', async () => {
  const attempted = await run(withPayments(cardOnlyCase.data, { authentication: 'three_ds_otp', authenticationResult: 'attempted' }))
  assert.deepEqual(statementKeys(attempted), ['visa.3ds.attempted'])
  const token = await run(withPayments(cardOnlyCase.data, { authentication: 'wallet_device', authenticationResult: 'authenticated' }))
  assert.deepEqual(statementKeys(token), ['visa.token.authenticated'])
  const failed = await run(withPayments(cardOnlyCase.data, { authentication: 'three_ds_otp', authenticationResult: 'failed' }))
  assert.deepEqual(statementKeys(failed), ['visa.no3ds'])
  const unknown = await run(withPayments(cardOnlyCase.data, { authentication: 'not_known', authenticationResult: 'not_known' }))
  assert.deepEqual(statementKeys(unknown), [])
  assert.equal(comparisons(unknown).filter((l) => l.outcome === 'not_shown').length, 3 * 2)
})

test('time limit: 120 calendar days from the payment date matches, 121 differs, no request date is not shown', async () => {
  const base = withPayments(cardOnlyCase.data, { authentication: 'none_recorded', authenticationResult: 'not_known' })
  // payments are dated 2025-09-12, 2025-09-12 and 2025-09-13
  const at120 = await run({ ...base, facts: { ...base.facts, ...datedRequest('2026-01-11') } })
  const times120 = comparisons(at120).filter((l) => /calendar days later/.test(l.record))
  assert.deepEqual(times120.map((l) => l.outcome), ['differs', 'differs', 'matches'])
  assert.match(times120[2].record, /120 calendar days later/)
  assert.match(times120[0].record, /121 calendar days later/)
  assert.match(texts(at120).find((t) => t.startsWith('On the records provided')) ?? '', /shown for 1 payment\(s\)/)

  const noRequest = await run({
    ...base,
    facts: {
      ...base.facts,
      card_dispute_requested: { value: { value: 'no', date: null, reference: null, channel: null }, label: 'confirmed' },
      reported_to_bank: { value: { value: 'unsure', date: null, reference: null, channel: null }, label: 'not_sure' },
    },
  })
  assert.equal(comparisons(noRequest).filter((l) => /do not show when the complainant reported/.test(l.record)).every((l) => l.outcome === 'not_shown'), true)
  assert.ok(texts(noRequest).includes('The records do not show that the complainant asked the institution to dispute these payments.'))
  assert.equal(texts(noRequest).some((t) => t.startsWith('On the records provided')), false)
})

test('the report date stands in for the request date when no dispute request is recorded', async () => {
  const base = withPayments(cardOnlyCase.data, { authentication: 'none_recorded', authenticationResult: 'not_known' })
  const facts = { ...base.facts }
  delete facts.card_dispute_requested
  const r = await run({ ...base, facts })
  const time = comparisons(r).find((l) => /calendar days later/.test(l.record))
  assert.ok(time)
  assert.match(time.record, /reported it to the institution on 2025-09-13/)
})

test('payments before the scheme version held: "not held" and a clause_not_held flag, no comparison', async () => {
  const early = { ...cardOnlyCase.data, payments: cardOnlyCase.data.payments.map((p) => ({ ...p, date: '2023-12-31' })) }
  const r = await run(early)
  assert.deepEqual(comparisons(r), [])
  assert.ok(texts(r).includes("This pack does not hold Visa's rules in force on 2023-12-31."))
  assert.equal(texts(r).filter((t) => t.startsWith('This pack does not hold')).length, 1)
  assert.deepEqual(r.flags, [{ code: 'clause_not_held', key: V.cardAbsent, onDate: '2023-12-31' }])
  assert.equal(texts(r).includes(SCHEME_STANDING_SENTENCE), false)
  assert.deepEqual(r.citations, [])
})

test('a statement with no approved revision prints without text and flags the run', async () => {
  const r = await run(cardOnlyCase.data, corpus({ draftStatements: ['visa.3ds.authenticated'] }))
  const statement = r.lines.find((l) => l.kind === 'statement')
  assert.ok(statement && statement.kind === 'statement')
  assert.equal(statement.statement.text, null)
  assert.equal(statement.statement.statementId, null)
  assert.deepEqual(r.flags, [{ code: 'statement_under_review', key: 'visa.3ds.authenticated', onDate: '2025-09-12' }])
})

test('card-present payments read by chip or contactless are outside conditions 10.3 and 10.4', async () => {
  const r = await run(withPayments(cardOnlyCase.data, { entryMode: 'contactless', authentication: 'pin', authenticationResult: 'authenticated' }))
  const lines = comparisons(r)
  assert.equal(lines.length, 3)
  for (const l of lines) {
    assert.equal(l.outcome, 'not_applicable')
    assert.equal(l.clauseKey, V.cardPresentKeyEntered)
  }
})

test('key-entered card-present payments are compared under condition 10.3, with no invalid-list line', async () => {
  const r = await run(withPayments(cardOnlyCase.data, { entryMode: 'key_entered', authentication: 'none_recorded', authenticationResult: 'not_known' }))
  const lines = comparisons(r)
  assert.equal(lines.length, 3 * 4)
  assert.equal(lines.every((l) => l.clauseKey === V.cardPresentKeyEntered), true)
  assert.deepEqual(statementKeys(r), [])
})

test('a wallet-token payment without an entry environment is not shown', async () => {
  const r = await run(withPayments(cardOnlyCase.data, { entryMode: 'wallet_token' }))
  assert.equal(comparisons(r).length, 3)
  assert.equal(comparisons(r).every((l) => l.outcome === 'not_shown'), true)
})

test('mixed case (Mastercard debit card): ineligible payments print the guide statements; the summary counts the rest', async () => {
  const r = await run(mixedCase.data)
  assert.deepEqual(r.flags, [])
  assert.match(texts(r)[1], /selected sections of Mastercard's rules \(Synthetic Mastercard Chargeback Guide\)/)
  const lines = comparisons(r)
  assert.equal(lines.every((l) => l.clauseKey === M.chargeback || l.clauseKey === M.ineligible), true)
  const ineligible = lines.filter((l) => l.clauseKey === M.ineligible)
  assert.equal(ineligible.length, 3)
  assert.deepEqual(statementKeys(r), ['mc.authenticated', 'mc.pin'])
  assert.deepEqual(ineligible.map((l) => l.outcome), ['differs', 'matches', 'differs'])
  const summary = texts(r).find((t) => t.startsWith('On the records provided'))
  assert.ok(summary)
  assert.match(summary, /Mastercard's rules set for a fraud dispute are shown for 1 payment\(s\)/)
  assert.match(summary, /The institution did not answer\./)
  assert.doesNotMatch(summary, /allow, and do not require/, 'that sentence rests on Visa sections only')
  assert.ok(texts(r).includes("The institution's letters do not say whether it raised a dispute."))
})

test('Visa payments are compared before Mastercard payments', async () => {
  const data = cardOnlyCase.data
  const events = data.facts.card_auth_events!.value!.map((e) => (e.transactionIndex === 0 ? { ...e, cardScheme: 'mastercard' as const } : e))
  const r = await run({ ...data, facts: { ...data.facts, card_auth_events: { value: events, label: 'confirmed' } } })
  const keys = comparisons(r).map((l) => l.clauseKey)
  const firstMc = keys.findIndex((k) => k.startsWith('mastercard.'))
  const lastVisa = keys.map((k) => k.startsWith('visa.')).lastIndexOf(true)
  assert.ok(firstMc > lastVisa)
  assert.ok(statementKeys(r).includes('mc.authenticated'))
})

test('no card authentication record: the scheme is not shown and no rules are set beside the payments', async () => {
  const facts = { ...cardOnlyCase.data.facts }
  delete facts.card_auth_events
  const r = await run({ ...cardOnlyCase.data, facts })
  assert.deepEqual(comparisons(r), [])
  assert.ok(texts(r).includes("The records provided do not show the card scheme for 3 card payment(s), so no scheme's rules are set beside them."))
  assert.deepEqual(r.citations, [])
})

test('e-wallet payments only (no technical records case): the section prints nothing', async () => {
  assert.deepEqual((await run(noTechnicalRecordsCase.data)).lines, [])
})

test('no verdict wording in any line the section writes', async () => {
  const forbidden = /\b(breach\w*|violat\w*|fail(ed|s)? to|did not comply|non-?complian\w*|liab(le|ility)|negligen\w*|reckless\w*|cannot|should have|must have|at fault|bears? the)\b/i
  const variants = [
    cardOnlyCase.data,
    mixedCase.data,
    withPayments(cardOnlyCase.data, { authentication: 'none_recorded', authenticationResult: 'not_known' }),
    withPayments(cardOnlyCase.data, { entryMode: 'contactless', authentication: 'pin' }),
    { ...cardOnlyCase.data, payments: cardOnlyCase.data.payments.map((p) => ({ ...p, date: '2023-01-01' })) },
  ]
  for (const data of variants) {
    const r = await run(data)
    for (const line of r.lines) {
      for (const t of lineText(line)) {
        // The institution's own reason is quoted from its letter, with an evidence ID; it is not ours.
        const ours = t.replace(/'[^']*'/g, "''")
        assert.doesNotMatch(ours, forbidden, t)
      }
    }
  }
})

// Lane 5's seeds and manifests (keys, hashes and section references only; no document text in the repo).
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const MANIFESTS = 'supabase/standards/manifests'
const manifests = readdirSync(MANIFESTS).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, ...readJson(`${MANIFESTS}/${f}`) }))
const schemeStatements = ['visa', 'mc'].flatMap((f) => readJson(`supabase/standards/seeds/statements/${f}.json`).statements as Array<Record<string, unknown>>)

test('every clause card-dispute-checks cites and every scheme statement rests on is a section in a scheme manifest', () => {
  const held = new Set(manifests.flatMap((m) => (m.sections ?? []).map((s: { clause_key: string }) => s.clause_key)))
  for (const key of CARD_DISPUTE_RULE_CLAUSE_KEYS) assert.ok(held.has(key), key)
  for (const st of schemeStatements) for (const key of st.clause_keys as string[]) assert.ok(held.has(key), `${st.statement_key}: ${key}`)
})

test('scheme statements: one draft per contract key, scheme framework, cards only, decision 19 wording', () => {
  const keys = schemeStatements.map((s) => s.statement_key)
  assert.deepEqual([...keys].sort(), ALL_STATEMENT_KEYS.filter((k) => k.startsWith('visa.') || k.startsWith('mc.')).sort())
  for (const st of schemeStatements) {
    assert.equal(st.status, 'draft', `${st.statement_key} is not approved by an agent`)
    assert.equal(st.approved_by, null)
    assert.equal(st.framework, 'scheme')
    assert.deepEqual(st.applies_to_instrument, ['sg_card'])
    assert.doesNotMatch(st.text as string, /\bcannot\b|\bbears?\b|\bliable\b|\bbreach/i, st.statement_key as string)
  }
})

test('manifests: documents and versions are drafts with a key, a source and either a hash or a recorded block', () => {
  for (const m of manifests) {
    assert.equal(`${m.document.document_key}.json`, m.file)
    assert.match(m.document.document_key, /^[a-z0-9]+(\.[a-z0-9_-]+)+$/)
    assert.equal(m.document.binding_level === 'contract', m.document.institution !== null, m.file)
    assert.equal(m.document.binding_level === 'scheme_rule', m.document.card_scheme !== null, m.file)
    for (const v of m.versions) {
      assert.equal(v.status, 'draft', `${m.file} ${v.version_label}`)
      assert.match(v.source_url, /^https:\/\//)
      if (v.obtained) assert.match(v.content_sha256, /^[0-9a-f]{64}$/, `${m.file} ${v.version_label}`)
      else assert.ok(v.blocked?.reason, `${m.file} ${v.version_label}: a version not obtained records why`)
    }
    for (const s of m.sections ?? []) {
      assert.match(s.clause_key, /^[a-z0-9]+(\.[a-z0-9_-]+)+\/[a-z0-9._()~-]+$/)
      assert.ok(s.clause_key.startsWith(`${m.document.document_key}/`), s.clause_key)
      assert.equal(Object.keys(s).some((k) => /text_content|text$/.test(k)), false, 'no section text in the repo')
    }
  }
})

test('term requests: one unconfirmed row per institution, product and purpose, against a manifest document', () => {
  const documents = new Map(manifests.map((m) => [m.document.document_key, m.document]))
  for (const f of readdirSync('supabase/standards/seeds/term-requests')) {
    const { rows } = readJson(`supabase/standards/seeds/term-requests/${f}`)
    const seen = new Set<string>()
    for (const r of rows) {
      const id = `${r.institution}|${r.product}|${r.purpose}`
      assert.equal(seen.has(id), false, id)
      seen.add(id)
      assert.equal(documents.get(r.document_key)?.institution, r.institution, id)
      assert.ok(Array.isArray(r.selector.tags) && r.selector.tags.length > 0, id)
      assert.equal(r.confirmed_by, null)
      assert.equal(r.term_outcome, null)
      assert.equal(r.quote_mode, 'quote')
    }
  }
})
