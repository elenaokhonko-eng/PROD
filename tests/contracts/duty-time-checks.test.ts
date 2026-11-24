import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { assessSrf, srfFactsFromSnapshot } from '../../supabase/functions/_shared/facts/rules/srf.ts'
import { eupgParagraphAppliesToCards } from '../../supabase/functions/_shared/facts/rules/instrument-scope.ts'
import {
  buildDutyTimeChecks,
  createDutyTimeChecks,
  DUTY_TIME_CLAUSES,
  TWELVE_HOUR_STATEMENT_KEYS,
} from '../../supabase/functions/_shared/facts/rules/duty-time-checks.ts'
import {
  CLAUSE_KEYS,
  type ComparisonLine,
  createFakeClauseProvider,
  type FakeCorpus,
  type SectionResult,
  STATEMENT_KEYS,
  TWELVE_HOUR_BLOCK_HEADINGS,
  type TwelveHourBlock,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { formatGap } from '../../supabase/functions/_shared/facts/update/section-writer.ts'
import {
  accountSrfCase,
  cardOnlyCase,
  type CaseSectionData,
  FIDREC_UPDATE_CASES,
  mixedCase,
  noTechnicalRecordsCase,
  syntheticCorpus,
} from '../fixtures/fidrec-update/index.ts'

// FIDReC standards brief v5, 4a (duty and time checks) and the Phase 4 gate's boundary tests. Synthetic data only.

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** The Step 0 corpus plus every 4a clause (in each verified EUPG version) and approved statements for the links. */
function testCorpus(): FakeCorpus {
  const corpus: FakeCorpus = structuredClone(syntheticCorpus)
  const add = (documentKey: string, clauseKey: string) => {
    for (const v of corpus.versions.filter((x) => x.document_key === documentKey && x.status === 'verified')) {
      if (v.clauses.some((c) => c.clause_key === clauseKey)) continue
      v.clauses.push({ clause_id: `t-${v.version_id}-${clauseKey}`, clause_key: clauseKey, clause_ref: clauseKey.split('/')[1], text_content: `Placeholder text of ${clauseKey}.`, text_sha256: sha(clauseKey) })
    }
  }
  for (const key of CLAUSE_KEYS.duty_time_checks) add(key.split('/')[0], key)
  add('mas.eupg', 'mas.eupg/2.1')
  const approve = (statementKey: string, clauseKeys: string[]) => {
    corpus.statements.push({
      statement_id: `t-${statementKey}`,
      statement_key: statementKey,
      revision: 1,
      framework: statementKey.startsWith('eupg') ? 'eupg' : 'srf',
      applies_to_instrument: ['account_transfer', 'ewallet'],
      text: `Placeholder statement ${statementKey}.`,
      clause_keys: clauseKeys,
      status: 'approved',
      clauses_as_of: '2025-01-01',
      approved_by: 'synthetic-reviewer',
      approved_at: '2025-01-02T00:00:00Z',
      checked_wording: corpus.versions
        .filter((v) => v.status === 'verified')
        .flatMap((v) => v.clauses.filter((c) => clauseKeys.includes(c.clause_key)).map((c) => ({ clause_key: c.clause_key, text_sha256: c.text_sha256 }))),
    })
  }
  approve('link.srf_4_2', ['mas.srf/4.2.1'])
  approve(TWELVE_HOUR_STATEMENT_KEYS.srfDefinition, ['mas.srf/2.1(high-risk-activities)', 'mas.srf/4.2.1'])
  approve(TWELVE_HOUR_STATEMENT_KEYS.eupgDefinition, ['mas.eupg/2.1(high-risk-activities)', 'mas.eupg/4.7'])
  approve(TWELVE_HOUR_STATEMENT_KEYS.eupgSection4Cards, ['mas.eupg/4.7'])
  return corpus
}

const provider = createFakeClauseProvider(testCorpus())
const run = (data: CaseSectionData, builder = buildDutyTimeChecks) => builder({ ...data, provider })
const clone = (data: CaseSectionData): CaseSectionData => structuredClone(data)
const comparisons = (r: SectionResult): ComparisonLine[] => r.lines.flatMap((l) => (l.kind === 'comparison' ? [l.comparison] : []))
const withKey = (r: SectionResult, key: string) => comparisons(r).filter((c) => c.clauseKey === key)
const statements = (r: SectionResult) => r.lines.flatMap((l) => (l.kind === 'statement' ? [l.statement] : []))
const texts = (r: SectionResult) => r.lines.flatMap((l) => (l.kind === 'text' ? [l.text] : []))
const access = (d: CaseSectionData) => d.facts.access_events!.value!

// ---------------------------------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------------------------------

test('every line carries a contract clause key or statement key; expected is the corpus text for the date', async () => {
  const allowedClauses = new Set<string>(CLAUSE_KEYS.duty_time_checks)
  const allowedStatements = new Set<string>([...STATEMENT_KEYS.link, ...STATEMENT_KEYS.srf])
  for (const c of FIDREC_UPDATE_CASES) {
    const r = await run(c.data)
    assert.equal(r.sectionId, 'duty_time_checks')
    assert.ok(r.lines.length > 0, c.id)
    for (const line of comparisons(r)) {
      assert.ok(allowedClauses.has(line.clauseKey), `${c.id}: ${line.clauseKey}`)
      assert.ok(['differs', 'matches', 'not_shown', 'not_applicable'].includes(line.outcome))
      if (line.expected) assert.match(line.expected, /^Placeholder text of /)
      for (const id of line.evidenceIds) assert.match(id, /^E\d+$/)
    }
    for (const s of statements(r)) assert.ok(allowedStatements.has(s.statementKey), `${c.id}: ${s.statementKey}`)
    // Every cited clause is pinned with its version and hash.
    for (const citation of r.citations) assert.ok(citation.textSha256.length === 64 && citation.versionId, c.id)
  }
})

test('a clause the corpus does not hold prints an empty expected side and flags the run', async () => {
  const r = await buildDutyTimeChecks({ ...accountSrfCase.data, provider: createFakeClauseProvider(syntheticCorpus) })
  const line = withKey(r, 'mas.srf/7.9')[0]
  assert.equal(line.expected, '')
  assert.ok(r.flags.some((f) => f.code === 'clause_not_held' && f.key === 'mas.srf/7.9' && f.onDate === '2025-07-03'))
  // Held clauses are pinned to the version in force on the payment date.
  const pinned = r.citations.find((c) => c.clauseKey === 'mas.eupg/4.7')
  assert.equal(pinned?.versionLabel, 'A')
})

// ---------------------------------------------------------------------------------------------------------------
// Instrument routing (4a; Phase 0b; the gate's routing test)
// ---------------------------------------------------------------------------------------------------------------

test('a card payment never gets an SRF clause, or an EUPG 4.7, 4.21, 4.25, 4.26 or Section 5 line', async () => {
  const r = await run(cardOnlyCase.data)
  const keys = new Set(comparisons(r).map((c) => c.clauseKey))
  assert.deepEqual([...keys].sort(), ['mas.eupg/4.10', 'mas.eupg/4.14'])
  for (const key of keys) assert.ok(eupgParagraphAppliesToCards(key.split('/')[1]), key)
  // No link statement and no wallet statement for card payments.
  assert.deepEqual(statements(r), [])

  const mixed = await run(mixedCase.data)
  const cardLines = comparisons(mixed).filter((c) => /\bpayment [345] of/i.test(c.record))
  assert.ok(cardLines.length > 0)
  for (const line of cardLines) assert.equal(line.clauseKey, 'mas.eupg/4.10')
  const forbidden = /^mas\.srf\/|^mas\.eupg\/(?:4\.7|4\.21|4\.25|4\.26|5\.)/
  for (const line of cardLines) assert.doesNotMatch(line.clauseKey, forbidden)
})

test('SRF clauses are cited only where assessSrf places the account payments in SRF scope', async () => {
  const inScope = await run(accountSrfCase.data)
  assert.ok(withKey(inScope, DUTY_TIME_CLAUSES.coolingOff.srf).length > 0)

  const out = clone(accountSrfCase.data)
  out.facts.credentials_or_otp_shared = { value: 'not_shared', label: 'confirmed' }
  out.facts.scam_type = { value: ['investment'], label: 'confirmed' }
  const srf = assessSrf(srfFactsFromSnapshot(out.facts as never)).portions.find((p) => p.kind === 'srf')
  assert.notEqual(srf?.assessment, 'likely_in_scope', 'precondition: outside SRF scope')
  const r = await run(out)
  assert.equal(comparisons(r).filter((c) => c.clauseKey.startsWith('mas.srf/')).length, 0)
  assert.ok(withKey(r, DUTY_TIME_CLAUSES.coolingOff.eupg).length > 0, 'the EUPG clause alone')
})

// ---------------------------------------------------------------------------------------------------------------
// Cooling-off: 11 hours 59 minutes / 12 hours; the trigger by institution type
// ---------------------------------------------------------------------------------------------------------------

function payeeAfterActivation(minutes: number): CaseSectionData {
  const d = clone(accountSrfCase.data)
  const payee = access(d).find((e) => e.kind === 'payee_added')!
  const activated = Date.parse(access(d).find((e) => e.kind === 'token_activated')!.timestamp!)
  payee.timestamp = new Date(activated + minutes * 60_000 + 8 * 3_600_000).toISOString().replace('Z', '+08:00').replace('.000', '')
  return d
}

test('gate: a high-risk activity 11 h 59 min after the token activation differs; at 12 h it is outside the period', async () => {
  const inside = withKey(await run(payeeAfterActivation(11 * 60 + 59)), DUTY_TIME_CLAUSES.coolingOff.srf)
  assert.deepEqual(inside.map((c) => c.outcome), ['differs'])
  assert.match(inside[0].record, /a payee added at 09:05 on 4 July 2025 .*, 11 hours 59 minutes after it\./)
  const atTwelve = withKey(await run(payeeAfterActivation(12 * 60)), DUTY_TIME_CLAUSES.coolingOff.srf)
  assert.deepEqual(atTwelve.map((c) => c.outcome), ['matches'])
  assert.match(atTwelve[0].record, /no payee added, transaction limit increased, notifications disabled or contact details changed in the 12 hours/)
})

test('the cooling-off record prints the time to the first disputed payment as a fact', async () => {
  const [line] = withKey(await run(accountSrfCase.data), DUTY_TIME_CLAUSES.coolingOff.eupg)
  assert.match(line.record, /The first disputed payment after it is at 21:40 on 3 July 2025, 34 minutes after it\./)
  assert.deepEqual(line.evidenceIds, ['E4'])
})

function newDeviceLoginCase(type: 'bank' | 'payment_service_provider'): CaseSectionData {
  const d = clone(accountSrfCase.data)
  d.institution = { name: 'Example Bank A', type, code: null }
  d.facts.access_events = {
    label: 'confirmed',
    value: [
      { timestamp: '2025-07-03T20:00:00+08:00', kind: 'new_device_login', deviceLabel: 'Phone model EX-900', deviceRef: 'dev-ex-0900', ip: null, channel: 'mobile app', authorisedBy: 'password and SMS one-time code', sentTo: null, tokenRef: null, relatedTransactionIndex: null },
      { timestamp: '2025-07-03T21:00:00+08:00', kind: 'payee_added', deviceLabel: 'Phone model EX-900', deviceRef: 'dev-ex-0900', ip: null, channel: 'mobile app', authorisedBy: 'SMS one-time code', sentTo: null, tokenRef: null, relatedTransactionIndex: null },
    ],
  }
  return d
}

test('gate: new_device_login starts the cooling-off and calls for an alert for a payment service provider, not for a bank', async () => {
  const bank = await run(newDeviceLoginCase('bank'))
  assert.deepEqual(withKey(bank, DUTY_TIME_CLAUSES.coolingOff.srf).map((c) => c.outcome), ['not_applicable'])
  assert.match(withKey(bank, DUTY_TIME_CLAUSES.coolingOff.srf)[0].record, /no digital token activation\./)
  assert.ok(!withKey(bank, DUTY_TIME_CLAUSES.eventAlerts.srf).some((c) => /login recorded as from a new device/.test(c.record)))

  const psp = await run(newDeviceLoginCase('payment_service_provider'))
  const cooling = withKey(psp, DUTY_TIME_CLAUSES.coolingOff.srf)
  assert.deepEqual(cooling.map((c) => c.outcome), ['differs'])
  assert.match(cooling[0].record, /login recorded as from a new device at 20:00 on 3 July 2025.*a payee added at 21:00 on 3 July 2025.*1 hour after it/)
  assert.ok(withKey(psp, DUTY_TIME_CLAUSES.eventAlerts.srf).some((c) => /login recorded as from a new device/.test(c.record) && c.outcome === 'differs'))
})

test('further-device logins on a bank account: each login with its authentication, then srf.newdevice.bank', async () => {
  const r = await run(accountSrfCase.data)
  const lines = texts(r).filter((t) => t.startsWith("The institution's record shows a login"))
  assert.equal(lines.length, 2)
  assert.match(lines[0], /21:35 on 3 July 2025 from a device labelled 'Browser on desktop EX-PC'\. The complainant states that this device is not theirs\. The record shows the login was authorised by digital token\. The record shows no alert/)
  assert.match(lines[0], /approved with the digital token activated at 21:06 on 3 July 2025\./)
  assert.match(lines[1], /'Tablet model EX-T1'\. The complainant states that they are not sure whether this device is theirs\./)
  const statement = statements(r).find((s) => s.statementKey === 'srf.newdevice.bank')
  assert.ok(statement)
  assert.equal(statement.revision, 1, 'the revision checked against the wording in force on 3 July 2025')
  // The logins themselves are not cooling-off triggers for a bank.
  assert.ok(!withKey(r, DUTY_TIME_CLAUSES.coolingOff.srf).some((c) => /EX-PC|EX-T1/.test(c.record.split('.')[0])))
})

test('further-device logins on a payment service provider account get the cooling-off and alert rows instead', async () => {
  const d = clone(accountSrfCase.data)
  d.institution = { name: 'Example Pay', type: 'payment_service_provider', code: null }
  const r = await run(d)
  assert.equal(statements(r).filter((s) => s.statementKey === 'srf.newdevice.bank').length, 0)
  const cooling = withKey(r, DUTY_TIME_CLAUSES.coolingOff.srf)
  assert.ok(cooling.some((c) => c.record.startsWith("The record shows a login at 21:35 on 3 July 2025 from a device labelled 'Browser on desktop EX-PC'")))
  assert.ok(cooling.some((c) => c.record.startsWith("The record shows a login at 07:05 on 4 July 2025 from a device labelled 'Tablet model EX-T1'")))
  const alerts = withKey(r, DUTY_TIME_CLAUSES.eventAlerts.srf)
  assert.ok(alerts.some((c) => /login at 21:35/.test(c.record) && c.outcome === 'differs'))
})

// ---------------------------------------------------------------------------------------------------------------
// "The 12 hours after the digital token was activated" (review of 24 Nov 2026, Decision 4). Replaces the wallet
// statement test: `*.highrisk.wallet` is removed, and the block prints in every case, card-only included.
// ---------------------------------------------------------------------------------------------------------------

const blocks = (r: SectionResult): TwelveHourBlock[] => r.lines.flatMap((l) => (l.kind === 'twelve_hours' ? [l.block] : []))
const kinds = (b: TwelveHourBlock, group: 'named' | 'other') => b[group].map((a) => a.source.kind)

test('Decision 4: the card-only case prints the block with the wallet line (22 minutes) and the three card payments in group 2', async () => {
  const r = await run(cardOnlyCase.data)
  assert.equal(r.lines[0].kind, 'twelve_hours', 'at the top of the section')
  const [block] = blocks(r)
  assert.equal(blocks(r).length, 1)
  assert.equal(block.trigger, 'token_activated')
  assert.equal(block.activation.at, '2025-09-12T20:10:00+08:00')
  assert.equal(block.activation.tokenRef, 'tok-ex-0102')
  assert.deepEqual(block.named, [])
  const wallet = block.other.find((a) => a.source.kind === 'wallet_provisioned')
  assert.ok(wallet)
  assert.equal(formatGap(wallet.sinceActivationMs), '22 minutes')
  assert.equal(wallet.deviceLabel, 'Phone model EX-300')
  assert.deepEqual(wallet.evidenceIds, ['E6'])
  assert.deepEqual(block.other.filter((a) => a.source.kind === 'card_payment').map((a) => a.at), [
    '2025-09-12T20:48:00+08:00',
    '2025-09-12T21:02:00+08:00',
    '2025-09-13T00:15:00+08:00',
  ])
  // The login is another activity; the alert (the institution's own message) and the block at 08:45 (outside) are not.
  assert.deepEqual(kinds(block, 'other'), ['login', 'wallet_provisioned', 'card_payment', 'card_payment', 'card_payment'])
  assert.equal(block.walletCheckPointer, true)
  // Both definitions and, for card payments, the Section 4 sentence; statements, never a comparison.
  assert.deepEqual(block.statements.map((s) => s.statementKey), ['srf.highrisk.definition', 'eupg.highrisk.definition', 'eupg.section4.cards'])
  assert.ok(block.statements.every((s) => s.text !== null))
  assert.equal(comparisons(r).filter((c) => c.clauseKey === 'mas.eupg/4.7').length, 0, 'no comparison against EUPG 4.7 for a card payment')
})

test('Decision 4: the account case prints the payee in group 1; the cooling-off rows stay as they were', async () => {
  const r = await run(accountSrfCase.data)
  const [block] = blocks(r)
  assert.equal(r.lines[0].kind, 'twelve_hours')
  assert.deepEqual(kinds(block, 'named'), ['payee_added'])
  assert.equal(formatGap(block.named[0].sinceActivationMs), '14 minutes')
  assert.ok(!kinds(block, 'other').some((k) => k === 'otp_sent' || k === 'alert_sent'))
  assert.deepEqual(block.statements.map((s) => s.statementKey), ['srf.highrisk.definition', 'eupg.highrisk.definition'])
  assert.equal(block.walletCheckPointer, false)
  assert.deepEqual(withKey(r, DUTY_TIME_CLAUSES.coolingOff.srf).map((c) => c.outcome), ['differs'])
  assert.equal(statements(r).filter((s) => s.statementKey === 'link.srf_4_2').length, 1)
})

test('Decision 4: both definitions print for an account case outside SRF scope too', async () => {
  const out = clone(accountSrfCase.data)
  out.facts.credentials_or_otp_shared = { value: 'not_shared', label: 'confirmed' }
  out.facts.scam_type = { value: ['investment'], label: 'confirmed' }
  const [block] = blocks(await run(out))
  assert.deepEqual(block.statements.map((s) => s.statementKey), ['srf.highrisk.definition', 'eupg.highrisk.definition'])
})

test('Decision 4: a case with no token activation prints no block; a new-device login starts one only for a payment service provider', async () => {
  const none = clone(accountSrfCase.data)
  none.facts.access_events!.value = access(none).filter((e) => e.kind !== 'token_activated')
  assert.equal(blocks(await run(none)).length, 0)
  assert.equal(blocks(await run(noTechnicalRecordsCase.data)).length, 0)
  assert.equal(blocks(await run(newDeviceLoginCase('bank'))).length, 0)
  const psp = blocks(await run(newDeviceLoginCase('payment_service_provider')))
  assert.equal(psp.length, 1)
  assert.equal(psp[0].trigger, 'new_device_login')
  assert.deepEqual(kinds(psp[0], 'named'), ['payee_added'])
})

test('Decision 4: an activity at exactly 12 hours is outside the block; 11 hours 59 minutes is inside', async () => {
  const inside = blocks(await run(payeeAfterActivation(11 * 60 + 59)))[0]
  assert.deepEqual(kinds(inside, 'named'), ['payee_added'])
  const atTwelve = blocks(await run(payeeAfterActivation(12 * 60)))[0]
  assert.deepEqual(kinds(atTwelve, 'named'), [])
})

test('Decision 4: no "high-risk" in the pack\'s own words, and the headings are the decided ones', async () => {
  assert.deepEqual(TWELVE_HOUR_BLOCK_HEADINGS, {
    block: 'The 12 hours after the digital token was activated',
    named: 'Activities the definitions name',
    other: 'Other activities the record shows in the 12 hours',
  })
  for (const c of FIDREC_UPDATE_CASES) {
    const r = await run(c.data)
    for (const line of r.lines) {
      const text = line.kind === 'comparison' ? line.comparison.record : line.kind === 'text' ? line.text : ''
      assert.doesNotMatch(text, /high-risk/i, `${c.id}: ${text}`)
    }
  }
})

// ---------------------------------------------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------------------------------------------

test('alerts for the token activation and high-risk activities: the record shows one, or none before the next event', async () => {
  const lines = withKey(await run(accountSrfCase.data), DUTY_TIME_CLAUSES.eventAlerts.eupg)
  assert.deepEqual(lines.map((c) => c.outcome), ['matches', 'differs'])
  assert.match(lines[0].record, /alert sent at 21:06 on 3 July 2025 to registered mobile number by sms/)
  assert.match(lines[1].record, /a payee added at 21:20.*no alert between this event and the next recorded event/)
})

test('outgoing payment alerts: threshold not known is not_shown, below it not_applicable, at it compared', async () => {
  const lines = withKey(await run(accountSrfCase.data), DUTY_TIME_CLAUSES.paymentAlerts.srf)
  assert.deepEqual(lines.map((c) => c.outcome), ['matches', 'matches', 'differs'])
  assert.match(lines[2].record, /^Payment 3 of S\$7,000 on 4 July 2025 is at or above the default threshold, S\$100\. The record shows no alert for it\.$/)

  const mixed = withKey(await run(mixedCase.data), DUTY_TIME_CLAUSES.paymentAlerts.eupg)
  assert.ok(mixed.length === 5 && mixed.every((c) => c.outcome === 'not_shown'))

  const at = clone(accountSrfCase.data)
  at.facts.transaction_alert_threshold = { label: 'confirmed', value: { amount: { amount: 7_000, currency: 'SGD', amountSgd: 7_000 }, setBy: 'account_holder' } }
  assert.equal(withKey(await run(at), DUTY_TIME_CLAUSES.paymentAlerts.srf)[2].outcome, 'differs', 'a payment equal to the threshold is compared')
  at.facts.transaction_alert_threshold.value!.amount = { amount: 7_000.01, currency: 'SGD', amountSgd: 7_000.01 }
  const below = withKey(await run(at), DUTY_TIME_CLAUSES.paymentAlerts.srf)[2]
  assert.equal(below.outcome, 'not_applicable')
  assert.match(below.record, /is below the threshold the account holder set, S\$7,000\.01\./)
})

// ---------------------------------------------------------------------------------------------------------------
// Fraud surveillance: S$49,999.99 / S$50,000; exactly 50% / over 50%; 15 / 16 June 2025; excluded payments
// ---------------------------------------------------------------------------------------------------------------

function drainCase(opts: { balance?: number; amounts?: number[]; date?: string; excluded?: number[] }): CaseSectionData {
  const d = clone(accountSrfCase.data)
  if (opts.balance !== undefined) d.facts.balance_before_first_disputed_payment = { label: 'confirmed', value: { amount: opts.balance, currency: 'SGD', amountSgd: opts.balance } }
  d.payments.forEach((p, i) => {
    if (opts.amounts) p.amount = { amount: opts.amounts[i], currency: 'SGD', amountSgd: opts.amounts[i] }
    if (opts.date) p.date = opts.date
    p.excludedFromDrainTest = Boolean(opts.excluded?.includes(i))
  })
  d.facts.transactions!.value = d.payments.map(({ index: _i, excludedFromDrainTest: _e, ...t }) => t)
  return d
}

const fraud = async (d: CaseSectionData) => withKey(await run(d), DUTY_TIME_CLAUSES.fraudSurveillance.srf)

test('gate: the fraud-surveillance condition needs a balance of S$50,000 or more (S$49,999.99 is below)', async () => {
  const below = await fraud(drainCase({ balance: 49_999.99, amounts: [12_000, 12_000, 1_000] }))
  assert.equal(below[0].outcome, 'not_applicable')
  assert.match(below[0].record, /balance of S\$49,999\.99 .* total S\$25,000 \(3 payments\), 50\.00% of that balance\./)
  const at = await fraud(drainCase({ balance: 50_000, amounts: [12_000, 12_000, 1_001] }))
  assert.equal(at[0].outcome, 'differs')
})

test('gate: exactly 50% out within 24 hours does not reach the condition; over 50% does', async () => {
  const exactly = await fraud(drainCase({ amounts: [12_000, 12_500, 3_500] }))
  assert.equal(exactly[0].outcome, 'not_applicable')
  assert.match(exactly[0].record, /S\$28,000 \(3 payments\), 50\.00% of that balance/)
  const over = await fraud(drainCase({ amounts: [12_000, 12_500, 3_500.01] }))
  assert.equal(over[0].outcome, 'differs')
  assert.match(over[0].record, /Payment 3, at 07:10 on 4 July 2025, brings the amount transferred out within 24 hours to S\$28,000\.01/)
  assert.match(over[0].record, /does not show that payment 3 or any later payment was blocked or held; it shows access blocked at 09:30 on 4 July 2025\./)
})

test('the fixture account case reaches both figures and prints balance, total and percentage', async () => {
  const [line] = await fraud(accountSrfCase.data)
  assert.equal(line.outcome, 'differs')
  assert.match(line.record, /balance of S\$56,000 immediately before the first disputed payment\. The disputed payments out of the account total S\$31,500 \(3 payments\), 56\.25% of that balance\./)
  assert.deepEqual(line.evidenceIds, ['E1', 'E4'])
})

test('a block recorded before the payment that crossed 50% is set beside it', async () => {
  const d = clone(accountSrfCase.data)
  access(d).find((e) => e.kind === 'account_blocked')!.timestamp = '2025-07-04T07:00:00+08:00'
  const [line] = await fraud(d)
  assert.equal(line.outcome, 'matches')
  assert.match(line.record, /The record shows access blocked at 07:00 on 4 July 2025\.$/)
})

test('gate: a payment on 15 June 2025 is before SRF 4.2.5 took effect; one on 16 June is compared', async () => {
  const before = await run(drainCase({ date: '2025-06-15' }))
  assert.equal(withKey(before, DUTY_TIME_CLAUSES.fraudSurveillance.srf).length, 0)
  const start = withKey(before, DUTY_TIME_CLAUSES.fraudSurveillanceStart.srf)
  assert.deepEqual(start.map((c) => [c.outcome, c.record]), [['not_applicable', 'The first disputed payment from the account is dated 15 June 2025.']])
  assert.ok(start[0].expected, 'SRF 4.4 is in force and printed')

  const on = await run(drainCase({ date: '2025-06-16' }))
  const lines = withKey(on, DUTY_TIME_CLAUSES.fraudSurveillance.srf)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].expected, 'Placeholder text of 4.2.5.', 'read from the paragraph in force from 16 June 2025')
})

