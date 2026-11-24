import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  activationRequest,
  buildIndustryPracticeChecks,
  createIndustryPracticeChecks,
  INDUSTRY_PRACTICE_CLAUSE_KEYS,
} from '../../supabase/functions/_shared/facts/rules/industry-practice-checks.ts'
import {
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

// FIDReC standards brief v5, 4c (industry practice): dated announced measures, each used only from its stated start
// date. The release clause keys are located at ingestion; these tests use synthetic keys. Synthetic data only.

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const KEYS = {
  tokenActivationDelay: 'mas.abs_release_20220119/delay',
  tokenActivationAlert: 'mas.abs_release_20220119/alert',
  walletProvisioningVerification: 'abs.release_20250217/verification',
  walletTokenRemoval: 'abs.release_20250217/removal',
}

function testCorpus(): FakeCorpus {
  const corpus: FakeCorpus = structuredClone(syntheticCorpus)
  const release = (documentKey: string, from: string, clauseKeys: string[]) =>
    corpus.versions.push({
      version_id: `t-${documentKey}`,
      document_key: documentKey,
      title: `Synthetic ${documentKey}`,
      publisher: 'Synthetic association',
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
      clauses: clauseKeys.map((k) => ({ clause_id: `t-${k}`, clause_key: k, clause_ref: k.split('/')[1], text_content: `Placeholder text of ${k}.`, text_sha256: sha(k) })),
    })
  release('mas.abs_release_20220119', '2022-01-19', [KEYS.tokenActivationDelay, KEYS.tokenActivationAlert])
  release('abs.release_20250217', '2025-02-17', [KEYS.walletProvisioningVerification, KEYS.walletTokenRemoval])
  return corpus
}

const provider = createFakeClauseProvider(testCorpus())
const withKeys = createIndustryPracticeChecks({ clauseKeys: KEYS })
const run = (data: CaseSectionData, builder = withKeys) => builder({ ...data, provider })
const clone = (data: CaseSectionData): CaseSectionData => structuredClone(data)
const comparisons = (r: SectionResult): ComparisonLine[] => r.lines.flatMap((l) => (l.kind === 'comparison' ? [l.comparison] : []))
const withKey = (r: SectionResult, key: string) => comparisons(r).filter((c) => c.clauseKey === key)

test('until the releases are keyed the section prints no line and flags each waiting check', async () => {
  assert.deepEqual(Object.values(INDUSTRY_PRACTICE_CLAUSE_KEYS), [null, null, null, null])
  const r = await run(cardOnlyCase.data, buildIndustryPracticeChecks)
  assert.equal(r.sectionId, 'industry_practice_comparison')
  assert.equal(r.lines.length, 0)
  assert.deepEqual([...new Set(r.flags.map((f) => f.key))].sort(), [
    'industry_practice.tokenActivationAlert',
    'industry_practice.tokenActivationDelay',
    'industry_practice.walletProvisioningVerification',
    'industry_practice.walletTokenRemoval',
  ])
  assert.ok(r.flags.every((f) => f.code === 'clause_not_held'))
})

test('token activation: the time from the request to the activation, and the alert to the existing contact', async () => {
  const r = await run(accountSrfCase.data)
  const [delay] = withKey(r, KEYS.tokenActivationDelay)
  assert.equal(delay.outcome, 'differs')
  assert.equal(delay.record, "The record shows a one-time code sent at 21:05 on 3 Jul 2025 and a digital token activated at 21:06 on 3 Jul 2025 on a device labelled 'Phone model EX-200', 0 h 1 min later.")
  assert.equal(delay.expected, `Placeholder text of ${KEYS.tokenActivationDelay}.`)
  const [alert] = withKey(r, KEYS.tokenActivationAlert)
  assert.equal(alert.outcome, 'matches')
  assert.match(alert.record, /an alert sent at 21:06 on 3 Jul 2025 to registered mobile number\.$/)
  assert.ok(r.citations.some((c) => c.clauseKey === KEYS.tokenActivationDelay && c.onDate === '2025-07-03'))
})

test('boundary: an activation 12 h after the request matches; 11 h 59 min differs', async () => {
  const shifted = (minutes: number) => {
    const d = clone(accountSrfCase.data)
    const otp = d.facts.access_events!.value!.find((e) => e.kind === 'otp_sent')!
    otp.timestamp = new Date(Date.parse('2025-07-03T21:06:00+08:00') - minutes * 60_000 + 8 * 3_600_000).toISOString().replace('.000Z', '+08:00')
    return d
  }
  assert.equal(withKey(await run(shifted(12 * 60)), KEYS.tokenActivationDelay)[0].outcome, 'matches')
  assert.equal(withKey(await run(shifted(11 * 60 + 59)), KEYS.tokenActivationDelay)[0].outcome, 'differs')
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
  assert.equal(verified.record, "The record shows the card added to a mobile wallet at 20:32 on 12 Sep 2025 on a device labelled 'Phone model EX-300', verified by the digital token.")
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
  assert.match(removed.record, /The complainant reported to the institution on 13 Sep 2025\. The record shows the card removed from the wallet at 09:00 on 13 Sep 2025\.$/)
  const [kept] = withKey(await run(mixedCase.data), KEYS.walletTokenRemoval)
  assert.equal(kept.outcome, 'not_shown')
})

test('no technical record: token lines are not_shown and no wallet line prints for an e-wallet case', async () => {
  const r = await run(noTechnicalRecordsCase.data)
  const lines = comparisons(r)
  assert.deepEqual(lines.map((c) => [c.clauseKey, c.outcome]), [[KEYS.tokenActivationDelay, 'not_shown'], [KEYS.tokenActivationAlert, 'not_shown']])
  const cardNoRecord = clone(cardOnlyCase.data)
  delete cardNoRecord.facts.card_auth_events
  delete cardNoRecord.facts.access_events
  assert.ok(comparisons(await run(cardNoRecord)).every((c) => c.outcome === 'not_shown'))
})

test('no link statement follows an industry-practice line, and no record carries verdict wording', async () => {
  const VERDICT = /\b(?:breach(?:ed|es)?|violat\w*|fail(?:ed|s)? to|did not comply|non-?complian\w*|liable|liability|negligen\w*|reckless\w*|grossly)\b/i
  for (const c of FIDREC_UPDATE_CASES) {
    const r = await run(c.data)
    assert.equal(r.lines.filter((l) => l.kind === 'statement').length, 0, c.id)
    for (const line of comparisons(r)) assert.doesNotMatch(line.record, VERDICT, `${c.id}: ${line.record}`)
  }
})
