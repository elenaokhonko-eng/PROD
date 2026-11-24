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
  CLAUSE_KEYS,
  CORPUS_INSTRUMENTS,
  createFakeClauseProvider,
  DEVICE_RECOGNITION_ANSWERS,
  ENTRY_MODES,
  IP_NETWORK_FLAGS,
  RULE_CLAUSE_KEYS,
  SECTION_IDS,
  type SectionBuilder,
  type SectionInput,
  TOKEN_ACTIVATION_METHODS,
  UPDATE_FACT_KEYS,
  WALLET_PROVISIONING_AUTHENTICATIONS,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import {
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

test('section IDs follow the order of brief 4i', () => {
  const line = read(BRIEF).split('\n').find((l) => l.startsWith('Existing sections, then:'))
  assert.ok(line, 'brief 4i order line')
  const ids = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1])
  assert.deepEqual([...SECTION_IDS], ids)
  assert.ok(line.trimEnd().endsWith('arguments for each side.'))
})

test('every statement key is one the brief names, and matches the definition_statements key pattern', () => {
  const brief = read(BRIEF)
  const migration = read(CORPUS_MIGRATION)
  const pattern = '^[a-z0-9_]+(\\.[a-z0-9_]+)+$'
  assert.ok(migration.includes(`statement_key ~ '${pattern}'`))
  assert.equal(new Set(ALL_STATEMENT_KEYS).size, ALL_STATEMENT_KEYS.length)
  for (const key of ALL_STATEMENT_KEYS) {
    assert.ok(brief.includes(`\`${key}\``), `${key} is not in the brief`)
    assert.match(key, new RegExp(pattern), key)
  }
})

test('every rule clause key matches the standard_clauses key pattern and names a document the corpus knows', () => {
  const migration = read(CORPUS_MIGRATION)
  const pattern = '^[a-z0-9]+(\\.[a-z0-9_-]+)+/[a-z0-9._()~-]+$'
  assert.ok(migration.includes(`clause_key ~ '${pattern}'`))
  assert.equal(new Set(RULE_CLAUSE_KEYS).size, Object.values(CLAUSE_KEYS).flat().length)
  // Documents loaded today or named by the brief for Phase 2 and Phase 7.
  const documents = new Set(['mas.eupg', 'mas.srf', 'mas.fsm-n07', 'abs.card_code', 'visa.core_rules'])
  for (const key of RULE_CLAUSE_KEYS) {
    assert.match(key, new RegExp(pattern), key)
    assert.ok(documents.has(key.split('/')[0]), key)
  }
  for (const section of Object.keys(CLAUSE_KEYS)) assert.ok((SECTION_IDS as readonly string[]).includes(section), section)
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