test('gate: an excluded payment type is left out of the percentage', async () => {
  const counted = await fraud(drainCase({ amounts: [12_000, 12_500, 4_000] }))
  assert.equal(counted[0].outcome, 'differs')
  const excluded = await fraud(drainCase({ amounts: [12_000, 12_500, 4_000], excluded: [2] }))
  assert.equal(excluded[0].outcome, 'not_applicable')
  assert.match(excluded[0].record, /total S\$24,500 \(2 payments\), 43\.75% of that balance\. 1 payment is of a type not counted in these figures: 3\./)
})

test('EUPG 4.21 has no figures: the line prints the payments and any block, as not_shown', async () => {
  const [line] = withKey(await run(accountSrfCase.data), DUTY_TIME_CLAUSES.fraudSurveillance.eupg)
  assert.equal(line.outcome, 'not_shown')
  assert.match(line.record, /3 disputed payments from the account between 21:40 on 3 July 2025 and 07:10 on 4 July 2025\. The record shows access blocked at 09:30 on 4 July 2025\./)
})

test('the mixed case is before 16 June 2025 and below both figures', async () => {
  const r = await run(mixedCase.data)
  assert.equal(withKey(r, DUTY_TIME_CLAUSES.fraudSurveillance.srf).length, 0)
  assert.equal(withKey(r, DUTY_TIME_CLAUSES.fraudSurveillanceStart.srf)[0].outcome, 'not_applicable')
})

