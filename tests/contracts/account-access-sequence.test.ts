import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAccountAccessSequence,
  CARD_LOSS_SHARING_STATEMENT_KEY,
  CREDENTIALS_STATED,
  linkedPayments,
  SCHEME_ANCHOR_CLAUSE_KEYS,
  schemeStatementKeys,
  sequenceAnchor,
} from '../../supabase/functions/_shared/facts/rules/account-access-sequence.ts'
import {
  formatDateTime,
  GENDERED_PRONOUNS,
  NEAREST_VERSION_FALLBACK,
  SCHEME_STANDING_SENTENCE,
} from '../../supabase/functions/_shared/facts/update/section-writer.ts'
import {
  ALL_STATEMENT_KEYS,
  type CardAuthEvent,
  createFakeClauseProvider,
  type SectionInput,
  type SectionLine,
  type SectionResult,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import {
  cardOnlyCase,
  FIDREC_UPDATE_CASES,
  type FidrecUpdateCase,
  mixedCase,
  noTechnicalRecordsCase,
  accountSrfCase,
  syntheticCorpus,
} from '../fixtures/fidrec-update/index.ts'
import { H, lane4Corpus, statement, verdictFree } from './sequence-fault-corpus.ts'

// Brief v5 4f (decision 10) and Phase 7: the account-access sequence. Step lines in order, the `linked` / `not_shown`
// link, scheme lines by statement key only, the institution's response line.

const fake = createFakeClauseProvider(syntheticCorpus)
const run = (c: FidrecUpdateCase, provider = fake, patch: Partial<SectionInput> = {}) =>
  buildAccountAccessSequence({ ...c.data, provider, ...patch })
const texts = (r: SectionResult) => r.lines.filter((l): l is Extract<SectionLine, { kind: 'text' }> => l.kind === 'text')
const step = (r: SectionResult, n: number) => texts(r).filter((l) => l.step === n).map((l) => l.text)
const statements = (r: SectionResult) =>
  r.lines.filter((l): l is Extract<SectionLine, { kind: 'statement' }> => l.kind === 'statement').map((l) => l.statement)

const visaStatements = () => [
  statement('visa.3ds.authenticated', 'scheme', [['visa.core_rules/11.8.5', H.visa]]),
  statement('visa.cardholder', 'scheme', [['visa.core_rules/11.8.5', H.visa]]),
  statement(CARD_LOSS_SHARING_STATEMENT_KEY, 'abs_card_code', [['abs.card_code/5', H.abs5]]),
]

test('the section id is account_access_sequence and every case builds', async () => {
  for (const c of FIDREC_UPDATE_CASES) assert.equal((await run(c)).sectionId, 'account_access_sequence', c.id)
})

test('steps print in order, each numbered, with no step out of sequence', async () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const steps = texts(await run(c)).map((l) => l.step).filter((s): s is number => s !== null)
    assert.deepEqual(steps, [...steps].sort((a, b) => a - b), c.id)
    assert.equal(steps[0], 1, c.id)
    assert.equal(steps[steps.length - 1], 9, c.id)
  }
})

test('card-only: token, device statement, alert, login, wallet, payments and the linked line', async () => {
  const r = await run(cardOnlyCase)
  assert.match(step(r, 1)[0], /^The complainant states that they entered their credentials/)
  assert.deepEqual(step(r, 2), [
    "The institution's record shows a digital token activated at 20:10 on 12 September 2025 on a device labelled 'Phone model EX-300'. The record shows the activation was authorised by SMS one-time code, sent to registered mobile number.",
  ])
  assert.deepEqual(step(r, 3), ['The complainant states that this device is not theirs.'])
  assert.deepEqual(step(r, 4), ['The record shows an alert about the activation sent at 20:10 on 12 September 2025 to cardholder@example.com.'])
  assert.deepEqual(step(r, 5), ['The record shows a login at 20:15 on 12 September 2025 from this device, authorised by digital token.'])
  assert.deepEqual(step(r, 6), [
    "The record shows the card ending 0001 added to a mobile wallet at 20:32 on 12 September 2025 on a device labelled 'Phone model EX-300', authorised by the digital token.",
  ])
  assert.deepEqual(step(r, 7), [
    'The record shows 3 card payments totalling S$7,550 between 20:48 on 12 September 2025 and 00:15 on 13 September 2025, authenticated by 3-D Secure with the digital token.',
  ])
  assert.deepEqual(step(r, 8), [
    'On the records provided, 3 of these payments were authenticated through 3-D Secure using the digital token activated at 20:10 on 12 September 2025.',
  ])
  const linked = texts(r).find((l) => l.step === 8)!
  assert.deepEqual(linked.evidenceIds, ['E4', 'E6'])
  assert.deepEqual(step(r, 9), ['The complainant reported to the institution on 13 September 2025. The record shows the card blocked at 08:45 on 13 September 2025.'])
})

