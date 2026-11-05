import assert from 'node:assert/strict'
import test from 'node:test'
import { assessSrf, type SrfFacts, type Transaction } from '../../lib/facts'

// Synthetic cases for the SRF scope rules (design 8.2, 8.3).
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const txn = (amount: number, instrument: Transaction['instrument'], date = '2026-10-03'): Transaction =>
  ({ date, amount: sgd(amount), channel: null, payee: null, last4: null, instrument })
const phishing: SrfFacts = {
  scamTypes: ['digital_phishing'],
  channel: 'sms',
  credentials: 'entered_on_fake_site_or_app',
  impersonated: 'bank_or_fi',
  transactions: [txn(2400, 'account_transfer')],
}

test('digital phishing with details entered on a fake site is likely in scope', () => {
  const a = assessSrf(phishing)
  assert.equal(a.portions.length, 1)
  assert.equal(a.portions[0].assessment, 'likely_in_scope')
  assert.equal(a.remedies, null)
})

test('malware, phone-only phishing, details given directly, authorised scams and private-person impersonation are out', () => {
  for (const [label, facts] of [
    ['malware', { ...phishing, credentials: 'installed_app_or_malware' }],
    ['phone only', { ...phishing, scamTypes: ['non_digital_phishing'], channel: 'phone_call' }],
    ['given directly', { ...phishing, credentials: 'given_directly' }],
    ['investment', { ...phishing, scamTypes: ['investment'] }],
    ['private person', { ...phishing, impersonated: 'private_person' }],
  ] as const) {
    const a = assessSrf(facts as SrfFacts)
    assert.equal(a.portions[0].assessment, 'likely_out_of_scope', label)
    assert.ok(a.remedies, `${label}: out of scope still lists other remedies`)
  }
})

test('payments before 16 Dec 2024 are "likely" out, worded as likely and cited as unstated', () => {
  const a = assessSrf({ ...phishing, transactions: [txn(2400, 'account_transfer', '2024-11-01')] })
  assert.equal(a.portions[0].assessment, 'likely_out_of_scope')
  assert.match(a.portions[0].reasons[0].text, /likely not to apply/)
  assert.match(a.portions[0].reasons[0].cite, /no source states/)
})

test('missing facts make the assessment unclear rather than in or out', () => {
  const a = assessSrf({ ...phishing, credentials: null, impersonated: 'unsure' })
  assert.equal(a.portions[0].assessment, 'unclear')
})

test('SMS phishing mentions the telco and IMDA; WhatsApp says telco duties do not apply', () => {
  assert.match(assessSrf(phishing).telco!.text, /mobile operator may be responsible.*IMDA in writing, not to FIDReC/)
  assert.match(assessSrf({ ...phishing, channel: 'messaging_app' }).telco!.text, /not SMS/)
})

test('card and transfer losses are split into two portions with subtotals (design 8.3)', () => {
  const a = assessSrf({ ...phishing, transactions: [txn(2400, 'account_transfer'), txn(600, 'sg_card')] })
  assert.deepEqual(a.portions.map((p) => [p.kind, p.total?.amount, p.assessment]), [
    ['srf', 2400, 'likely_in_scope'],
    ['card', 600, 'likely_out_of_scope'],
  ])
  assert.match(a.portions[1].reasons[0].text, /^S\$600 on your card: the SRF does not cover/)
  assert.match(a.portions[1].reasons[0].cite, /G fn 1/)
  assert.ok(a.remedies, 'the card portion lists other remedies')
})

test('e-wallet payments note the protected-account criteria', () => {
  const a = assessSrf({ ...phishing, transactions: [txn(800, 'ewallet')] })
  assert.match(a.portions[0].reasons.map((r) => r.text).join(' '), /licensed major payment institutions/)
})
