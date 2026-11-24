import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assessSrf, normaliseInstitution, srfFactsFromSnapshot } from '../../lib/facts'
import {
  ACCESS_EVENT_KINDS,
  ALERT_THRESHOLD_SETTERS,
  ALL_STATEMENT_KEYS,
  AS_OF_FUNCTIONS,
  CARD_AUTHENTICATION_RESULTS,
  CARD_AUTHENTICATIONS,
  CARD_DISPUTE_STATUSES,
  CARD_SCHEMES,
  AS_OF_RULES,
  CLAUSE_KEYS,
  COMPARISON_OUTCOMES,
  complainantRecognisesDevice,
  CONDUCT_LINE_KINDS,
  CONDUCT_MARKERS,
  CONDUCT_TOPICS,
  CORPUS_INSTRUMENTS,
  createFakeClauseProvider,
  CREDIT_BUREAU_REPORT_DOCUMENT_TYPE,
  DECIDED_STATEMENT_KEYS_2026_11_24,
  DEVICE_RECOGNITION_ANSWERS,
  documentDatedAfterEvents,
  ENTRY_MODES,
  IP_NETWORK_FLAGS,
  NAMED_CLAUSE_KEYS,
  readDateFor,
  recognitionAnswerFor,
  RULE_CLAUSE_KEYS,
  SECTION_IDS,
  type SectionBuilder,
  type SectionInput,
  TECHNICAL_RECORD_DOCUMENT_TYPES,
  TOKEN_ACTIVATION_METHODS,
  TWELVE_HOUR_BLOCK_HEADINGS,
  TWELVE_HOUR_EXCLUDED_KINDS,
  TWELVE_HOUR_NAMED_KINDS,
  TWELVE_HOUR_WINDOW_MS,
  UPDATE_FACT_KEYS,
  WALLET_PROVISIONING_AUTHENTICATIONS,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import {
  accountSrfCase,
  cardOnlyCase,
  EUPG_A_TO,
  FIDREC_UPDATE_CASES,
  SRF_FRAUD_SURVEILLANCE_FROM,
  syntheticCorpus,
} from '../fixtures/fidrec-update/index.ts'

// Lanes plan, Step 0: the contract the lanes build against, its fake provider and the four synthetic cases.
// Brief v5: Phase 3b (facts), 3.2 (as-of reads), 4i (section order), 4a/4d/Phase 7 (keys).

const BRIEF = 'docs/agent-briefs/2026-11-20-agent-brief-fidrec-technical-records-and-standards-corpus.md'
const CORPUS_MIGRATION = 'supabase/migrations/20261201120000_standards_corpus.sql'
const REVIEW_LINKS_MIGRATION = 'supabase/migrations/20261202120000_standards_review_links.sql'

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const has = (list: readonly string[], value: unknown) => typeof value === 'string' && list.includes(value)

// ---------------------------------------------------------------------------------------------------------------
// Fixtures against the contract (the compile-time check is `satisfies FidrecUpdateCase` in each fixture; these
// check the values a type cannot: enum members at run time, indexes, dates, cross-references).
// ---------------------------------------------------------------------------------------------------------------

test('there are four synthetic cases: account in SRF scope, card only, mixed, no technical records', () => {
  assert.deepEqual(FIDREC_UPDATE_CASES.map((c) => c.id), ['account-srf', 'card-only', 'mixed', 'no-technical-records'])
  const byId = Object.fromEntries(FIDREC_UPDATE_CASES.map((c) => [c.id, c]))
  assert.equal(byId['card-only'].data.payments.every((p) => p.instrument === 'sg_card'), true)
  assert.equal(byId['account-srf'].data.payments.every((p) => p.instrument === 'account_transfer'), true)
  assert.deepEqual(new Set(byId.mixed.data.payments.map((p) => p.instrument)), new Set(['account_transfer', 'sg_card']))
  const noRecords = byId['no-technical-records'].data
  assert.equal(noRecords.facts.access_events, undefined)
  assert.equal(noRecords.facts.card_auth_events, undefined)
  assert.equal(noRecords.ipLocations.length, 0)
})

test('the card-only case has a token activation, a wallet provisioning and 3-D Secure payments with that token', () => {
  const c = FIDREC_UPDATE_CASES.find((x) => x.id === 'card-only')!
  const access = c.data.facts.access_events!.value!
  const cards = c.data.facts.card_auth_events!.value!
  const token = access.find((e) => e.kind === 'token_activated')!
  assert.ok(token.deviceRef)
  assert.ok(cards.some((e) => e.walletProvisionedAt && e.walletDeviceLabel === token.deviceLabel))
  const payments = cards.filter((e) => e.transactionIndex !== null)
  assert.equal(payments.length, c.data.payments.length)
  assert.ok(payments.every((e) => e.authentication.startsWith('three_ds_') && e.deviceRef === token.deviceRef))
})

test('fixture values are members of the contract enums, and indexes point at real payments', () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const { facts, payments, ipLocations, evidenceIds, instruments } = c.data
    const transactions = facts.transactions?.value ?? []
    assert.equal(payments.length, transactions.length, c.id)
    payments.forEach((p, i) => {
      assert.equal(p.index, i, c.id)
      assert.deepEqual({ ...p, index: undefined, excludedFromDrainTest: undefined }, { ...transactions[i], index: undefined, excludedFromDrainTest: undefined }, c.id)
    })
    assert.deepEqual([...new Set(payments.map((p) => p.instrument))].sort(), [...instruments].sort(), c.id)
    assert.deepEqual([...c.shape.instruments].sort(), [...instruments].sort(), c.id)
    const inRange = (i: number | null) => i === null || (Number.isInteger(i) && i >= 0 && i < transactions.length)

    for (const e of facts.access_events?.value ?? []) {
      assert.ok(has(ACCESS_EVENT_KINDS, e.kind), `${c.id}: ${e.kind}`)
      assert.ok(inRange(e.relatedTransactionIndex), c.id)
    }
    for (const e of facts.card_auth_events?.value ?? []) {
      assert.ok(has(CARD_SCHEMES, e.cardScheme), c.id)
      assert.ok(has(ENTRY_MODES, e.entryMode), c.id)
      assert.ok(has(CARD_AUTHENTICATIONS, e.authentication), c.id)
      assert.ok(has(CARD_AUTHENTICATION_RESULTS, e.authenticationResult), c.id)
      assert.ok(e.walletProvisioningAuthentication === null || has(WALLET_PROVISIONING_AUTHENTICATIONS, e.walletProvisioningAuthentication), c.id)
      assert.ok(inRange(e.transactionIndex), c.id)
      if (e.transactionIndex !== null) assert.equal(payments[e.transactionIndex].instrument, 'sg_card', c.id)
    }
    const devices = new Set([
      ...(facts.access_events?.value ?? []).map((e) => e.deviceRef),
      ...(facts.card_auth_events?.value ?? []).map((e) => e.deviceRef),
    ].filter(Boolean))
    for (const d of facts.device_recognition?.value ?? []) {
      assert.ok(has(DEVICE_RECOGNITION_ANSWERS, d.answer), c.id)
      assert.ok(devices.has(d.deviceRef), `${c.id}: ${d.deviceRef} is not in the records`)
    }
    const response = facts.card_dispute_response?.value
    if (response) assert.ok(has(CARD_DISPUTE_STATUSES, response.status), c.id)
    const threshold = facts.transaction_alert_threshold?.value
    if (threshold) assert.ok(has(ALERT_THRESHOLD_SETTERS, threshold.setBy), c.id)
    const method = facts.token_activation_method?.value
    if (method) assert.ok(has(TOKEN_ACTIVATION_METHODS, method), c.id)
    for (const l of ipLocations) for (const f of l.flags) assert.ok(has(IP_NETWORK_FLAGS, f), c.id)

    // Every new fact key used is a contract key; every evidence ID is E<n>.
    for (const key of Object.keys(facts)) {
      if (!(UPDATE_FACT_KEYS as readonly string[]).includes(key)) continue
      assert.ok(facts[key as keyof typeof facts]!.label, `${c.id}: ${key} has a label`)
    }
    for (const ids of Object.values(evidenceIds)) for (const id of ids!) assert.match(id, /^E\d+$/, c.id)

    // Dates and times parse.
    for (const e of [...(facts.access_events?.value ?? []), ...(facts.card_auth_events?.value ?? [])]) {
      if (e.timestamp) assert.ok(!Number.isNaN(Date.parse(e.timestamp)), `${c.id}: ${e.timestamp}`)
    }
    for (const t of transactions) assert.match(t.date!, /^\d{4}-\d{2}-\d{2}$/, c.id)
  }
})