test('mixed: no token, so the link is not_shown; the wallet was added by SMS code; payments grouped by method', async () => {
  const r = await run(mixedCase)
  assert.deepEqual(step(r, 2), ['The records provided do not show a digital token activated or a device registered.'])
  assert.deepEqual(step(r, 3), [])
  assert.deepEqual(step(r, 8), ['The records provided do not show which device or token authenticated these payments.'])
  assert.match(step(r, 6)[0], /authorised by an SMS one-time code, sent to registered mobile number\.$/)
  assert.deepEqual(step(r, 7), [
    'The record shows 1 card payment of S$860 at 11:30 on 20 May 2025, authenticated by 3-D Secure with a one-time code.',
    'The record shows 1 card payment of S$415.50 at 01:10 on 21 May 2025, with no authentication recorded.',
    "The record shows 1 card payment of S$1,240 at 13:45 on 21 May 2025, authenticated by the mobile wallet on the device labelled 'Phone model EX-400'.",
  ])
})

test('the link needs the payment device or token to be the activated one; another device and token give not_shown', async () => {
  const events = cardOnlyCase.data.facts.card_auth_events.value.map((e) => ({ ...e, deviceRef: 'dev-ex-other', tokenRef: 'tok-ex-other' }))
  const facts = { ...cardOnlyCase.data.facts, card_auth_events: { value: events, label: 'confirmed' as const } }
  const r = await buildAccountAccessSequence({ ...cardOnlyCase.data, facts, provider: fake })
  assert.deepEqual(step(r, 8), ['The records provided do not show which device or token authenticated these payments.'])
  // Only 3-D Secure payments count, even on the token device.
  const anchor = sequenceAnchor(cardOnlyCase.data.facts.access_events.value)
  const walletOnly = cardOnlyCase.data.facts.card_auth_events.value.map((e) => ({ ...e, authentication: 'wallet_device' as const }))
  assert.equal(linkedPayments(anchor, walletOnly).length, 0)
  assert.equal(linkedPayments(null, cardOnlyCase.data.facts.card_auth_events.value).length, 0)
})

test('account case: steps 6-8 and scheme lines do not print; step 5 lists only the token device', async () => {
  const r = await run(accountSrfCase)
  for (const n of [6, 7, 8]) assert.deepEqual(step(r, n), [], `step ${n}`)
  assert.deepEqual(step(r, 5), [
    'The record shows a login at 21:10 on 3 July 2025 from this device, authorised by digital token.',
    'The record shows a payee added at 21:20 on 3 July 2025 from this device, authorised by digital token.',
  ])
  assert.deepEqual(statements(r), [])
  assert.ok(!texts(r).some((l) => l.text === SCHEME_STANDING_SENTENCE))
  assert.match(step(r, 9)[0], /The record shows access to the account blocked at 09:30 on 4 July 2025\.$/)
})

test('a case with no technical record yields not_shown throughout', async () => {
  const r = await run(noTechnicalRecordsCase)
  const after1 = texts(r).filter((l) => (l.step ?? 0) > 1)
  assert.ok(after1.length > 0)
  for (const l of after1) assert.match(l.text, /do not show/, l.text)
  assert.deepEqual(r.flags, [])
})

test('step 1 without a confirmed answer prints not shown; a device without a statement prints not shown', async () => {
  const facts = { ...cardOnlyCase.data.facts, credentials_or_otp_shared: { value: 'entered_on_fake_site_or_app' as const, label: 'not_sure' as const } }
  const r = await buildAccountAccessSequence({ ...cardOnlyCase.data, facts: { ...facts, device_recognition: undefined }, provider: fake })
  assert.deepEqual(step(r, 1), ['The records provided do not show how the credentials, card details or code were given.'])
  assert.deepEqual(step(r, 3), ["The records provided do not show the complainant's statement about this device."])
})

