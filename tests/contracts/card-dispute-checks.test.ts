import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildCardDisputeComparison,
  calendarDaysBetween,
  CARD_DISPUTE_CLAUSE_KEYS,
  CARD_DISPUTE_RULE_CLAUSE_KEYS,
} from '../../supabase/functions/_shared/facts/rules/card-dispute-checks.ts'
import {
  ALL_STATEMENT_KEYS,
  CLAUSE_TAGS,
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
  TERM_REQUEST_PURPOSES,
  WALLET_PROVISIONING_PURPOSE,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { readManifest } from '../../scripts/standards/manifest.ts'
import { GENDERED_PRONOUNS, SCHEME_STANDING_SENTENCE } from '../../supabase/functions/_shared/facts/update/section-writer.ts'
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
    assert.match(denial.record, /device labelled 'Phone model EX-300' is not theirs/)
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

  assert.ok(texts(r).includes('The complainant asked the institution to dispute these payments on 14 September 2025.'))
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
  assert.match(summary, /shown for 3 payment\(s\)\. The complainant asked the institution to dispute them on 14 September 2025\. The institution did not raise a dispute\./)
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
  assert.match(time.record, /reported it to the institution on 13 September 2025/)
})

test('payments before the scheme version held: "not held" and a clause_not_held flag, no comparison', async () => {
  const early = { ...cardOnlyCase.data, payments: cardOnlyCase.data.payments.map((p) => ({ ...p, date: '2023-12-31' })) }
  const r = await run(early)
  assert.deepEqual(comparisons(r), [])
  assert.ok(texts(r).includes("This pack does not hold Visa's rules in force on 31 December 2023."))
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
        // Decision 2: the complainant is "they", "their", "theirs".
        assert.doesNotMatch(ours, GENDERED_PRONOUNS, t)
      }
    }
  }
})


// Lane 5's seeds and manifests (keys, hashes and section references only; no document text in the repo). Manifests are
// in Lane 1's loader format: one file per version (scripts/standards/manifest.ts).
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const MANIFESTS = 'supabase/standards/manifests'
const LANE5_LEVELS = new Set(['scheme_rule', 'contract', 'published_page'])
const manifests = readdirSync(MANIFESTS)
  .filter((f) => f.endsWith('.json'))
  .map((file) => ({ file, m: readManifest(`${MANIFESTS}/${file}`) }))
  .filter(({ m }) => LANE5_LEVELS.has(m.document.binding_level))
const versionsOf = (documentKey: string) => manifests.filter(({ m }) => m.document.document_key === documentKey)
const schemeStatements = ['visa', 'mc'].flatMap((f) => readJson(`supabase/standards/seeds/statements/schemes/${f}.json`).statements as Array<Record<string, unknown>>)
const TERM_REQUEST_DIR = 'supabase/standards/seeds/term-requests'
const termRows: Array<Record<string, any>> = readdirSync(TERM_REQUEST_DIR).filter((f) => f.endsWith('.json')).flatMap((f) => {
  const rows = readJson(`${TERM_REQUEST_DIR}/${f}`)
  assert.ok(Array.isArray(rows), `${f} is a bare array of rows (Lane 4's parser)`)
  return (rows as Array<Record<string, any>>).map((r) => ({ ...r, file: f }))
})
// Documents whose publisher refuses automated download (blocked-sources.md, kept with the private sources): their
// request rows wait for a person's browser download and the manifest that follows it.
const BLOCKED_DOCUMENTS = new Set(['ocbc.cardmembers_agreement', 'ocbc.deposit_accounts', 'ocbc.electronic_banking'])

test('every clause card-dispute-checks cites and every scheme statement rests on is held in every edition of its document', () => {
  const keys = [...CARD_DISPUTE_RULE_CLAUSE_KEYS, ...schemeStatements.flatMap((st) => st.clause_keys as string[])]
  for (const key of keys) {
    const editions = versionsOf(key.split('/')[0])
    assert.ok(editions.length > 0, `${key}: no edition held`)
    for (const { file, m } of editions) assert.ok(m.clauses.some((c) => c.clause_key === key), `${key} is not in ${file}`)
  }
})

test('scheme statements: one draft per contract key, scheme framework, cards only, decision 19 wording, per edition', () => {
  const keys = schemeStatements.map((s) => s.statement_key)
  assert.deepEqual([...keys].sort(), ALL_STATEMENT_KEYS.filter((k) => k.startsWith('visa.') || k.startsWith('mc.')).sort())
  for (const st of schemeStatements) {
    assert.equal(st.status, 'draft', `${st.statement_key} is not approved by an agent`)
    assert.equal(st.approved_by, null)
    assert.equal(st.framework, 'scheme')
    assert.deepEqual(st.applies_to_instrument, ['sg_card'])
    assert.deepEqual(st.exclusion_clause_keys, [])
    assert.doesNotMatch(st.text as string, /\bcannot\b|\bbears?\b|\bliable\b|\bbreach/i, st.statement_key as string)
    // Rule 3.2.8: a draft is for the edition it was written against; no other edition counts as reviewed.
    const edition = st.drafted_for_edition as string
    const document = (st.clause_keys as string[])[0].split('/')[0]
    const labels = versionsOf(document).map(({ m }) => m.version.version_label)
    assert.ok(labels.includes(edition), `${st.statement_key}: ${edition} is not held`)
    assert.deepEqual(st.reviewed_for_editions, [], `${st.statement_key}: reviewed only by Elena`)
    assert.deepEqual([...(st.not_reviewed_for_editions as string[])].sort(), labels.filter((l) => l !== edition).sort(), st.statement_key as string)
  }
})

