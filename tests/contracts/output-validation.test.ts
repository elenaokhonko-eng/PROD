import assert from 'node:assert/strict'
import test from 'node:test'
import { factsYouConfirmed, type SnapshotFacts, validateOutput } from '../../lib/facts'

// Synthetic confirmed facts for one case.
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const facts: SnapshotFacts = {
  institution_names: { value: [{ name: 'Synthetic Bank', type: 'other' }], label: 'confirmed' },
  total_loss: { value: sgd(3000), label: 'confirmed' },
  transactions: {
    value: [
      { date: '2026-10-03', amount: sgd(2400), channel: null, payee: null, last4: null, instrument: 'account_transfer' },
      { date: '2026-10-03', amount: sgd(600), channel: null, payee: null, last4: '0000', instrument: 'sg_card' },
    ],
    label: 'confirmed',
  },
  reported_to_police: { value: { value: 'yes', date: '2026-10-04', reference: null, channel: null }, label: 'confirmed' },
  reported_to_bank: { value: { value: 'yes', date: '2026-10-03', reference: null, channel: null }, label: 'confirmed' },
}

const faithful = {
  executive_summary:
    'On 3 Oct 2026 I lost S$3,000 to a phishing scam: S$2,400 by bank transfer and S$600 on my card. ' +
    'I reported it to Synthetic Bank on 3 October 2026 and filed a police report on 4 Oct 2026. ' +
    'The bank did not reply after I reported it to the police.',
}

test('a report that matches the confirmed facts passes', () => {
  assert.deepEqual(validateOutput(faithful, facts), [])
})

test('the 5 November case: a report saying the police were never told fails', () => {
  const failures = validateOutput({ text: 'I have not yet reported this matter to the police.' }, facts)
  assert.deepEqual(failures.map((f) => f.check), ['contradiction'])
})

test('a wrong amount, an unconfirmed date and an invented institution each fail', () => {
  const failures = validateOutput(
    { a: 'I lost S$9,000.', b: 'On 20 Oct 2026 the payment went out.', c: 'I hold an account with DBS.' },
    facts,
  )
  assert.deepEqual(failures.map((f) => f.check).sort(), ['amount', 'date', 'institution'])
})

test('stage amounts and dates passed as extras are allowed', () => {
  const text = { note: 'FIDReC awards are capped at S$150,000. The SRF took effect on 16 Dec 2024.' }
  assert.equal(validateOutput(text, facts).length, 2)
  assert.deepEqual(validateOutput(text, facts, { extraAmounts: [150000], extraDates: ['2024-12-16'] }), [])
})

test('"DBS PayLah!" counts as the e-wallet, not as DBS bank', () => {
  const withWallet: SnapshotFacts = { ...facts, institution_names: { value: [{ name: 'DBS PayLah!', type: 'payment_service_provider' }], label: 'confirmed' } }
  assert.deepEqual(validateOutput({ t: 'The transfer left my DBS PayLah! wallet.' }, withWallet), [])
})

test('police confirmed "no": a report claiming a police report fails', () => {
  const noPolice: SnapshotFacts = { ...facts, reported_to_police: { value: { value: 'no', date: null, reference: null, channel: null }, label: 'confirmed' } }
  assert.equal(validateOutput({ t: 'I filed a police report the next day.' }, noPolice)[0]?.check, 'contradiction')
  assert.deepEqual(validateOutput({ t: 'I have not made a police report.' }, noPolice), [])
})

test('"not sure" and document-less facts must be qualified', () => {
  const notSure: SnapshotFacts = { ...facts, reported_to_police: { value: null, label: 'not_sure' } }
  assert.equal(validateOutput({ t: 'I filed a police report.' }, notSure)[0]?.check, 'unqualified')
  assert.deepEqual(validateOutput({ t: 'I am not sure whether a police report was filed.' }, notSure), [])

  const claimantOnly: SnapshotFacts = { ...facts, reported_to_police: { ...facts.reported_to_police!, label: 'claimant_only' } }
  assert.equal(validateOutput({ t: 'A police report was filed on 4 Oct 2026.' }, claimantOnly)[0]?.check, 'unqualified')
  assert.deepEqual(validateOutput({ t: 'According to the claimant, a police report was filed on 4 Oct 2026.' }, claimantOnly), [])
})

test('"Facts you confirmed" is rendered from the snapshot with qualifiers', () => {
  const section = factsYouConfirmed({
    ...facts,
    amount_recovered_or_offered: { value: null, label: 'not_known' },
    reported_to_police: { ...facts.reported_to_police!, label: 'claimant_only' },
  })
  const byKey = Object.fromEntries(section.map((s) => [s.factKey, s.text]))
  assert.equal(byKey.total_loss, 'S$3,000')
  assert.equal(byKey.amount_recovered_or_offered, 'Not known')
  assert.equal(byKey.reported_to_police, 'Yes, 4 Oct 2026 (no supporting document provided)')
  assert.match(byKey.transactions, /S\$600 3 Oct 2026 \(card\)/)
})