test('the SRF rules see each case as its shape says (account in scope, card outside)', () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const assessment = assessSrf(srfFactsFromSnapshot(c.data.facts as never))
    const srf = assessment.portions.find((p) => p.kind === 'srf')
    assert.equal(srf?.assessment ?? null, c.shape.srfPortion, c.id)
    assert.equal(assessment.portions.some((p) => p.kind === 'card'), c.shape.hasCardPortion, c.id)
    assert.equal(Boolean(c.data.facts.access_events), c.shape.hasAccessRecord, c.id)
    assert.equal(Boolean(c.data.facts.card_auth_events), c.shape.hasCardAuthenticationRecord, c.id)
  }
})

test('the account case reaches both fraud-surveillance figures after 16 June 2025; the mixed case reaches neither', () => {
  const byId = Object.fromEntries(FIDREC_UPDATE_CASES.map((c) => [c.id, c]))
  const figures = (id: string) => {
    const { facts, payments } = byId[id].data
    const balance = facts.balance_before_first_disputed_payment!.value!.amount
    const out = payments.filter((p) => p.instrument === 'account_transfer' && !p.excludedFromDrainTest).reduce((s, p) => s + p.amount.amount, 0)
    return { balance, share: out / balance, first: payments[0].date! }
  }
  const account = figures('account-srf')
  assert.ok(account.balance >= 50_000 && account.share > 0.5 && account.first >= SRF_FRAUD_SURVEILLANCE_FROM)
  const mixed = figures('mixed')
  assert.ok(mixed.balance < 50_000 && mixed.share <= 0.5 && mixed.first < SRF_FRAUD_SURVEILLANCE_FROM)
})

