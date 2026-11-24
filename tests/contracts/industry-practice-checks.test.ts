import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  activationRequest,
  buildIndustryPracticeChecks,
  createIndustryPracticeChecks,
  hoursStatedIn,
  INDUSTRY_PRACTICE_CLAUSE_KEYS,
  WALLET_CHECK_HEADING,
  WALLET_DEFINITIONS_POINTER,
  type WalletProvisioningRequestRow,
  walletPracticeFromRow,
  walletPracticeRows,
} from '../../supabase/functions/_shared/facts/rules/industry-practice-checks.ts'
import { createStaticTermRequestSource } from '../../supabase/functions/_shared/facts/rules/institution-terms.ts'
import {
  type ComparisonLine,
  createFakeClauseProvider,
  type FakeCorpus,
  NAMED_CLAUSE_KEYS,
  type QuotationLine,
  type SectionResult,
  type StatementLine,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { GENDERED_PRONOUNS } from '../../supabase/functions/_shared/facts/update/section-writer.ts'
import {
  accountSrfCase,
  cardOnlyCase,
  type CaseSectionData,
  FIDREC_UPDATE_CASES,
  mixedCase,
  noTechnicalRecordsCase,
  syntheticCorpus,
} from '../fixtures/fidrec-update/index.ts'

// FIDReC standards brief v5, 4c (industry practice): dated announced measures, each used only from its stated start
// date; and the wallet check (review of 24 Nov 2026, Decision 5). The 2022 MAS-ABS releases are not loaded, so their
// keys here are synthetic; the ABS media statement keys are the contract's. Synthetic data only.

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const KEYS = {
  tokenActivationDelay: 'mas.media_2022_01_digital_banking/3(c)',
  walletProvisioningVerification: NAMED_CLAUSE_KEYS.absProvisioningVerification,
  walletTokenRemoval: NAMED_CLAUSE_KEYS.absProvisioningRemoval,
}
const UOB_PAGE_KEY = 'uob.wallet_provisioning/token-cooling-off'
const REPLY_KEY = 'mas.reply.20260113/wallet'
const REPLY_TEXT = 'Placeholder text of the two sentences of the reply.'
const GENERATED_ON = '2026-11-24'

function testCorpus(): FakeCorpus {
  const corpus: FakeCorpus = structuredClone(syntheticCorpus)
  const document = (
    documentKey: string,
    from: string,
    clauses: Array<[string, string]>,
    extra: Partial<FakeCorpus['versions'][number]> = {},
  ) =>
    corpus.versions.push({
      version_id: `t-${documentKey}`,
      document_key: documentKey,
      title: `Synthetic ${documentKey}`,
      publisher: 'Synthetic publisher',
      binding_level: 'announcement',
      institution: null,
      card_scheme: null,
      document_instrument_scope: ['account_transfer', 'sg_card', 'ewallet'],
      version_label: from,
      effective_from: from,
      effective_to: null,
      status: 'verified',
      source_url: `https://example.com/${documentKey}.pdf`,
      coverage: 'full',
      clauses: clauses.map(([k, text]) => ({ clause_id: `t-${k}`, clause_key: k, clause_ref: k.split('/')[1], text_content: text, text_sha256: sha(text) })),
      ...extra,
    })
  // The delay clause states its own figure; the code reads it from the text (review of 24 Nov 2026, Lane 3 issue 2).
  document('mas.media_2022_01_digital_banking', '2022-01-19', [
    [KEYS.tokenActivationDelay, 'Placeholder text of the delay measure: a delay of at least 12 hours before a new token is activated.'],
    ['mas.media_2022_01_digital_banking/3(d)', 'Placeholder text of the contact-change notification measure.'],
  ])
  document('abs.media_2025_02_card_provisioning', '2025-02-17', [
    [KEYS.walletProvisioningVerification, `Placeholder text of ${KEYS.walletProvisioningVerification}.`],
    [KEYS.walletTokenRemoval, `Placeholder text of ${KEYS.walletTokenRemoval}.`],
  ])
  document('mas.reply.20260113', '2026-01-13', [[REPLY_KEY, REPLY_TEXT]], { as_of_rule: 'any_date' })
  document('uob.wallet_provisioning', '2025-06-01', [[UOB_PAGE_KEY, 'Placeholder text of the synthetic UOB-coded page.']], { institution: 'uob', binding_level: 'published_page' })
  const approve = (statementKey: string, clauseKey: string, text: string) =>
    corpus.statements.push({
      statement_id: `t-${statementKey}`,
      statement_key: statementKey,
      revision: 1,
      framework: 'mas_reply',
      applies_to_instrument: ['sg_card'],
      text: `Placeholder statement ${statementKey}.`,
      clause_keys: [clauseKey],
      status: 'approved',
      clauses_as_of: '2025-01-01',
      approved_by: 'synthetic-reviewer',
      approved_at: '2025-01-02T00:00:00Z',
      checked_wording: [{ clause_key: clauseKey, text_sha256: sha(text) }],
    })
  approve('mas.reply.20260113.wallet', REPLY_KEY, REPLY_TEXT)
  approve('bridge.card_loss_sharing', KEYS.walletProvisioningVerification, `Placeholder text of ${KEYS.walletProvisioningVerification}.`)
  return corpus
}

const UOB_ROW: WalletProvisioningRequestRow = {
  institution: 'uob',
  product: 'credit_card',
  purpose: 'wallet_provisioning',
  document_key: 'uob.wallet_provisioning',
  selector: { clause_keys: [UOB_PAGE_KEY] },
  quote_mode: 'quote',
  term_outcome: null,
  term: null,
  confirmed_by: 'synthetic-reviewer',
  confirmed_at: '2026-11-24T00:00:00Z',
  wallet_waiting_period_stated: true,
  wallet_waiting_period_hours: '12',
  wallet_authentication_required: 'digital_token',
  wallet_applies_from: '2025-07-01',
}

const provider = createFakeClauseProvider(testCorpus())
const withKeys = createIndustryPracticeChecks({ clauseKeys: KEYS })
const withUobPage = createIndustryPracticeChecks({ clauseKeys: KEYS, termRequests: createStaticTermRequestSource([UOB_ROW]) })
const run = (data: CaseSectionData, builder = withKeys) => builder({ ...data, provider, generatedOn: GENERATED_ON })
const clone = (data: CaseSectionData): CaseSectionData => structuredClone(data)
const comparisons = (r: SectionResult): ComparisonLine[] => r.lines.flatMap((l) => (l.kind === 'comparison' ? [l.comparison] : []))
const withKey = (r: SectionResult, key: string) => comparisons(r).filter((c) => c.clauseKey === key)
const statements = (r: SectionResult): StatementLine[] => r.lines.flatMap((l) => (l.kind === 'statement' ? [l.statement] : []))
const quotations = (r: SectionResult): QuotationLine[] => r.lines.flatMap((l) => (l.kind === 'quotation' ? [l.quotation] : []))
const texts = (r: SectionResult) => r.lines.flatMap((l) => (l.kind === 'text' ? [l.text] : []))

/** The synthetic card-only case as a case against a UOB-coded institution. */
function uobCase(): CaseSectionData {
  const d = clone(cardOnlyCase.data)
  d.institution = { name: 'Example UOB-coded Bank', type: 'bank', code: 'uob' }
  return d
}

// Changed with Elena's decision of 24 Nov 2026: the token-activation alert row is dropped from this section (EUPG 4.9
// and SRF 4.2.2 cover it in duty_time_checks; 3(d) of the January 2022 release is about contact-detail changes).
test('the default keys: the delay is 3(c) of the 19 January 2022 release; there is no alert row and nothing is flagged as waiting', async () => {
  assert.deepEqual(INDUSTRY_PRACTICE_CLAUSE_KEYS, {
    tokenActivationDelay: 'mas.media_2022_01_digital_banking/3(c)',
    walletProvisioningVerification: 'abs.media_2025_02_card_provisioning/para4.verification',
    walletTokenRemoval: 'abs.media_2025_02_card_provisioning/para4.removal',
  })
  const r = await run(cardOnlyCase.data, createIndustryPracticeChecks())
  assert.equal(r.sectionId, 'industry_practice_comparison')
  assert.deepEqual(comparisons(r).map((c) => c.clauseKey), [KEYS.tokenActivationDelay, KEYS.walletProvisioningVerification, KEYS.walletTokenRemoval])
  assert.equal(r.flags.filter((f) => f.key.startsWith('industry_practice.')).length, 0)
})

test('token activation: the time from the request to the activation; no alert row and no 3(d) row', async () => {
  const r = await run(accountSrfCase.data)
  const [delay] = withKey(r, KEYS.tokenActivationDelay)
  assert.equal(delay.outcome, 'differs')
  assert.equal(delay.record, "The record shows a one-time code sent at 21:05 on 3 July 2025 and a digital token activated at 21:06 on 3 July 2025 on a device labelled 'Phone model EX-200', 1 minute later.")
  assert.match(delay.expected, /a delay of at least 12 hours/)
  assert.ok(r.citations.some((c) => c.clauseKey === KEYS.tokenActivationDelay && c.onDate === '2025-07-03'))
  for (const c of FIDREC_UPDATE_CASES) {
    const lines = comparisons(await run(c.data))
    assert.ok(!lines.some((l) => l.clauseKey === 'mas.media_2022_01_digital_banking/3(d)'), c.id)
    assert.ok(!lines.some((l) => /and an alert sent at|and no alert between it/.test(l.record)), c.id)
  }
})

test('boundary: an activation 12 h after the request matches; 11 h 59 min differs (the figure read from the clause)', async () => {
  const shifted = (minutes: number) => {
    const d = clone(accountSrfCase.data)
    const otp = d.facts.access_events!.value!.find((e) => e.kind === 'otp_sent')!
    otp.timestamp = new Date(Date.parse('2025-07-03T21:06:00+08:00') - minutes * 60_000 + 8 * 3_600_000).toISOString().replace('.000Z', '+08:00')
    return d
  }
  assert.equal(withKey(await run(shifted(12 * 60)), KEYS.tokenActivationDelay)[0].outcome, 'matches')
  assert.equal(withKey(await run(shifted(11 * 60 + 59)), KEYS.tokenActivationDelay)[0].outcome, 'differs')
})

test('the delay is never written in code: a clause stating no single figure prints no delay line and is flagged', async () => {
  assert.equal(hoursStatedIn('a delay of 12 hours'), 12)
  assert.equal(hoursStatedIn('a 12-hour delay'), 12)
  assert.equal(hoursStatedIn('no figure'), null)
  assert.equal(hoursStatedIn('12 hours, or 24 hours for some'), null)
  const corpus = testCorpus()
  corpus.versions.find((v) => v.document_key === 'mas.media_2022_01_digital_banking')!.clauses[0].text_content = 'Placeholder text with no figure.'
  const r = await withKeys({ ...accountSrfCase.data, provider: createFakeClauseProvider(corpus) })
  assert.equal(withKey(r, KEYS.tokenActivationDelay).length, 0)
  assert.ok(r.flags.some((f) => f.code === 'clause_not_held' && f.key === KEYS.tokenActivationDelay))
})

test('an activation with no request in the record is not_shown', async () => {
  const [delay] = withKey(await run(cardOnlyCase.data), KEYS.tokenActivationDelay)
  assert.equal(delay.outcome, 'not_shown')
  assert.match(delay.record, /It does not show when the activation was requested\.$/)
  const token = cardOnlyCase.data.facts.access_events!.value![0]
  assert.equal(activationRequest(token, cardOnlyCase.data.facts.access_events!.value!), null)
})

test('wallet provisioning: digital token or in-app matches; SMS code before August 2025 is not_applicable with the date', async () => {
  const card = await run(cardOnlyCase.data)
  const [verified] = withKey(card, KEYS.walletProvisioningVerification)
  assert.equal(verified.outcome, 'matches')
  assert.equal(verified.record, "The record shows the card added to a mobile wallet at 20:32 on 12 September 2025 on a device labelled 'Phone model EX-300', verified by the digital token.")
  assert.deepEqual(verified.evidenceIds, ['E6'])

  const mixed = await run(mixedCase.data)
  const [sms] = withKey(mixed, KEYS.walletProvisioningVerification)
  assert.equal(sms.outcome, 'not_applicable')
  assert.match(sms.record, /verified by an SMS one-time code, sent to registered mobile number\. The card was added on 20 May 2025\.$/)
})

test('boundary: SMS-code provisioning on 31 July 2025 is not_applicable; on 1 August 2025 it differs', async () => {
  const smsOn = async (date: string) => {
    const d = clone(cardOnlyCase.data)
    const wallet = d.facts.card_auth_events!.value![0]
    wallet.walletProvisionedAt = `${date}T20:32:00+08:00`
    wallet.walletProvisioningAuthentication = 'sms_otp'
    return withKey(await run(d), KEYS.walletProvisioningVerification)[0].outcome
  }
  assert.equal(await smsOn('2025-07-31'), 'not_applicable')
  assert.equal(await smsOn('2025-08-01'), 'differs')
})

test('a measure not yet in force on the event date prints no line', async () => {
  const d = clone(cardOnlyCase.data)
  d.facts.card_auth_events!.value![0].walletProvisionedAt = '2025-02-16T20:32:00+08:00'
  const r = await run(d)
  assert.equal(withKey(r, KEYS.walletProvisioningVerification).length, 0)
  assert.equal(withKey(r, KEYS.walletTokenRemoval).length, 0)
  d.facts.card_auth_events!.value![0].walletProvisionedAt = '2025-02-17T20:32:00+08:00'
  assert.equal(withKey(await run(d), KEYS.walletProvisioningVerification).length, 1)
})

test('removal of a provisioned card: recorded removal matches; none recorded is not_shown', async () => {
  const [removed] = withKey(await run(cardOnlyCase.data), KEYS.walletTokenRemoval)
  assert.equal(removed.outcome, 'matches')
  assert.match(removed.record, /The complainant reported to the institution on 13 September 2025\. The record shows the card removed from the wallet at 09:00 on 13 September 2025\.$/)
  const [kept] = withKey(await run(mixedCase.data), KEYS.walletTokenRemoval)
  assert.equal(kept.outcome, 'not_shown')
})

test('no technical record: token lines are not_shown and no wallet line prints for an e-wallet case', async () => {
  const r = await run(noTechnicalRecordsCase.data)
  const lines = comparisons(r)
  assert.deepEqual(lines.map((c) => [c.clauseKey, c.outcome]), [[KEYS.tokenActivationDelay, 'not_shown']])
  const cardNoRecord = clone(cardOnlyCase.data)
  delete cardNoRecord.facts.card_auth_events
  delete cardNoRecord.facts.access_events
  assert.ok(comparisons(await run(cardNoRecord)).every((c) => c.outcome === 'not_shown'))
})

// ---------------------------------------------------------------------------------------------------------------
// The wallet check (Decision 5)
// ---------------------------------------------------------------------------------------------------------------

test('Decision 5: the record line, once above the group, with both times and the gap', async () => {
  const r = await run(cardOnlyCase.data)
  const t = texts(r)
  const heading = t.indexOf(WALLET_CHECK_HEADING)
  assert.ok(heading >= 0)
  assert.equal(
    t[heading + 1],
    "The record shows the card ending 0001 added to a mobile wallet at 20:32 on 12 September 2025 on a device labelled 'Phone model EX-300', authorised by the digital token (E6). The record shows a digital token activated at 20:10 on 12 September 2025 on a device labelled 'Phone model EX-300' (E4), 22 minutes before.",
  )
  assert.equal(t.filter((x) => x.startsWith('The record shows the card ending')).length, 1)
  // Without a token activation the second sentence is left out.
  const noToken = clone(cardOnlyCase.data)
  noToken.facts.access_events!.value = noToken.facts.access_events!.value!.filter((e) => e.kind !== 'token_activated')
  const line = texts(await run(noToken)).find((x) => x.startsWith('The record shows the card ending'))!
  assert.doesNotMatch(line, /digital token activated/)
})

test('Decision 5, Part A: a UOB-coded case with the card added 22 minutes after the token activation differs, with both times', async () => {
  const r = await run(uobCase(), withUobPage)
  const [waiting, auth] = withKey(r, UOB_PAGE_KEY)
  assert.equal(waiting.outcome, 'differs')
  assert.match(waiting.record, /digital token activated at 20:10 on 12 September 2025 and the card added to a mobile wallet at 20:32 on 12 September 2025, 22 minutes later\./)
  assert.equal(waiting.expected, 'Placeholder text of the synthetic UOB-coded page.')
  assert.equal(auth.outcome, 'matches', 'digital token, as the page requires')
  assert.ok(r.citations.some((c) => c.clauseKey === UOB_PAGE_KEY && c.onDate === '2025-09-12'))
  assert.ok(!texts(r).some((x) => /published practice .* is not held/.test(x)))
  // No link statement follows Part A.
  assert.ok(!statements(r).some((s) => s.statementKey.startsWith('link.') || s.statementKey === 'bridge.mas_requirement'))
})

test('Decision 5, Part A: the practice is read from the columns of migration 20261204120100', () => {
  assert.deepEqual(walletPracticeFromRow(UOB_ROW), { waitingPeriodHours: 12, authenticationRequired: 'digital_token', appliesFrom: '2025-07-01' })
  assert.deepEqual(
    walletPracticeFromRow({ ...UOB_ROW, wallet_waiting_period_stated: false, wallet_waiting_period_hours: null, wallet_authentication_required: 'none_stated', wallet_applies_from: null }),
    { waitingPeriodHours: 'none_stated', authenticationRequired: 'none_stated', appliesFrom: null },
  )
  // Not yet recorded by a person: no practice, so no Part A row.
  assert.equal(walletPracticeFromRow({ ...UOB_ROW, wallet_waiting_period_stated: null }), null)
  assert.equal(walletPracticeFromRow({ ...UOB_ROW, wallet_authentication_required: null }), null)
})

test('Decision 5, Part A: outcomes chosen by code', () => {
  const wallet = cardOnlyCase.data.facts.card_auth_events!.value![0]
  const activation = cardOnlyCase.data.facts.access_events!.value![0]
  const practice = { waitingPeriodHours: 12, authenticationRequired: 'digital_token' as const, appliesFrom: null }
  // Added after the waiting period: matches.
  const late = { ...wallet, walletProvisionedAt: '2025-09-13T08:10:00+08:00' }
  assert.equal(walletPracticeRows(practice, late, activation)[0].outcome, 'matches')
  // Another method on or after the stated date: differs.
  const sms = { ...late, walletProvisioningAuthentication: 'sms_otp' as const }
  assert.equal(walletPracticeRows(practice, sms, activation)[1].outcome, 'differs')
  // Time or method not shown: not_shown.
  assert.deepEqual(walletPracticeRows(practice, { ...wallet, walletProvisioningAuthentication: null }, null).map((x) => x.outcome), ['not_shown', 'not_shown'])
  // Before the page's stated start date: not_applicable, printing both dates.
  const [before] = walletPracticeRows({ ...practice, appliesFrom: '2025-10-01' }, wallet, activation)
  assert.equal(before.outcome, 'not_applicable')
  assert.match(before.record, /12 September 2025.*1 October 2025/)
  // A method the person could not identify on the page: no authentication row.
  assert.equal(walletPracticeRows({ ...practice, authenticationRequired: 'not_known' }, wallet, activation).length, 1)
  // Nothing stated: no row.
  assert.deepEqual(walletPracticeRows({ waitingPeriodHours: 'none_stated', authenticationRequired: 'none_stated', appliesFrom: null }, wallet, activation), [])
})

test('Decision 5: no page held prints "not held" and still prints Parts B and C; another institution\'s page is never used', async () => {
  // A case against another institution, with UOB's request configured: UOB's page is not set against it.
  const r = await run(cardOnlyCase.data, withUobPage)
  assert.ok(texts(r).includes("Example Bank A's published practice on adding cards to mobile wallets is not held."))
  assert.equal(withKey(r, UOB_PAGE_KEY).length, 0)
  assert.ok(quotations(r).some((q) => q.intro?.statementKey === 'mas.reply.20260113.wallet' && q.intro.text !== null), 'Part B')
  assert.equal(withKey(r, KEYS.walletProvisioningVerification).length, 1, 'Part C')
  assert.equal(withKey(r, KEYS.walletTokenRemoval).length, 1, 'Part C')
  // Part D: the pointer and the card loss-sharing statement.
  assert.ok(texts(r).includes(WALLET_DEFINITIONS_POINTER))
  assert.ok(statements(r).some((s) => s.statementKey === 'bridge.card_loss_sharing'))
})

test('Decision 5, Part B: a 2025 event prints the reply of 13 January 2026 as a quotation, with the after-the-events date (Decision 6)', async () => {
  const r = await run(cardOnlyCase.data)
  const [reply] = quotations(r)
  assert.equal(quotations(r).length, 1)
  assert.equal(reply.documentKey, 'mas.reply.20260113')
  assert.equal(reply.documentDate, '2026-01-13')
  assert.equal(reply.readOn, GENERATED_ON, 'read as of the day the pack is generated')
  assert.equal(reply.intro?.statementKey, 'mas.reply.20260113.wallet')
  assert.equal(reply.intro?.text, 'Placeholder statement mas.reply.20260113.wallet.')
  assert.deepEqual(reply.passages.map((x) => [x.clauseKey, x.text]), [[REPLY_KEY, REPLY_TEXT]], 'the words of the reply, from the provider')
  assert.equal(reply.documentDatedAfterEvents, '2026-01-13')
  assert.deepEqual(reply.evidenceIds, ['E6'])
  // An event after the reply: no after-the-events date.
  const later = clone(cardOnlyCase.data)
  later.payments.forEach((p) => (p.date = '2026-03-02'))
  later.facts.card_auth_events!.value![0].walletProvisionedAt = '2026-03-02T20:32:00+08:00'
  later.facts.reported_to_bank!.value!.date = '2026-03-03'
  assert.equal(quotations(await run(later))[0].documentDatedAfterEvents, null)
  // With no approved statement naming the reply's clauses, the statement prints by key as under review.
  const bare = await withKeys({ ...cardOnlyCase.data, provider: createFakeClauseProvider(syntheticCorpus) })
  assert.equal(quotations(bare).length, 0)
  const underReview = statements(bare).find((x) => x.statementKey === 'mas.reply.20260113.wallet')
  assert.ok(underReview && underReview.text === null)
})

test('the wallet group prints only where the record shows a card added to a wallet', async () => {
  const d = clone(cardOnlyCase.data)
  d.facts.card_auth_events!.value = d.facts.card_auth_events!.value!.filter((e) => !e.walletProvisionedAt)
  const r = await run(d)
  assert.ok(!texts(r).includes(WALLET_CHECK_HEADING))
  assert.equal(statements(r).length, 0)
  assert.equal(quotations(r).length, 0)
})

// Changed with Decision 5: the wallet check prints the MAS reply (Part B) and the card loss-sharing pointer (Part D) as
// statements. Still no link statement.
test('no link statement follows an industry-practice line, and no record carries verdict wording or a gendered pronoun', async () => {
  const VERDICT = /\b(?:breach(?:ed|es)?|violat\w*|fail(?:ed|s)? to|did not comply|non-?complian\w*|liable|liability|negligen\w*|reckless\w*|grossly)\b/i
  for (const c of FIDREC_UPDATE_CASES) {
    const r = await run(c.data, withUobPage)
    for (const s of statements(r)) assert.ok(['bridge.card_loss_sharing'].includes(s.statementKey), `${c.id}: ${s.statementKey}`)
    for (const line of comparisons(r)) assert.doesNotMatch(line.record, VERDICT, `${c.id}: ${line.record}`)
    for (const text of [...texts(r), ...comparisons(r).map((l) => l.record)]) assert.doesNotMatch(text.replace(/'[^']*'/g, "''"), GENDERED_PRONOUNS, `${c.id}: ${text}`)
  }
})
