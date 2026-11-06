import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assessSrf,
  buildSnapshot,
  FACT_ENUM_OPTIONS,
  type CurrentFinding,
  type FactCandidate,
  formatFactValue,
  institutionsIn,
  MULTI_SELECT_FACT_KEYS,
  normaliseInstitution,
  parseFactExtraction,
  reconcile,
  validateFactValue,
} from '../../lib/facts'

// Stage 1 demo review, 6 Nov 2026 (findings A1-A7). All text below is synthetic.

const story = (factKey: FactCandidate['factKey'], value: unknown): FactCandidate =>
  ({ factKey, value, sourceType: 'story', sourceRef: { kind: 'story' } }) as FactCandidate
const answer = (factKey: FactCandidate['factKey'], value: unknown): FactCandidate =>
  ({ factKey, value, sourceType: 'answer', sourceRef: { kind: 'answer' } }) as FactCandidate
const yes = (reference: string | null = null, date: string | null = null) => ({ value: 'yes', date, reference, channel: null })

test('A2: the police, regulators and reference numbers are never banks or payment providers', () => {
  assert.equal(normaliseInstitution('Singapore Police Force'), null)
  assert.equal(normaliseInstitution('123456789'), null)
  assert.equal(normaliseInstitution('Monetary Authority of Singapore'), null)
  assert.deepEqual(institutionsIn('Synthetic Bank / ScamShield'), [{ name: 'Synthetic Bank', type: 'other' }])
  assert.deepEqual(normaliseInstitution('DBS Bank Ltd'), { name: 'DBS/POSB', type: 'bank' })
})

test('A2: a reference given with "told the bank" is its own fact and never contradicts the yes', async () => {
  const findings = await reconcile([
    story('reported_to_bank', yes(null, '2026-10-03')),
    answer('reported_to_bank', yes('REF-0001', '2026-10-03')),
  ])
  const told = findings.find((f) => f.factKey === 'reported_to_bank')!
  assert.equal(told.findingType, 'agreed')
  const reference = findings.find((f) => f.factKey === 'bank_case_reference')!
  assert.equal(reference.findingType, 'agreed')
  assert.equal(reference.values[0].value, 'REF-0001')
  assert.equal(formatFactValue('reported_to_bank', told.values[0].value), 'Yes, 3 Oct 2026')
})

test('A7: a bank email about the card dispute cannot contradict how the scam happened', async () => {
  const email = 'Card dispute status update. Thank you for contacting us about the transactions you did not authorise. ' +
    'The customer wrote: I just saw that all the fraudulent transactions were approved. We are reviewing your claim.'
  const raw = {
    document_type: 'bank_correspondence',
    scam_types: [{ value: 'other', quote: 'I just saw that all the fraudulent transactions were approved', confidence: 0.9 }],
    reported_to_bank: { value: 'yes', date: null, reference: null, quote: 'Thank you for contacting us', confidence: 0.9 },
  }
  const fromEmail = parseFactExtraction(raw, email, { sourceType: 'document', sourceRef: { kind: 'document', documentId: 'synthetic' } })
  const scam = fromEmail.find((c) => c.factKey === 'scam_type')!
  assert.equal(scam.sourceRef.context, true, 'recorded as context, not as an opposing value')
  assert.equal(fromEmail.find((c) => c.factKey === 'reported_to_bank')!.sourceRef.context, false, 'it can say the bank was told')

  const findings = await reconcile([story('scam_type', ['phishing_sms_or_message']), ...fromEmail])
  assert.equal(findings.find((f) => f.factKey === 'scam_type')!.findingType, 'agreed')
})

test('A7: a document value without a confidence, or below the threshold, is context', () => {
  const text = 'Statement. 03 Oct 2026 FAST transfer S$2,400.00'
  const parse = (confidence?: number) => parseFactExtraction(
    { document_type: 'bank_statement', total_loss: [{ amount: 2400, currency: 'SGD', account: 'savings_or_current', quote: 'FAST transfer S$2,400.00', confidence }] },
    text,
    { sourceType: 'document', sourceRef: { kind: 'document' } },
  )[0]
  assert.equal(parse(0.95).sourceRef.context, false)
  assert.equal(parse(0.4).sourceRef.context, true)
  assert.equal(parse(undefined).sourceRef.context, true)
})

const finding = (factKey: CurrentFinding['factKey'], values: unknown[], resolution: CurrentFinding['resolution']): CurrentFinding => ({
  id: `f-${factKey}`,
  factKey,
  findingType: 'conflict',
  values: values.map((value) => ({ value, sources: [] })),
  status: 'resolved',
  resolution,
})