// ---------------------------------------------------------------------------------------------------------------
// No real-looking personal data in the fixtures (CLAUDE.md)
// ---------------------------------------------------------------------------------------------------------------

test('fixtures hold no real-looking personal data', () => {
  const text = JSON.stringify({ cases: FIDREC_UPDATE_CASES, corpus: syntheticCorpus })
  assert.doesNotMatch(text, /\b[STFGM]\d{7}[A-Z]\b/i, 'NRIC/FIN-like identifier')
  assert.doesNotMatch(text, /(?:\+?65[\s-]?)?\b[3689]\d{3}[\s-]?\d{4}\b/, 'Singapore phone number')
  assert.doesNotMatch(text, /\+\d{6,}/, 'international phone number')
  assert.doesNotMatch(text, /\b\d{13,19}\b/, 'card number')
  for (const email of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(email, /@example\.com$/, email)
  for (const ip of text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) {
    assert.match(ip, /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/, `${ip} is outside the documentation ranges`)
  }
  for (const c of FIDREC_UPDATE_CASES) {
    for (const l of c.data.ipLocations) if (l.asn !== null) assert.ok(l.asn >= 64496 && l.asn <= 64511, `${c.id}: ASN ${l.asn}`)
    for (const i of c.data.facts.institution_names?.value ?? []) {
      // A placeholder name that the alias table does not turn into a real institution.
      assert.match(i.name, /^Example /, c.id)
      assert.deepEqual(normaliseInstitution(i.name), { name: i.name, type: 'other' }, c.id)
    }
    for (const p of c.data.payments) assert.match(p.payee ?? 'Example', /Example/, c.id)
  }
})

// ---------------------------------------------------------------------------------------------------------------
// Sections and keys against the brief and the migrations
// ---------------------------------------------------------------------------------------------------------------

test('section IDs follow the order of brief 4i, with disputed_amount_charges after duty_time_checks (review Decision 8)', () => {
  const line = read(BRIEF).split('\n').find((l) => l.startsWith('Existing sections, then:'))
  assert.ok(line, 'brief 4i order line')
  const ids = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1])
  // Brief v5 does not have the Section 8 check yet (brief v6 will); the review of 24 Nov 2026 places it here.
  assert.ok(!ids.includes('disputed_amount_charges'), 'once the brief names it, compare with the brief alone')
  ids.splice(ids.indexOf('duty_time_checks') + 1, 0, 'disputed_amount_charges')
  assert.deepEqual([...SECTION_IDS], ids)
  assert.ok(line.trimEnd().endsWith('arguments for each side.'))
})