test("Lane 5 manifests: Lane 1's format, sources recorded, archive captures dated, no clause text", () => {
  assert.ok(manifests.length > 0)
  for (const { file, m } of manifests) {
    const d = m.document
    const v = m.version
    assert.equal(file, `${d.document_key}.${v.effective_from ?? 'undated'}.json`)
    assert.equal(d.binding_level === 'scheme_rule', d.card_scheme !== null, file)
    assert.equal(d.binding_level !== 'scheme_rule', d.institution !== null, `${file}: a contract or published page names its institution`)
    if (d.institution) assert.ok(d.document_key.startsWith(`${d.institution}.`), file)
    if (d.binding_level === 'scheme_rule') assert.equal(v.coverage, 'selected_sections', file)
    else assert.equal(v.coverage, 'full', file)
    assert.match(v.source_url ?? '', /^https:\/\//, file)
    if (v.provenance === 'web_archive') {
      const ts = /^https:\/\/web\.archive\.org\/web\/(\d{14})\/https:\/\//.exec(v.source_url ?? '')
      assert.ok(ts, `${file}: an archive copy names its capture`)
      const iso = `${ts[1].slice(0, 4)}-${ts[1].slice(4, 6)}-${ts[1].slice(6, 8)}`
      assert.equal(v.retrieved_at.slice(0, 10), iso, `${file}: retrieved_at is the capture time`)
      assert.equal(v.archived_at, iso, `${file}: archived_at is the capture date`)
    } else {
      assert.equal(v.provenance, 'publisher_site', file)
      assert.doesNotMatch(v.source_url ?? '', /web\.archive\.org/, file)
      assert.equal(v.archived_at ?? null, null, file)
    }
    for (const c of m.clauses) {
      assert.ok(c.clause_key.startsWith(`${d.document_key}/`), c.clause_key)
      assert.notEqual(c.text_sha256, '0'.repeat(64), `${c.clause_key}: hash recorded`)
      assert.ok(c.pages.length > 0, c.clause_key)
      assert.equal(Object.keys(c).some((k) => /text_content|^text$/.test(k)), false, 'no clause text in the repo')
    }
  }
})

test('every scheme edition holds the same selected sections', () => {
  const schemes = new Set(manifests.filter(({ m }) => m.document.binding_level === 'scheme_rule').map(({ m }) => m.document.document_key))
  for (const key of schemes) {
    const sets = versionsOf(key).map(({ file, m }) => ({ file, keys: m.clauses.map((c) => c.clause_key).sort() }))
    for (const s of sets) assert.deepEqual(s.keys, sets[0].keys, `${s.file} holds other sections than ${sets[0].file}`)
  }
})

test('term requests: every purpose is one the contract names (TERM_REQUEST_PURPOSES)', () => {
  assert.ok(termRows.length > 0)
  for (const r of termRows) assert.ok((TERM_REQUEST_PURPOSES as readonly string[]).includes(r.purpose), `${r.file}: purpose ${r.purpose}`)
})

test('term requests: one unconfirmed row per institution, product and purpose, against a document held or recorded as blocked', () => {
  const seen = new Set<string>()
  for (const r of termRows) {
    const id = `${r.institution}|${r.product}|${r.purpose}`
    assert.equal(seen.has(id), false, id)
    seen.add(id)
    assert.ok(r.document_key.startsWith(`${r.institution}.`), id)
    const held = versionsOf(r.document_key)
    assert.ok(held.length > 0 || BLOCKED_DOCUMENTS.has(r.document_key), `${id}: ${r.document_key} is neither held nor recorded as blocked`)
    for (const { m } of held) assert.equal(m.document.institution, r.institution, id)
    if (Array.isArray(r.selector.clause_keys)) {
      assert.ok(r.selector.clause_keys.length > 0, id)
      for (const key of r.selector.clause_keys) {
        assert.ok(held.length > 0 && held.every(({ m }) => m.clauses.some((c) => c.clause_key === key)), `${id}: ${key} is not in every version held`)
      }
    } else {
      assert.ok(Array.isArray(r.selector.tags) && r.selector.tags.length > 0, id)
      for (const t of r.selector.tags) assert.ok((CLAUSE_TAGS as readonly string[]).includes(t), `${id}: tag ${t}`)
    }
    assert.equal(r.confirmed_by, null)
    assert.equal(r.confirmed_at, null)
    assert.equal(r.term_outcome, null)
    assert.equal(r.quote_mode, 'quote')
  }
})

test('wallet_provisioning: one row per bank and card product on its own published page, with the recorded values left for a person', () => {
  for (const bank of ['dbs', 'ocbc', 'uob']) {
    const rows = termRows.filter((r) => r.institution === bank && r.purpose === WALLET_PROVISIONING_PURPOSE)
    assert.deepEqual(rows.map((r) => r.product).sort(), ['credit_card', 'debit_card'], bank)
    for (const r of rows) {
      assert.equal(r.document_key, `${bank}.wallet_provisioning`)
      assert.ok(versionsOf(r.document_key).length > 0, `${bank}: no wallet page held`)
      assert.ok(versionsOf(r.document_key).every(({ m }) => m.document.binding_level === 'published_page'))
      for (const field of ['wallet_waiting_period_stated', 'wallet_waiting_period_hours', 'wallet_authentication_required', 'wallet_applies_from']) {
        assert.equal(r[field], null, `${bank} ${r.product}: ${field} is recorded by a person`)
      }
    }
  }
})
