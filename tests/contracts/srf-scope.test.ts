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
  // Rules review, 25 Nov (row 6, wording chosen by Elena): the bank passes the claim on (G 7.7, 7.7.1, 7.11).
  const telco = assessSrf(phishing).telco!
  assert.match(telco.text, /mobile operator may be responsible/)
  assert.ok(telco.text.endsWith("Your bank is your point of contact and passes the claim to the operator, which investigates its own duties. If you disagree with the operator's assessment, you can write to IMDA."))
  assert.doesNotMatch(telco.text, /not to FIDReC|Your bank assesses this/)
  assert.match(telco.cite, /7.7, 7.7.1, 7.11/)
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

// Rules review, 25 Nov (wording approved by Elena): the four operators the SRF covers (R fn 2), and MAS's reply to
// Parliament of 7 Jan 2025 on 3DS, in place of "the issuer may treat it as negligence".
test('the SMS line names the four operators; the card line quotes MAS on 3DS, with its citation', () => {
  const telco = assessSrf(phishing).telco!.text
  assert.ok(telco.includes('did not meet its own. The SRF applies to four mobile network operators only: Singtel, M1, StarHub and SIMBA. It does not apply to other mobile providers. Your bank is your point of contact'))
  const card = assessSrf({ ...phishing, transactions: [{ date: '2026-10-12', amount: { amount: 1200, currency: 'SGD', amountSgd: 1200 }, channel: null, payee: null, last4: null, instrument: 'sg_card' }] })
    .portions.find((p) => p.kind === 'card')!
  const text = card.reasons.map((r) => r.text).join(' ')
  assert.ok(text.includes("In a written reply to Parliament on 7 January 2025, MAS stated that the S$100 limit will not apply to a cardholder who unwittingly authenticates a 3DS transaction that turns out to be fraudulent, 'as that would be considered negligent'. 3DS is the step where you approve a card payment with a one-time password or in your banking app."))
  assert.doesNotMatch(text, /may treat it as negligence/)
  assert.ok(card.reasons.some((r) => r.cite.endsWith('; mas.reply.20250107/3(a).3ds')))
})