test('every statement key is one the brief names or the review of 24 Nov decided, and matches the key pattern', () => {
  const brief = read(BRIEF)
  const migration = read(CORPUS_MIGRATION)
  const pattern = '^[a-z0-9_]+(\\.[a-z0-9_]+)+$'
  assert.ok(migration.includes(`statement_key ~ '${pattern}'`))
  assert.equal(new Set(ALL_STATEMENT_KEYS).size, ALL_STATEMENT_KEYS.length)
  const decided: readonly string[] = DECIDED_STATEMENT_KEYS_2026_11_24
  for (const key of ALL_STATEMENT_KEYS) {
    assert.ok(brief.includes(`\`${key}\``) || decided.includes(key), `${key} is neither in the brief nor decided`)
    assert.match(key, new RegExp(pattern), key)
  }
  // Every decided key is in the contract's list, and the replaced proposals are not.
  for (const key of decided) assert.ok((ALL_STATEMENT_KEYS as readonly string[]).includes(key), key)
  for (const key of ['srf.highrisk.wallet', 'eupg.highrisk.wallet']) assert.ok(!(ALL_STATEMENT_KEYS as readonly string[]).includes(key), key)
})

test('every rule clause key matches the standard_clauses key pattern and names a document the corpus knows', () => {
  const migration = read(CORPUS_MIGRATION)
  const pattern = '^[a-z0-9]+(\\.[a-z0-9_-]+)+/[a-z0-9._()~-]+$'
  assert.ok(migration.includes(`clause_key ~ '${pattern}'`))
  assert.equal(new Set(RULE_CLAUSE_KEYS).size, Object.values(CLAUSE_KEYS).flat().length)
  // Documents loaded today or named by the brief for Phase 2 and Phase 7; since Step 0b also those Lanes 1 and 5 loaded.
  const documents = new Set([
    'mas.eupg',
    'mas.srf',
    'mas.fsm-n05',
    'mas.fsm-n07',
    'abs.card_code',
    'abs.media_2025_02_card_provisioning',
    'mas.reply.20250107',
    'visa.core_rules',
    'mastercard.chargeback_guide',
  ])
  for (const key of RULE_CLAUSE_KEYS) {
    assert.match(key, new RegExp(pattern), key)
    assert.ok(documents.has(key.split('/')[0]), key)
  }
  for (const section of Object.keys(CLAUSE_KEYS)) assert.ok((SECTION_IDS as readonly string[]).includes(section), section)
})

test('Step 0b: clause keys use the names Lanes 1 and 5 loaded, and cite the 2.1 definitions, not the chapeau', () => {
  const keys: readonly string[] = RULE_CLAUSE_KEYS
  for (const wrong of ['mas.reply_20250107/3ds', 'mastercard.chargeback_guide/no_cardholder_authorization', 'mas.srf/2.1', 'mas.eupg/2.1']) {
    assert.ok(!keys.includes(wrong), wrong)
  }
  for (const key of Object.values(NAMED_CLAUSE_KEYS)) assert.ok(keys.includes(key), key)
  assert.equal(NAMED_CLAUSE_KEYS.masReply3ds, 'mas.reply.20250107/3(a).3ds')
  assert.equal(NAMED_CLAUSE_KEYS.mastercardIssuerChargeback, 'mastercard.chargeback_guide/dms.4837.issuer-chargeback')
  assert.equal(NAMED_CLAUSE_KEYS.mastercardIneligible, 'mastercard.chargeback_guide/dms.4837.ineligible')
  assert.equal(NAMED_CLAUSE_KEYS.srfHighRiskDefinition, 'mas.srf/2.1(high-risk-activities)')
  assert.equal(NAMED_CLAUSE_KEYS.eupgHighRiskDefinition, 'mas.eupg/2.1(high-risk-activities)')
})