test('scheme not held on the payment date: a not-held line and a clause_not_held flag, no statements', async () => {
  const r = await run(cardOnlyCase)
  assert.ok(texts(r).some((l) => l.text === "This pack does not hold Visa's rules in force on 12 September 2025."))
  assert.deepEqual(statements(r), [])
  assert.deepEqual(r.flags, [{ code: 'clause_not_held', key: SCHEME_ANCHOR_CLAUSE_KEYS.visa, onDate: '2025-09-12' }])
  const mixed = await run(mixedCase)
  assert.deepEqual(mixed.flags, [{ code: 'clause_not_held', key: SCHEME_ANCHOR_CLAUSE_KEYS.mastercard, onDate: '2025-05-20' }])
})

test('scheme held: standing sentence, coverage sentence, statements by key with the provider\'s text, pinned clause', async () => {
  const provider = createFakeClauseProvider(lane4Corpus(visaStatements()))
  const r = await run(cardOnlyCase, provider)
  const all = texts(r).map((l) => l.text)
  const standing = all.indexOf(SCHEME_STANDING_SENTENCE)
  assert.ok(standing > all.findIndex((t) => t.startsWith('The complainant reported')), 'scheme lines come after step 9')
  assert.equal(
    all[standing + 1],
    "This pack holds selected sections of Visa's rules, edition dated 1 March 2025, on how unauthorised payments are handled. It does not hold the full rules.",
  )
  assert.deepEqual(statements(r).map((s) => s.statementKey), ['visa.3ds.authenticated', 'visa.cardholder', CARD_LOSS_SHARING_STATEMENT_KEY])
  for (const s of statements(r)) {
    assert.equal(s.text, `Synthetic wording of ${s.statementKey}, revision 1.`)
    assert.ok(s.statementId)
  }
  assert.ok(r.citations.some((c) => c.clauseKey === 'visa.core_rules/11.8.5' && c.textSha256 === H.visa && c.onDate === '2025-09-12'))
  assert.deepEqual(r.flags, [])
  // The response line closes the section.
  const last = r.lines[r.lines.length - 1]
  assert.equal(last.kind, 'text')
  if (last.kind === 'text') assert.match(last.text, /^The institution's letter states that it did not raise a dispute because '/)
})

test('a scheme statement with no approved revision prints by key with no text, and the run is flagged', async () => {
  const provider = createFakeClauseProvider(lane4Corpus([
    statement('visa.3ds.authenticated', 'scheme', [['visa.core_rules/11.8.5', sha64('9')]]), // checked against other wording
    statement('visa.cardholder', 'scheme', [['visa.core_rules/11.8.5', H.visa]], { status: 'draft' }),
  ]))
  const r = await run(cardOnlyCase, provider)
  assert.deepEqual(statements(r).map((s) => [s.statementKey, s.text]), [
    ['visa.3ds.authenticated', null],
    ['visa.cardholder', null],
    [CARD_LOSS_SHARING_STATEMENT_KEY, null],
  ])
  assert.deepEqual(r.flags.map((f) => f.key), ['visa.3ds.authenticated', 'visa.cardholder', CARD_LOSS_SHARING_STATEMENT_KEY])
  assert.ok(r.flags.every((f) => f.code === 'statement_under_review' && f.onDate === '2025-09-12'))
})

function sha64(c: string) {
  return c.repeat(64)
}

const ev = (p: Partial<CardAuthEvent>): CardAuthEvent => ({
  timestamp: '2025-09-12T20:00:00+08:00',
  transactionIndex: 0,
  cardScheme: 'visa',
  merchant: null,
  merchantCountry: null,
  entryMode: 'ecommerce',
  authentication: 'three_ds_otp',
  authenticationResult: 'authenticated',
  sentTo: null,
  deviceLabel: null,
  deviceRef: null,
  tokenRef: null,
  walletProvisionedAt: null,
  walletDeviceLabel: null,
  walletProvisioningAuthentication: null,
  walletProvisioningSentTo: null,
  walletTokenRemovedAt: null,
  ...p,
})