// ---------------------------------------------------------------------------------------------------------------
// Investigation time (21 / 22 business days), reporting time (30 / 31 days), and the other workflow rows
// ---------------------------------------------------------------------------------------------------------------

function replyCase(reported: string, replied: string): CaseSectionData {
  const d = clone(accountSrfCase.data)
  d.facts.reported_to_bank!.value!.date = reported
  d.facts.bank_reply!.value!.date = replied
  return d
}

test('gate: a final reply 21 business days after the report matches; 22 is within the complex-case period; 46 differs', async () => {
  const investigation = async (replied: string, builder = buildDutyTimeChecks) => withKey(await run(replyCase('2025-07-07', replied), builder), DUTY_TIME_CLAUSES.investigationTime.srf)[0]
  const at21 = await investigation('2025-08-05')
  assert.equal(at21.outcome, 'matches')
  assert.match(at21.record, /reported to the institution on 7 July 2025\. The institution's final reply is dated 5 August 2025, 21 business days later \(Monday to Friday, less public holidays\)\./)
  const at22 = await investigation('2025-08-06')
  assert.equal(at22.outcome, 'not_shown')
  assert.match(at22.record, /22 business days later.*do not show whether the institution treated the case as complex/)
  assert.equal((await investigation('2025-09-08')).outcome, 'not_shown', '45 business days')
  assert.equal((await investigation('2025-09-09')).outcome, 'differs', '46 business days')
  // A configured public holiday is not counted.
  const withHoliday = await investigation('2025-08-06', createDutyTimeChecks({ publicHolidays: ['2025-07-31'] }))
  assert.equal(withHoliday.outcome, 'matches')
  assert.match(withHoliday.record, /21 business days later \(Monday to Friday, less public holidays\)/)
})

test('gate: the account holder reports 30 calendar days after the first alert (matches) or 31 (differs)', async () => {
  const holder = async (reported: string) => {
    const d = clone(accountSrfCase.data)
    d.facts.reported_to_bank!.value!.date = reported
    return withKey(await run(d), DUTY_TIME_CLAUSES.holderReportingTime.srf)
  }
  const at30 = await holder('2025-08-02')
  assert.equal(at30[0].outcome, 'matches')
  assert.match(at30[0].record, /first alert sent at 21:06 on 3 July 2025\. The complainant reported to the institution on 2 August 2025, 30 calendar days later\./)
  assert.equal((await holder('2025-08-03'))[0].outcome, 'differs')
  // Supporting information: no fact records when it was given.
  assert.equal(at30[1].outcome, 'not_shown')
})

test('written outcome, information on enquiry and reporting channel read the reply, the request and the block', async () => {
  const r = await run(accountSrfCase.data)
  const written = withKey(r, DUTY_TIME_CLAUSES.writtenOutcome.eupg)[0]
  assert.equal(written.outcome, 'matches')
  assert.match(written.record, /describes the complainant's conduct as 'negligent'/)
  assert.equal(withKey(r, DUTY_TIME_CLAUSES.informationOnEnquiry.srf)[0].outcome, 'matches')
  assert.equal(withKey(r, DUTY_TIME_CLAUSES.reportingChannel.srf)[0].outcome, 'matches')

  const late = clone(accountSrfCase.data)
  late.facts.reported_to_bank!.value!.date = '2025-07-03'
  const channel = withKey(await run(late), DUTY_TIME_CLAUSES.reportingChannel.srf)[0]
  assert.equal(channel.outcome, 'differs')
  assert.match(channel.record, /1 disputed payment after the report or the block: 3\./)

  const mixed = await run(mixedCase.data)
  assert.equal(withKey(mixed, DUTY_TIME_CLAUSES.investigationTime.srf)[0].outcome, 'not_shown', 'interim reply only')
  assert.equal(withKey(mixed, DUTY_TIME_CLAUSES.informationOnEnquiry.srf)[0].outcome, 'not_applicable', 'no request made')
})

// ---------------------------------------------------------------------------------------------------------------
// Link statements in this section
// ---------------------------------------------------------------------------------------------------------------

test('after a differs line on account payments the matching link statement prints once, right after it', async () => {
  const r = await run(accountSrfCase.data)
  const keys = r.lines.map((l) => (l.kind === 'statement' ? l.statement.statementKey : l.kind === 'comparison' ? `${l.comparison.outcome}:${l.comparison.clauseKey}` : 'text'))
  assert.equal(keys.filter((k) => k === 'link.srf_4_2').length, 1)
  assert.equal(keys.filter((k) => k === 'link.eupg_s4').length, 1)
  assert.equal(keys[keys.indexOf('link.srf_4_2') - 1], 'differs:mas.srf/4.2.1')
  assert.equal(keys[keys.indexOf('link.eupg_s4') - 1], 'differs:mas.eupg/4.7')
  assert.equal(statements(r).find((s) => s.statementKey === 'link.srf_4_2')?.text, 'Placeholder statement link.srf_4_2.')
})

test('gate: a statement whose clause hash no longer matches does not print (summary under review)', async () => {
  const d = drainCase({ date: '2026-02-03' })
  const r = await run(d)
  const link = statements(r).find((s) => s.statementKey === 'link.eupg_s4')
  assert.ok(link)
  assert.equal(link.text, null)
  assert.equal(link.statementId, null)
  assert.ok(r.flags.some((f) => f.code === 'statement_under_review' && f.key === 'link.eupg_s4' && f.onDate === '2026-02-03'))
  // The same case in 2025 prints revision 1.
  assert.equal(statements(await run(accountSrfCase.data)).find((s) => s.statementKey === 'link.eupg_s4')?.revision, 1)
})

// ---------------------------------------------------------------------------------------------------------------
// No technical record; no verdict wording
// ---------------------------------------------------------------------------------------------------------------

test('gate: a case with no technical record yields not_shown throughout (except a request the complainant did not make)', async () => {
  const r = await run(noTechnicalRecordsCase.data)
  for (const line of comparisons(r)) {
    if (line.clauseKey === DUTY_TIME_CLAUSES.informationOnEnquiry.srf || line.clauseKey === DUTY_TIME_CLAUSES.informationOnEnquiry.eupg) {
      assert.equal(line.outcome, 'not_applicable')
      continue
    }
    assert.equal(line.outcome, 'not_shown', `${line.clauseKey}: ${line.record}`)
  }
  assert.equal(texts(r).length, 0)
})

/** Verdict wording (brief section 4). Words inside single quotes are the institution's own, from its letter. */
const VERDICT = /\b(?:breach(?:ed|es)?|violat\w*|fail(?:ed|s)? to|did not comply|non-?complian\w*|not compliant|liable|liability|negligen\w*|reckless\w*|grossly|at fault|wrongful\w*|unlawful\w*|should have|ought to)\b/i

test('no record or fixed line carries verdict wording', async () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const r = await run(c.data)
    for (const line of r.lines) {
      const text = line.kind === 'comparison' ? line.comparison.record : line.kind === 'text' ? line.text : ''
      assert.doesNotMatch(text.replace(/'[^']*'/g, "''"), VERDICT, `${c.id}: ${text}`)
    }
  }
  assert.match('The bank was negligent', VERDICT, 'the pattern rejects verdict wording')
  assert.match('The institution failed to block', VERDICT)
  assert.match('a breach of the duty', VERDICT)
})

// ---------------------------------------------------------------------------------------------------------------
// Review of 24 Nov 2026: EUPG 4.21 before 16 June 2025 (Lane 3 issue 3), public holidays (Decision 11), pronouns
// (Decision 2)
// ---------------------------------------------------------------------------------------------------------------

test('EUPG 4.21 before 16 June 2025 prints the date line the SRF row prints, with the paragraph from its start', async () => {
  for (const date of ['2025-06-15', '2025-05-20']) {
    const d = drainCase({ date })
    const [eupg] = withKey(await run(d), DUTY_TIME_CLAUSES.fraudSurveillance.eupg)
    assert.equal(eupg.outcome, 'not_applicable')
    assert.equal(eupg.record, `The first disputed payment from the account is dated ${date === '2025-06-15' ? '15 June 2025' : '20 May 2025'}.`)
    assert.equal(eupg.expected, 'Placeholder text of mas.eupg/4.21.', 'not an empty Expected')
  }
  const r = await run(drainCase({ date: '2025-06-15' }))
  assert.ok(!r.flags.some((f) => f.key === DUTY_TIME_CLAUSES.fraudSurveillance.eupg && f.code === 'clause_not_held'))
  const [mixed] = withKey(await run(mixedCase.data), DUTY_TIME_CLAUSES.fraudSurveillance.eupg)
  assert.equal(mixed.outcome, 'not_applicable')
  const [on] = withKey(await run(drainCase({ date: '2025-06-16' })), DUTY_TIME_CLAUSES.fraudSurveillance.eupg)
  assert.equal(on.outcome, 'not_shown', 'from 16 June 2025 the row reads the record as before')
})

test('Decision 11: Singapore public holidays are left out of the business-day count, and the line says so', async () => {
  const investigation = async (reported: string, replied: string) => withKey(await run(replyCase(reported, replied)), DUTY_TIME_CLAUSES.investigationTime.srf)[0]
  // Deepavali, Monday 20 October 2025: report on Friday 17 October, reply on Monday 17 November is 20 business days.
  const deepavali = await investigation('2025-10-17', '2025-11-17')
  assert.match(deepavali.record, /20 business days later \(Monday to Friday, less public holidays\)\./)
  // Outside the years the list holds (2023), no holiday is deducted and the line says so.
  const old = await investigation('2023-10-02', '2023-10-31')
  assert.match(old.record, /21 business days later \(Monday to Friday; public holidays not deducted\)\./)
})

test('Decision 2: no line uses she, her or hers', async () => {
  const GENDERED = /\b(she|her|hers|herself|he|him|his|himself)\b/i
  for (const c of FIDREC_UPDATE_CASES) {
    const r = await run(c.data)
    for (const line of r.lines) {
      const text = line.kind === 'comparison' ? line.comparison.record : line.kind === 'text' ? line.text : ''
      assert.doesNotMatch(text.replace(/'[^']*'/g, "''"), GENDERED, `${c.id}: ${text}`)
    }
  }
})