test('Decision 8: the new facts and the optional credit bureau report document type', () => {
  for (const key of ['disputed_amount_payment_requests', 'charges_on_disputed_amount', 'credit_bureau_reports', 'fidrec_dispute_dates']) {
    assert.ok((UPDATE_FACT_KEYS as readonly string[]).includes(key), key)
  }
  assert.equal(CREDIT_BUREAU_REPORT_DOCUMENT_TYPE, 'credit_bureau_report')
  assert.ok(!(TECHNICAL_RECORD_DOCUMENT_TYPES as readonly string[]).includes(CREDIT_BUREAU_REPORT_DOCUMENT_TYPE))
})

test('Decision 1: seven conduct topics, four conduct line kinds, comparison outcomes unchanged', () => {
  assert.deepEqual(CONDUCT_MARKERS, [
    'credentials_entered',
    'credentials_given',
    'app_installed',
    'card_payment_approved',
    'alerts_and_report',
    'block_used',
    'police_report',
  ])
  assert.equal(CONDUCT_TOPICS.alerts_and_report, 'notifications and alerts from the institution')
  assert.equal(CONDUCT_TOPICS.card_payment_approved, 'authenticating a card payment')
  assert.deepEqual([...CONDUCT_LINE_KINDS], ['refers_to', 'does_not_refer_to', 'no_conduct_test', 'records_do_not_show'])
  assert.deepEqual([...COMPARISON_OUTCOMES], ['differs', 'matches', 'not_shown', 'not_applicable'])
  for (const topic of Object.values(CONDUCT_TOPICS)) assert.doesNotMatch(topic, /\b(matches|differs|negligen|reckless|fault)/i, topic)
})

test('Decision 4: the 12-hour block headings and groups; the institution\'s own messages are not activities', () => {
  assert.equal(TWELVE_HOUR_BLOCK_HEADINGS.block, 'The 12 hours after the digital token was activated')
  assert.equal(TWELVE_HOUR_BLOCK_HEADINGS.named, 'Activities the definitions name')
  assert.equal(TWELVE_HOUR_BLOCK_HEADINGS.other, 'Other activities the record shows in the 12 hours')
  assert.deepEqual([...TWELVE_HOUR_NAMED_KINDS], ['payee_added', 'limit_changed', 'notifications_disabled', 'contact_details_changed'])
  assert.deepEqual([...TWELVE_HOUR_EXCLUDED_KINDS], ['otp_sent', 'alert_sent'])
  assert.equal(TWELVE_HOUR_WINDOW_MS, 12 * 60 * 60 * 1000)
  for (const h of Object.values(TWELVE_HOUR_BLOCK_HEADINGS)) assert.doesNotMatch(h, /high-risk/i)
})

test('the card-only case names its digital token on the activation line (tokenRef)', () => {
  const events = cardOnlyCase.data.facts.access_events!.value!
  const activation = events.find((e) => e.kind === 'token_activated')!
  const payments = cardOnlyCase.data.facts.card_auth_events!.value!.filter((e) => e.transactionIndex !== null)
  assert.ok(activation.tokenRef)
  assert.ok(payments.every((p) => p.tokenRef === activation.tokenRef))
})