test('scheme statement keys follow 4f: authenticated, attempted, token, none recorded, and the cardholder line last', () => {
  assert.deepEqual(schemeStatementKeys('visa', [ev({})]), ['visa.3ds.authenticated', 'visa.cardholder'])
  assert.deepEqual(schemeStatementKeys('visa', [ev({ authenticationResult: 'attempted' })]), ['visa.3ds.attempted', 'visa.cardholder'])
  assert.deepEqual(schemeStatementKeys('visa', [ev({ authenticationResult: 'failed' })]), [])
  assert.deepEqual(
    schemeStatementKeys('visa', [ev({ entryMode: 'wallet_token', authentication: 'wallet_device' })]),
    ['visa.token.authenticated', 'visa.cardholder'],
  )
  assert.deepEqual(
    schemeStatementKeys('visa', [ev({ authentication: 'none_recorded', authenticationResult: 'not_known' })]),
    ['visa.dispute.permitted', 'visa.report', 'visa.no3ds', 'visa.cardholder'],
  )
  assert.deepEqual(
    schemeStatementKeys('mastercard', mixedCase.data.facts.card_auth_events.value.filter((e) => e.transactionIndex !== null)),
    ['mc.authenticated', 'mc.dispute.permitted', 'mc.report', 'mc.cardholder'],
  )
  assert.deepEqual(schemeStatementKeys('mastercard', [ev({ entryMode: 'chip', authentication: 'pin', cardScheme: 'mastercard' })]), ['mc.pin', 'mc.cardholder'])
  // Every key is a contract key.
  for (const e of [ev({}), ev({ authenticationResult: 'attempted' }), ev({ authentication: 'none_recorded' })]) {
    for (const k of [...schemeStatementKeys('visa', [e]), ...schemeStatementKeys('mastercard', [e])]) {
      assert.ok((ALL_STATEMENT_KEYS as readonly string[]).includes(k), k)
    }
  }
  // Decision 9: the closing statement is now a contract key (was "proposed, not yet in the contract").
  assert.ok((ALL_STATEMENT_KEYS as readonly string[]).includes(CARD_LOSS_SHARING_STATEMENT_KEY), 'bridge.card_loss_sharing is a contract key')
})

test('no scheme wording in code: statement text comes only from the provider', async () => {
  const corpus = lane4Corpus(visaStatements())
  const wording = corpus.statements.map((s) => s.text)
  for (const c of FIDREC_UPDATE_CASES) {
    const r = await run(c, createFakeClauseProvider(corpus))
    for (const l of texts(r)) for (const w of wording) assert.ok(!l.text.includes(w), `${c.id}: ${l.text}`)
  }
})

test('the response line follows the institution\'s letters only', async () => {
  const withResponse = (value: unknown) => ({ ...cardOnlyCase.data.facts, card_dispute_response: { value, label: 'confirmed' as const } })
  const last = async (facts: object) => {
    const r = await buildAccountAccessSequence({ ...cardOnlyCase.data, facts: facts as SectionInput['facts'], provider: fake })
    const l = r.lines[r.lines.length - 1]
    return l.kind === 'text' ? l.text : ''
  }
  assert.equal(await last(withResponse({ status: 'raised', date: '2025-09-20', reasonStated: null, outcome: null })), "The institution's letter states that it raised a dispute on 20 September 2025.")
  assert.equal(await last(withResponse({ status: 'declined', date: null, reasonStated: null, outcome: null })), "The institution's letter states that it did not raise a dispute.")
  assert.equal(await last(withResponse({ status: 'no_answer', date: null, reasonStated: null, outcome: null })), "The institution's letters do not say whether it raised a dispute.")
  assert.equal(await last({ ...cardOnlyCase.data.facts, card_dispute_response: undefined }), "The institution's letters do not say whether it raised a dispute.")
})

test('times print as the record states them, with no time-zone conversion', () => {
  assert.equal(formatDateTime('2025-09-13T00:15:00+08:00'), '00:15 on 13 September 2025')
  assert.equal(formatDateTime('2025-09-12T23:59:00-05:00'), '23:59 on 12 September 2025')
  assert.equal(formatDateTime('2025-09-12'), '12 September 2025')
})

