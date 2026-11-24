import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  buildMasNoticeChecks,
  createMasNoticeChecks,
  MAS_NOTICE_ROUTES,
  noticeClassOf,
  CARD_OPENING_STATEMENT_KEY,
} from '../../supabase/functions/_shared/facts/rules/mas-notice-checks.ts'
import {
  ALL_STATEMENT_KEYS,
  CLAUSE_KEYS,
  type ComparisonLine,
  createFakeClauseProvider,
  type FakeCorpus,
  type SectionResult,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import {
  accountSrfCase,
  cardOnlyCase,
  type CaseSectionData,
  FIDREC_UPDATE_CASES,
  mixedCase,
  noTechnicalRecordsCase,
  syntheticCorpus,
} from '../fixtures/fidrec-update/index.ts'

// FIDReC standards brief v5, 4b (MAS notice comparison): routing by institution type, the opening statement by payment
// type, and the customer-information comparison. Synthetic data only.

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const FSM_N07_9 = CLAUSE_KEYS.mas_notice_comparison[0]
/** FSM-N05's customer-information paragraph, `mas.fsm-n05/9` (Lane 1; review of 24 Nov 2026, Lane 3 issue 1). */
const TEST_N05_KEY = CLAUSE_KEYS.mas_notice_comparison[1]

function testCorpus(): FakeCorpus {
  const corpus: FakeCorpus = structuredClone(syntheticCorpus)
  for (const [documentKey, clauseKey] of [['mas.fsm-n07', FSM_N07_9], ['mas.fsm-n05', TEST_N05_KEY]]) {
    corpus.versions.push({
      version_id: `t-${documentKey}`,
      document_key: documentKey,
      title: `Synthetic ${documentKey}`,
      publisher: 'Synthetic regulator',
      binding_level: 'notice',
      institution: null,
      card_scheme: null,
      document_instrument_scope: ['account_transfer', 'sg_card', 'ewallet'],
      version_label: '2024',
      effective_from: '2024-05-10',
      effective_to: null,
      status: 'verified',
      source_url: `https://example.com/${documentKey}.pdf`,
      coverage: 'full',
      clauses: [{ clause_id: `t-${clauseKey}`, clause_key: clauseKey, clause_ref: clauseKey.split('/')[1], text_content: `Placeholder text of ${clauseKey}.`, text_sha256: sha(clauseKey) }],
    })
  }
  for (const statementKey of ['bridge.mas_requirement', CARD_OPENING_STATEMENT_KEY]) {
    corpus.statements.push({
      statement_id: `t-${statementKey}`,
      statement_key: statementKey,
      revision: 1,
      framework: 'eupg',
      applies_to_instrument: statementKey === 'bridge.mas_requirement' ? ['account_transfer', 'ewallet'] : ['sg_card'],
      text: `Placeholder statement ${statementKey}.`,
      clause_keys: ['mas.eupg/5.2'],
      status: 'approved',
      clauses_as_of: '2025-01-01',
      approved_by: 'synthetic-reviewer',
      approved_at: '2025-01-02T00:00:00Z',
      checked_wording: [{ clause_key: 'mas.eupg/5.2', text_sha256: 'b'.repeat(64) }],
    })
  }
  return corpus
}

const provider = createFakeClauseProvider(testCorpus())
const withBankKey = createMasNoticeChecks({ routes: { ...MAS_NOTICE_ROUTES, bank: { ...MAS_NOTICE_ROUTES.bank, customerInformationClause: TEST_N05_KEY } } })
const asCardLicensee = createMasNoticeChecks({ classify: () => 'card_licensee' })
const run = (data: CaseSectionData, builder = buildMasNoticeChecks) => builder({ ...data, provider })
const clone = (data: CaseSectionData): CaseSectionData => structuredClone(data)
const comparisons = (r: SectionResult): ComparisonLine[] => r.lines.flatMap((l) => (l.kind === 'comparison' ? [l.comparison] : []))
const statementKeys = (r: SectionResult) => r.lines.flatMap((l) => (l.kind === 'statement' ? [l.statement.statementKey] : []))

// ---------------------------------------------------------------------------------------------------------------
// Routing by institution type
// ---------------------------------------------------------------------------------------------------------------

test('routing by institution type: bank, payment service provider (e-wallet or not), and nothing for others', () => {
  assert.equal(noticeClassOf(accountSrfCase.data.institution, accountSrfCase.data.payments), 'bank')
  assert.equal(noticeClassOf(noTechnicalRecordsCase.data.institution, noTechnicalRecordsCase.data.payments), 'ewallet_mpi')
  assert.equal(noticeClassOf({ name: 'Example Pay', type: 'payment_service_provider', code: null }, accountSrfCase.data.payments), 'payment_system_licensee')
  assert.equal(noticeClassOf({ name: 'Example Telco', type: 'telco', code: null }, accountSrfCase.data.payments), null)
  assert.equal(noticeClassOf(null, accountSrfCase.data.payments, 'bank'), 'bank', 'falls back to the institution_names fact')
  assert.deepEqual(MAS_NOTICE_ROUTES.bank.documents, ['mas.fsm-n05', 'mas.fsm-n06'])
  assert.deepEqual(MAS_NOTICE_ROUTES.card_licensee.documents, ['mas.fsm-n07', 'mas.fsm-n08'])
  assert.equal(MAS_NOTICE_ROUTES.card_licensee.customerInformationClause, 'mas.fsm-n07/9')
  assert.deepEqual(MAS_NOTICE_ROUTES.payment_system_licensee.documents, ['mas.fsm-n13', 'mas.fsm-n14'])
})

test('no route compares against FSM-N06 4.6 (its wording is about the bank\'s own accounts)', async () => {
  for (const route of Object.values(MAS_NOTICE_ROUTES)) assert.notEqual(route.customerInformationClause, 'mas.fsm-n06/4.6')
  for (const c of FIDREC_UPDATE_CASES) {
    for (const builder of [buildMasNoticeChecks, withBankKey, asCardLicensee]) {
      for (const line of comparisons(await run(c.data, builder))) assert.doesNotMatch(line.clauseKey, /^mas\.fsm-n06\//)
    }
  }
})

// Changed with the review of 24 Nov 2026 (issue 1): the bank route is now keyed, so the unkeyed route tested is the
// payment-system licensee's.
test('the bank route compares against FSM-N05 paragraph 9; a route whose clause is not located yet prints the opening only', async () => {
  assert.equal(MAS_NOTICE_ROUTES.bank.customerInformationClause, 'mas.fsm-n05/9')
  const bank = await run(accountSrfCase.data)
  assert.ok(comparisons(bank).length > 0)
  assert.ok(comparisons(bank).every((c) => c.clauseKey === 'mas.fsm-n05/9' && c.expected === 'Placeholder text of mas.fsm-n05/9.'))

  const d = clone(accountSrfCase.data)
  d.institution = { name: 'Example Pay', type: 'payment_service_provider', code: null }
  const r = await run(d)
  assert.deepEqual(statementKeys(r), ['bridge.mas_requirement'])
  assert.equal(comparisons(r).length, 0)
  assert.deepEqual(r.flags, [{ code: 'clause_not_held', key: 'mas.fsm-n13', onDate: '2025-07-03' }])
})

// ---------------------------------------------------------------------------------------------------------------
// Opening by payment type
// ---------------------------------------------------------------------------------------------------------------

test('the group opens with bridge.mas_requirement for account payments and the card statement for card payments', async () => {
  const account = await run(accountSrfCase.data, withBankKey)
  assert.equal(statementKeys(account)[0], 'bridge.mas_requirement')
  assert.ok(!statementKeys(account).includes(CARD_OPENING_STATEMENT_KEY))
  const opening = account.lines[0]
  assert.equal(opening.kind === 'statement' && opening.statement.text, 'Placeholder statement bridge.mas_requirement.')

  const card = await run(cardOnlyCase.data, withBankKey)
  assert.deepEqual(statementKeys(card), [CARD_OPENING_STATEMENT_KEY], 'no bridge statement for card payments, even after a differs line')
  assert.ok(comparisons(card).some((c) => c.outcome === 'differs'))

  const mixed = await run(mixedCase.data, withBankKey)
  assert.deepEqual(statementKeys(mixed), ['bridge.mas_requirement', CARD_OPENING_STATEMENT_KEY])
})

// Changed with PR #56 (Decision 9): the card opening key is agreed and in the contract.
test('the card opening key is bridge.mas_requirement.cards, a contract key', () => {
  assert.equal(CARD_OPENING_STATEMENT_KEY, 'bridge.mas_requirement.cards')
  assert.ok((ALL_STATEMENT_KEYS as readonly string[]).includes(CARD_OPENING_STATEMENT_KEY))
})

test('an opening statement with no approved revision prints as under review and flags the run', async () => {
  const r = await buildMasNoticeChecks({ ...cardOnlyCase.data, provider: createFakeClauseProvider(syntheticCorpus) })
  const [line] = r.lines
  assert.ok(line.kind === 'statement' && line.statement.text === null)
  assert.ok(r.flags.some((f) => f.code === 'statement_under_review' && f.key === CARD_OPENING_STATEMENT_KEY))
})

// ---------------------------------------------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------------------------------------------

test('access by a device the complainant states is not theirs, with how it was authenticated', async () => {
  const r = await run(accountSrfCase.data, withBankKey)
  const lines = comparisons(r)
  assert.ok(lines.every((c) => c.clauseKey === TEST_N05_KEY && c.outcome === 'differs'))
  assert.equal(lines[0].record, "The institution's record shows a login at 21:10 on 3 July 2025 from a device labelled 'Phone model EX-200'. The complainant states that this device is not theirs. The record shows the login was authorised by digital token.")
  assert.equal(lines[0].expected, `Placeholder text of ${TEST_N05_KEY}.`)
  assert.deepEqual(lines[0].evidenceIds, ['E4'])
  // The tablet the complainant is not sure about is not listed.
  assert.ok(!lines.some((c) => /EX-T1/.test(c.record)))
  assert.ok(r.citations.some((c) => c.clauseKey === TEST_N05_KEY && c.versionId === 't-mas.fsm-n05'))
})

// PR #56 (00b8944): the device rule has three states. Only `not_mine` compares; `not_sure` or no answer is
// `not_shown` and prints the "The records do not show …" line, never `differs`.
test('a device the complainant is not sure about, or has not answered about, gets the "do not show" line, never differs', async () => {
  const r = await run(accountSrfCase.data, withBankKey)
  assert.ok(!comparisons(r).some((c) => /EX-T1/.test(c.record)))
  const texts = r.lines.flatMap((l) => (l.kind === 'text' ? [l.text] : []))
  assert.ok(texts.includes("The records do not show whether the device labelled 'Tablet model EX-T1', used for a login at 07:05 on 4 July 2025 from a device labelled 'Tablet model EX-T1', is the complainant's."))

  const unanswered = clone(accountSrfCase.data)
  unanswered.facts.device_recognition = { label: 'confirmed', value: unanswered.facts.device_recognition!.value!.filter((x) => x.deviceRef !== 'dev-ex-0003') }
  const u = await run(unanswered, withBankKey)
  assert.ok(!comparisons(u).some((c) => /EX-PC/.test(c.record)))
  assert.ok(u.lines.some((l) => l.kind === 'text' && /^The records do not show whether the device labelled 'Browser on desktop EX-PC'/.test(l.text)))

  // A device_recognition fact labelled not_sure: every device is not_shown, so nothing compares as differs.
  const unsure = clone(accountSrfCase.data)
  unsure.facts.device_recognition = { ...unsure.facts.device_recognition!, label: 'not_sure' }
  assert.equal(comparisons(await run(unsure, withBankKey)).filter((c) => c.outcome === 'differs').length, 0)
})

test('changes made in the session from such a device, and the alert the record shows', async () => {
  const lines = comparisons(await run(accountSrfCase.data, withBankKey))
  const change = lines.find((c) => /payee added/.test(c.record))
  assert.ok(change)
  assert.match(change.record, /a payee added at 21:20 on 3 July 2025 .*not theirs\. The record shows no alert between this change and the next recorded event\./)
  const mixed = comparisons(await run(mixedCase.data, withBankKey))
  assert.ok(mixed.some((c) => /transaction limit changed at 10:05 on 20 May 2025/.test(c.record)))
})

test('a non-bank card licensee is compared against FSM-N07 paragraph 9', async () => {
  const r = await run(cardOnlyCase.data, asCardLicensee)
  const lines = comparisons(r)
  assert.ok(lines.length > 0)
  assert.ok(lines.every((c) => c.clauseKey === 'mas.fsm-n07/9'))
  assert.equal(lines[0].expected, 'Placeholder text of mas.fsm-n07/9.')
})

test('no login from such a device is not_applicable; no access record is not_shown', async () => {
  const d = clone(accountSrfCase.data)
  d.facts.device_recognition = { label: 'confirmed', value: d.facts.device_recognition!.value!.map((x) => ({ ...x, answer: 'mine' as const })) }
  const none = comparisons(await run(d, withBankKey))
  assert.deepEqual(none.map((c) => c.outcome), ['not_applicable'])

  const bankNoRecords = clone(noTechnicalRecordsCase.data)
  bankNoRecords.institution = { name: 'Example Bank A', type: 'bank', code: null }
  const missing = comparisons(await run(bankNoRecords, withBankKey))
  assert.deepEqual(missing.map((c) => c.outcome), ['not_shown'])
})

test('no record line carries verdict wording', async () => {
  const VERDICT = /\b(?:breach(?:ed|es)?|violat\w*|fail(?:ed|s)? to|did not comply|non-?complian\w*|liable|liability|negligen\w*|reckless\w*|grossly|unauthori[sz]ed access)\b/i
  for (const c of FIDREC_UPDATE_CASES) {
    for (const line of comparisons(await run(c.data, withBankKey))) assert.doesNotMatch(line.record, VERDICT, `${c.id}: ${line.record}`)
  }
})