test('the not-sure rule: only a clear "mine" on a confirmed or claimant-only fact counts as recognised', () => {
  const device = { deviceRef: 'dev-x', deviceLabel: 'Phone X' }
  const fact = (answer: 'mine' | 'not_mine' | 'not_sure', label: 'confirmed' | 'claimant_only' | 'not_sure' | 'not_known' = 'confirmed') =>
    ({ value: [{ deviceRef: 'dev-x', deviceLabel: 'Phone X', firstSeenAt: null, answer }], label })
  assert.equal(complainantRecognisesDevice(fact('mine'), device), true)
  assert.equal(complainantRecognisesDevice(fact('mine', 'claimant_only'), device), true)
  assert.equal(complainantRecognisesDevice(fact('not_mine'), device), false)
  assert.equal(complainantRecognisesDevice(fact('not_sure'), device), false)
  assert.equal(complainantRecognisesDevice(fact('mine', 'not_sure'), device), false)
  assert.equal(complainantRecognisesDevice(fact('mine', 'not_known'), device), false)
  assert.equal(complainantRecognisesDevice(undefined, device), false)
  assert.equal(complainantRecognisesDevice(fact('mine'), null), false, 'the record names no device')
  assert.equal(complainantRecognisesDevice(fact('mine'), { deviceRef: 'dev-y', deviceLabel: null }), false, 'no answer for this device')
  assert.equal(complainantRecognisesDevice(fact('mine'), { deviceRef: null, deviceLabel: 'Phone X' }), true, 'matched by label')
  // The answer itself is kept for printing.
  assert.equal(recognitionAnswerFor(fact('not_sure').value, device), 'not_sure')
  // The account case: one device is not_sure; it is not recognised.
  const accountFact = accountSrfCase.data.facts.device_recognition
  assert.equal(complainantRecognisesDevice(accountFact, { deviceRef: 'dev-ex-0004', deviceLabel: null }), false)
})

test('Decision 6: any_date documents are read on the generation date; a later document is dated after the events', () => {
  assert.deepEqual([...AS_OF_RULES], ['event_date', 'any_date'])
  assert.equal(readDateFor('event_date', '2025-07-03', '2026-11-24'), '2025-07-03')
  assert.equal(readDateFor('any_date', '2025-07-03', '2026-11-24'), '2026-11-24')
  assert.equal(documentDatedAfterEvents('2026-01-13', ['2025-09-12', '2025-10-20', null]), '2026-01-13')
  assert.equal(documentDatedAfterEvents('2025-01-07', ['2025-09-12', '2025-10-20']), null)
  assert.equal(documentDatedAfterEvents('2026-01-13', [null]), null)
})

test('the provider mirrors the database as-of functions: names, arguments and columns', async () => {
  const sql = read(CORPUS_MIGRATION) + read(REVIEW_LINKS_MIGRATION)
  assert.ok(sql.includes(`FUNCTION public.${AS_OF_FUNCTIONS.getClauseAsOf}(p_clause_key text, p_on_date date)`))
  assert.ok(sql.includes(`FUNCTION public.${AS_OF_FUNCTIONS.getClausesByTag}(p_tag text, p_institution text, p_on_date date)`))
  assert.ok(sql.includes(`FUNCTION public.${AS_OF_FUNCTIONS.getStatementAsOf}(p_statement_key text, p_on_date date)`))

  const columns = (fn: string) => {
    const start = sql.indexOf(`FUNCTION public.${fn}(`)
    const body = sql.slice(sql.indexOf('RETURNS TABLE (', start) + 'RETURNS TABLE ('.length, sql.indexOf(')\nLANGUAGE', start))
    return body.split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean)
  }
  const provider = createFakeClauseProvider(syntheticCorpus)
  const clause = await provider.getClauseAsOf('mas.eupg/5.2', '2025-03-01')
  assert.deepEqual(Object.keys(clause!).sort(), columns(AS_OF_FUNCTIONS.getClauseAsOf).sort())
  const tagged = await provider.getClausesByTag('definition_gross_negligence', 'example_bank_a', '2025-03-01')
  assert.deepEqual(Object.keys(tagged[0]).sort(), columns(AS_OF_FUNCTIONS.getClausesByTag).sort())
  const statement = await provider.getStatementAsOf('eupg.fault.term', '2025-03-01')
  assert.deepEqual(Object.keys(statement!).sort(), columns(AS_OF_FUNCTIONS.getStatementAsOf).sort())
})

// ---------------------------------------------------------------------------------------------------------------
// The fake provider answers as-of queries as the database does
// ---------------------------------------------------------------------------------------------------------------