test('A1/A4: ticking several amounts gives their sum, with each amount and account kept', () => {
  const sgd = (amount: number, account: string | null) => ({ amount, currency: 'SGD', amountSgd: amount, account })
  const { facts } = buildSnapshot([
    finding('total_loss', [sgd(2400, 'savings_or_current'), sgd(1100, 'credit_card'), sgd(20000, null)], { kind: 'choices', indices: [0, 1] }),
  ], 'free')
  const loss = facts.total_loss!.value as { amount: number; portions: Array<{ account: string; amount: { amount: number } }> }
  assert.equal(loss.amount, 3500)
  assert.deepEqual(loss.portions.map((p) => [p.account, p.amount.amount]), [['savings_or_current', 2400], ['credit_card', 1100]])
  assert.equal(formatFactValue('total_loss', loss), 'S$3,500 in total: Bank account S$2,400, Credit card S$1,100')
})

test('A1: several institutions can be chosen; single-select facts cannot take several values', () => {
  const { facts } = buildSnapshot([
    finding('institution_names', [[{ name: 'DBS/POSB', type: 'bank' }], [{ name: 'GrabPay', type: 'payment_service_provider' }]], { kind: 'choices', indices: [0, 1] }),
  ], 'free')
  assert.equal(formatFactValue('institution_names', facts.institution_names!.value), 'DBS/POSB, GrabPay')
  for (const key of ['institution_names', 'account_types', 'transactions', 'total_loss'] as const) assert.ok(MULTI_SELECT_FACT_KEYS.has(key))
  for (const key of ['scam_type', 'phishing_channel', 'credentials_or_otp_shared', 'reported_to_bank', 'reported_to_police', 'bank_reply'] as const) {
    assert.ok(!MULTI_SELECT_FACT_KEYS.has(key), key)
  }
  const service = readFileSync('lib/server/facts/facts-service.ts', 'utf8')
  assert.match(service, /if \(!MULTI_SELECT_FACT_KEYS\.has\(row\.fact_key as FactKey\)\) throw new ResolutionRejectedError\("single_select_fact"\)/)
})

test('A3: accounts affected are the four regulated categories, and several can be chosen', () => {
  assert.deepEqual(FACT_ENUM_OPTIONS.account_types!.map((o) => o.label), [
    'Bank account',
    'Debit card',
    'Credit card',
    'E-wallet or e-money account with a payment service provider',
  ])
  assert.deepEqual(validateFactValue('account_types', ['savings_or_current', 'credit_card']), ['savings_or_current', 'credit_card'])
  assert.deepEqual(validateFactValue('account_types', ['other']), ['other'], '"Something else"')
})

test('A5: the full scam-type and first-contact lists are offered, one choice only, without a separate "Other"', () => {
  assert.deepEqual(FACT_ENUM_OPTIONS.scam_type!.map((o) => o.value), [
    'phishing_sms_or_message', 'phishing_email', 'phishing_call', 'fake_website_or_ad', 'romance', 'investment', 'job',
    'government_impersonation', 'ecommerce', 'malware',
  ])
  assert.deepEqual(FACT_ENUM_OPTIONS.phishing_channel!.map((o) => o.value), [
    'phone_call', 'sms', 'messaging_app', 'email', 'dating_app', 'social_media', 'website_or_ad', 'in_person',
  ])
  assert.deepEqual(validateFactValue('scam_type', 'phishing_email'), ['phishing_email'])
  assert.equal(validateFactValue('scam_type', ['phishing_email', 'investment']), null, 'the scam type decides the framework')
  assert.deepEqual(validateFactValue('scam_type', 'other'), ['other'], '"Something else"')
})

test('A6: credentials shared is yes or no with how, and a story stating it with nothing against it is agreed', async () => {
  assert.deepEqual(FACT_ENUM_OPTIONS.credentials_or_otp_shared!.map((o) => o.label), [
    'Yes: entered on a fake website or app',
    'Yes: told to someone over the phone',
    'Yes: sent in a message',
    'Yes: installed an app the scammer asked for',
    'No: never shared',
  ])
  const findings = await reconcile([story('credentials_or_otp_shared', 'entered_on_fake_site_or_app')])
  assert.equal(findings.find((f) => f.factKey === 'credentials_or_otp_shared')!.findingType, 'agreed')
})

test('the SRF reads the new scam types and channels', () => {
  const base = {
    scamTypes: ['phishing_sms_or_message' as const],
    channel: 'sms' as const,
    credentials: 'entered_on_fake_site_or_app' as const,
    impersonated: 'bank_or_fi' as const,
    transactions: null,
  }
  assert.equal(assessSrf(base).portions[0].assessment, 'likely_in_scope')
  assert.equal(assessSrf({ ...base, credentials: 'given_in_message' }).portions[0].assessment, 'likely_out_of_scope')
  assert.equal(assessSrf({ ...base, scamTypes: ['phishing_call'], channel: 'phone_call' }).portions[0].assessment, 'likely_out_of_scope')
  assert.equal(assessSrf({ ...base, channel: 'in_person' }).portions[0].assessment, 'likely_out_of_scope')
})