test('no verdict wording, and nothing about who took the token or made the payments', async () => {
  const provider = createFakeClauseProvider(lane4Corpus(visaStatements()))
  for (const c of FIDREC_UPDATE_CASES) {
    for (const r of [await run(c), await run(c, provider)]) {
      for (const l of texts(r)) {
        if (l.step === 1) continue // the complainant's confirmed wording
        assert.ok(verdictFree(l.text), `${c.id}: ${l.text}`)
      }
    }
  }
})

test('step 8: the token route links a payment whose record states the activated token, on another device', async () => {
  const events = cardOnlyCase.data.facts.card_auth_events.value.map((e) => ({ ...e, deviceRef: 'dev-ex-other' }))
  const anchor = sequenceAnchor(cardOnlyCase.data.facts.access_events.value)!
  assert.equal(anchor.tokenRef, 'tok-ex-0102')
  // Different device, same token: linked by the token route.
  assert.equal(linkedPayments(anchor, events).length, events.filter((e) => e.transactionIndex !== null).length)
  // Different device and different token: not linked.
  assert.equal(linkedPayments(anchor, events.map((e) => ({ ...e, tokenRef: 'tok-ex-other' }))).length, 0)
  // No token reference on the activation: only the device route.
  assert.equal(linkedPayments({ ...anchor, tokenRef: null }, events).length, 0)
  // No device reference on the activation: the token route alone.
  assert.ok(linkedPayments({ ...anchor, deviceRef: null }, cardOnlyCase.data.facts.card_auth_events.value).length > 0)
  const facts = { ...cardOnlyCase.data.facts, card_auth_events: { value: events, label: 'confirmed' as const } }
  const r = await buildAccountAccessSequence({ ...cardOnlyCase.data, facts, provider: fake })
  assert.match(step(r, 8)[0], /^On the records provided, 3 of these payments were authenticated through 3-D Secure using the digital token activated at/)
})

test('scheme edition before the payment date not held: the nearest-version fallback, then that edition\'s statements', async () => {
  const provider = createFakeClauseProvider(lane4Corpus(visaStatements()))
  const payments = cardOnlyCase.data.payments.map((p) => ({ ...p, date: '2024-10-01' }))
  const r = await run(cardOnlyCase, provider, { payments })
  const all = texts(r).map((l) => l.text)
  const fallback = NEAREST_VERSION_FALLBACK('Visa', '2024-10-01', '2025-03-01')
  assert.equal(fallback, 'This pack does not hold Visa\'s rules as in force on 1 October 2024. The nearest edition held is dated 1 March 2025. The lines below are from that edition.')
  assert.equal(all[all.indexOf(SCHEME_STANDING_SENTENCE) + 1], fallback)
  assert.ok(!all.some((t) => t.startsWith("This pack does not hold Visa's rules in force on")))
  // The statements are read for the nearest edition, so the ones approved for it print.
  const s = statements(r)
  assert.deepEqual(s.map((x) => x.statementKey), ['visa.3ds.authenticated', 'visa.cardholder', CARD_LOSS_SHARING_STATEMENT_KEY])
  assert.deepEqual(s.slice(0, 2).map((x) => x.onDate), ['2025-03-01', '2025-03-01'])
  assert.ok(r.flags.some((f) => f.code === 'nearest_version_held' && f.key === SCHEME_ANCHOR_CLAUSE_KEYS.visa && f.onDate === '2024-10-01'))
})

test('Mastercard anchor and the closing statement use the contract keys (Step 0b)', () => {
  assert.equal(SCHEME_ANCHOR_CLAUSE_KEYS.mastercard, 'mastercard.chargeback_guide/dms.4837.issuer-chargeback')
  assert.equal(CARD_LOSS_SHARING_STATEMENT_KEY, 'bridge.card_loss_sharing')
})

test('Decision 2: no she / her / hers in any line, including CREDENTIALS_STATED', async () => {
  for (const t of Object.values(CREDENTIALS_STATED)) assert.ok(!GENDERED_PRONOUNS.test(t), t)
  const provider = createFakeClauseProvider(lane4Corpus(visaStatements()))
  for (const c of FIDREC_UPDATE_CASES) {
    for (const l of texts(await run(c, provider))) assert.ok(!GENDERED_PRONOUNS.test(l.text), `${c.id}: ${l.text}`)
  }
})