const provider = createFakeClauseProvider(syntheticCorpus)

test('a clause is read from the version in force on the date; effective_to is exclusive', async () => {
  const dayBefore = '2025-12-31'
  assert.equal((await provider.getClauseAsOf('mas.eupg/4.7', dayBefore))?.version_label, 'A')
  assert.equal((await provider.getClauseAsOf('mas.eupg/4.7', EUPG_A_TO))?.version_label, 'B')
  assert.equal((await provider.getClauseAsOf('mas.eupg/4.7', '2024-12-16'))?.version_label, 'A')
  assert.equal(await provider.getClauseAsOf('mas.eupg/4.7', '2024-12-15'), null, 'before the first version')
})

test('a draft version is never read, even after its start date', async () => {
  const clause = await provider.getClauseAsOf('mas.eupg/4.7', '2026-07-01')
  assert.equal(clause?.version_label, 'B')
  assert.notEqual(clause?.text_sha256, 'd'.repeat(64))
})

test('a paragraph that starts later than its document is not in force before its own date', async () => {
  assert.equal(await provider.getClauseAsOf('mas.srf/4.2.5', '2025-06-15'), null)
  assert.equal((await provider.getClauseAsOf('mas.srf/4.2.5', SRF_FRAUD_SURVEILLANCE_FROM))?.clause_key, 'mas.srf/4.2.5')
  assert.ok(await provider.getClauseAsOf('mas.srf/4.2.1', '2025-06-15'))
})

test('clause scope falls back to the document scope where the paragraph has none', async () => {
  const srf = await provider.getClauseAsOf('mas.srf/4.2.1', '2025-03-01')
  assert.deepEqual(srf?.instrument_scope, ['account_transfer', 'ewallet'])
  const eupg = await provider.getClauseAsOf('mas.eupg/4.7', '2025-03-01')
  assert.deepEqual(eupg?.instrument_scope, ['account_transfer', 'ewallet'])
  for (const s of [...srf!.instrument_scope, ...eupg!.instrument_scope]) assert.ok(has(CORPUS_INSTRUMENTS, s))
})

test('clauses by tag: only the case institution\'s contract, ordered by document and clause key', async () => {
  const a = await provider.getClausesByTag('definition_gross_negligence', 'example_bank_a', '2025-03-01')
  assert.deepEqual(a.map((c) => c.clause_key), ['examplebanka.card_terms/12', 'examplebanka.card_terms/3'])
  const b = await provider.getClausesByTag('definition_gross_negligence', 'example_bank_b', '2025-03-01')
  assert.deepEqual(b.map((c) => c.clause_key), ['examplebankb.card_terms/9'])
  assert.deepEqual(await provider.getClausesByTag('definition_gross_negligence', null, '2025-03-01'), [])
  assert.deepEqual(await provider.getClausesByTag('definition_gross_negligence', 'example_bank_a', '2023-12-31'), [])
})

test('a statement prints in the revision checked against the wording in force on the date', async () => {
  assert.equal((await provider.getStatementAsOf('srf.newdevice.bank', '2025-12-31'))?.revision, 1)
  assert.equal((await provider.getStatementAsOf('srf.newdevice.bank', EUPG_A_TO))?.revision, 2)
  // Unchanged wording keeps printing across the version change.
  assert.equal((await provider.getStatementAsOf('eupg.fault.term', '2025-12-31'))?.revision, 1)
  assert.equal((await provider.getStatementAsOf('eupg.fault.term', EUPG_A_TO))?.revision, 1)
  // Checked against A only: nothing from B onwards ("summary under review").
  assert.equal((await provider.getStatementAsOf('link.eupg_s4', '2025-12-31'))?.revision, 1)
  assert.equal(await provider.getStatementAsOf('link.eupg_s4', EUPG_A_TO), null)
  // A draft never prints; a clause not yet in force means no statement.
  assert.equal(await provider.getStatementAsOf('abs.fault.term', '2025-03-01'), null)
  assert.equal(await provider.getStatementAsOf('eupg.fault.term', '2024-12-15'), null)
})

test('nearest version held: in force when held, else the nearest verified version, never a draft', async () => {
  // In force: the same row as the as-of read.
  const inForce = await provider.getNearestClause('mas.eupg/4.7', '2025-03-01')
  assert.equal(inForce?.relation, 'in_force')
  assert.equal(inForce?.clause.version_label, 'A')
  // Before the first version: the earliest verified version, marked as later than the date.
  const before = await provider.getNearestClause('mas.eupg/4.7', '2024-01-01')
  assert.equal(before?.relation, 'later_version')
  assert.equal(before?.clause.version_label, 'A')
  // A paragraph that starts later than its document: the nearest is its own start.
  const surveillance = await provider.getNearestClause('mas.srf/4.2.5', '2025-06-15')
  assert.equal(surveillance?.relation, 'later_version')
  assert.equal(surveillance?.clause.clause_key, 'mas.srf/4.2.5')
  assert.equal(await provider.getNearestClause('mas.eupg/no-such-clause', '2025-03-01'), null)
  await assert.rejects(async () => provider.getNearestClause('mas.eupg/4.7', 'March 2025'))

  // An earlier version that has ended, and a draft that is never read.
  const ended = createFakeClauseProvider({
    versions: [
      { ...syntheticCorpus.versions[0], effective_to: '2025-01-01', version_label: 'old' },
      { ...syntheticCorpus.versions[2] },
    ],
    statements: [],
  })
  const after = await ended.getNearestClause('mas.eupg/4.7', '2026-07-01')
  assert.equal(after?.relation, 'earlier_version')
  assert.equal(after?.clause.version_label, 'old')
})

test('as-of rule: a document marked any_date reports it; others default to event_date', async () => {
  const reply = createFakeClauseProvider({
    versions: [{ ...syntheticCorpus.versions[0], document_key: 'mas.reply.20260113', as_of_rule: 'any_date' }],
    statements: [],
  })
  assert.equal(await reply.getAsOfRule('mas.reply.20260113'), 'any_date')
  assert.equal(await reply.getAsOfRule('mas.eupg'), 'event_date')
  assert.equal(await provider.getAsOfRule('mas.eupg'), 'event_date')
})

test('the provider refuses a value that is not a date', async () => {
  await assert.rejects(async () => provider.getClauseAsOf('mas.eupg/4.7', '3 March 2025'))
})

// ---------------------------------------------------------------------------------------------------------------
// A section builder written against the contract runs on every fixture
// ---------------------------------------------------------------------------------------------------------------

test('a section builder runs on every fixture with the fake provider', async () => {
  const builder: SectionBuilder = async (input: SectionInput) => {
    const onDate = input.payments[0]?.date ?? '2025-01-01'
    const clause = await input.provider.getClauseAsOf('mas.eupg/4.7', onDate)
    const events = input.facts.access_events?.value ?? []
    return {
      sectionId: 'duty_time_checks',
      lines: [{
        kind: 'comparison',
        comparison: {
          clauseKey: 'mas.eupg/4.7',
          record: events.length ? `${events.length} access events` : 'no access record',
          expected: clause ? clause.text_content : 'not held',
          outcome: events.length ? 'differs' : 'not_shown',
          evidenceIds: input.evidenceIds.access_events ?? [],
        },
      }],
      citations: clause
        ? [{ clauseKey: clause.clause_key, onDate, clauseId: clause.clause_id, textSha256: clause.text_sha256, versionId: clause.version_id, versionLabel: clause.version_label }]
        : [],
      flags: clause ? [] : [{ code: 'clause_not_held', key: 'mas.eupg/4.7', onDate }],
    }
  }
  for (const c of FIDREC_UPDATE_CASES) {
    const result = await builder({ ...c.data, provider })
    assert.equal(result.sectionId, 'duty_time_checks')
    const line = result.lines[0]
    assert.equal(line.kind, 'comparison')
    if (line.kind === 'comparison') assert.equal(line.comparison.outcome, c.shape.hasAccessRecord ? 'differs' : 'not_shown', c.id)
  }
})
