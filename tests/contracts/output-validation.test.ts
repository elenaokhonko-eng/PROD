import assert from 'node:assert/strict'
import test from 'node:test'
import { factsYouConfirmed, qualifyUnsupportedStatements, type SnapshotFacts, validateOutput } from '../../lib/facts'

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

test('mentioning a police report without saying one was filed needs no qualifier (staging run, 5 Nov)', () => {
  const claimantOnly: SnapshotFacts = { ...facts, reported_to_police: { ...facts.reported_to_police!, label: 'claimant_only' } }
  const checklist = { evidence: 'Useful evidence: a copy of your police report, screenshots of the SMS and your bank statement.' }
  assert.deepEqual(validateOutput(checklist, claimantOnly), [])
  assert.deepEqual(validateOutput({ t: 'You told us you reported it to the police on 4 Oct 2026.' }, claimantOnly), [])
  assert.equal(validateOutput({ t: 'You reported it to the police on 4 Oct 2026.' }, claimantOnly)[0]?.check, 'unqualified')
})

test('the fallback qualifies only document-less or unsure statements, and they then pass (staging run, 5 Nov)', () => {
  const claimantOnly: SnapshotFacts = { ...facts, reported_to_police: { ...facts.reported_to_police!, label: 'claimant_only' } }
  const text = 'On 4 Oct 2026, the user discovered it was a scam and reported the incident to the police. S$3,000 was lost.'
  assert.equal(validateOutput({ t: text }, claimantOnly)[0]?.check, 'unqualified')
  const fixed = qualifyUnsupportedStatements(text, claimantOnly)
  assert.equal(fixed, 'You told us that on 4 Oct 2026, the user discovered it was a scam and reported the incident to the police. S$3,000 was lost.')
  assert.deepEqual(validateOutput({ t: fixed }, claimantOnly), [])

  const notSure: SnapshotFacts = { ...facts, reported_to_police: { value: null, label: 'not_sure' } }
  assert.match(qualifyUnsupportedStatements('I filed a police report.', notSure), /^It is not confirmed that I filed a police report\.$/)
  assert.equal(qualifyUnsupportedStatements(text, facts), text, 'confirmed facts are left alone')
})

test('bank confirmed "no": saying you contacted the bank fails; being told by the bank does not (staging run, 5 Nov)', () => {
  const noBank: SnapshotFacts = { ...facts, reported_to_bank: { value: { value: 'no', date: null, reference: null, channel: null }, label: 'confirmed' } }
  assert.equal(validateOutput({ t: 'You also contacted the bank, but they rejected your request.' }, noBank)[0]?.check, 'contradiction')
  assert.deepEqual(validateOutput({ t: 'The caller said he was from the bank and I was told by the bank to move my money.' }, noBank), [])
  assert.deepEqual(validateOutput({ t: 'You have not contacted the bank yet.' }, noBank), [])
})

test('enum facts display as plain words, not codes', () => {
  const section = factsYouConfirmed({
    impersonated_entity_type: { value: 'bank_or_fi', label: 'confirmed' },
    account_types: { value: ['savings_or_current'], label: 'confirmed' },
  })
  assert.deepEqual(section.map((s) => s.text), ['Bank account', 'A bank or financial institution'])
})

const replyFact = { value: { status: 'final_reply', date: null, outcome: 'rejected', qualifies: null, reference: null }, label: 'claimant_only' as const }

test('a bank reply kept without a document must be attributed, and the fallback attributes it (Elena, 5 Nov)', () => {
  const withReply: SnapshotFacts = { ...facts, bank_reply: replyFact }
  const text = 'The bank later rejected your request for a refund.'
  assert.equal(validateOutput({ t: text }, withReply)[0]?.check, 'unqualified')
  const fixed = qualifyUnsupportedStatements(text, withReply)
  assert.equal(fixed, 'You told us that the bank later rejected your request for a refund.')
  assert.deepEqual(validateOutput({ t: fixed }, withReply), [])
})

test('the bank cannot have replied if it was never told: confirmed "no" plus a reply fails (Elena, 5 Nov)', () => {
  const noBank: SnapshotFacts = { ...facts, reported_to_bank: { value: { value: 'no', date: null, reference: null, channel: null }, label: 'confirmed' } }
  const failures = validateOutput({ t: "The bank's final reply was a rejection of your claim." }, noBank)
  assert.ok(failures.some((f) => f.check === 'contradiction'))
})

test('text that says both "not told the bank" and "the bank replied" contradicts itself (staging run, 5 Nov)', () => {
  const text = 'You did not report the incident to Synthetic Bank. The bank later rejected your request for a refund.'
  assert.ok(validateOutput({ t: text }, {}).some((f) => f.check === 'contradiction'))
})

test('the free evaluation speaks to the person as "you", and may be barred from topics such as an SRF verdict', () => {
  assert.equal(validateOutput({ t: 'The user discovered the scam on 4 Oct 2026.' }, facts, { secondPerson: true })[0]?.check, 'person')
  assert.deepEqual(validateOutput({ t: 'The user discovered the scam on 4 Oct 2026.' }, facts), [], 'only when asked')
  const forbidden = [{ pattern: /\bSRF\b|shared responsibility/i, detail: 'SRF verdict is written by the server' }]
  assert.equal(validateOutput({ t: 'This is likely covered by the SRF.' }, facts, { forbidden })[0]?.check, 'forbidden')
})

test('a denied reply is not a reply: "not received any reply ... no amount offered" passes (staging run, 5 Nov)', () => {
  const noBank: SnapshotFacts = { ...facts, reported_to_bank: { value: { value: 'no', date: null, reference: null, channel: null }, label: 'confirmed' } }
  const text = 'As of now, you have not received any reply from Synthetic Bank regarding this matter, and no amount has been recovered or offered to you.'
  assert.deepEqual(validateOutput({ t: text }, noBank), [])
  assert.ok(validateOutput({ t: 'Synthetic Bank later rejected your claim.' }, noBank).some((f) => f.check === 'contradiction'))
})

test('a loss confirmed as one amount per account may be stated part by part (staging, 8 Nov)', () => {
  const split: SnapshotFacts = {
    ...facts,
    transactions: { value: null, label: 'not_sure' },
    total_loss: {
      value: { ...sgd(3000), account: null, portions: [{ amount: sgd(2400), account: 'savings_or_current' }, { amount: sgd(600), account: 'credit_card' }] },
      label: 'confirmed',
    },
  }
  assert.deepEqual(validateOutput({ t: 'You lost S$3,000 in total: S$2,400 from your bank account and S$600 on your credit card.' }, split), [])
  assert.deepEqual(validateOutput({ t: 'You lost S$2,500 from your bank account.' }, split).map((f) => f.check), ['amount'])
})

test('a police report number confirmed from a document backs the police report (staging, 8 Nov)', () => {
  const claimantOnly: SnapshotFacts = { ...facts, reported_to_police: { ...facts.reported_to_police!, label: 'claimant_only' } }
  const sentence = 'You reported it to the police on 4 Oct 2026 and received police report number A0000.'
  assert.deepEqual(validateOutput({ t: sentence }, claimantOnly).map((f) => f.check).sort(), ['reference', 'unqualified'], 'the number was never confirmed, and the report has no document')
  const withNumber: SnapshotFacts = { ...claimantOnly, police_report_number: { value: 'A0000', label: 'confirmed' } }
  assert.deepEqual(validateOutput({ t: sentence }, withNumber), [])
  assert.equal(qualifyUnsupportedStatements(sentence, withNumber), sentence)
  const numberUnbacked: SnapshotFacts = { ...claimantOnly, police_report_number: { value: 'A0000', label: 'claimant_only' } }
  assert.equal(validateOutput({ t: sentence }, numberUnbacked)[0]?.check, 'unqualified')
})

test('"not confirmed whether" qualifies a statement only when it comes first (corpus, 8 Nov)', () => {
  const notSure: SnapshotFacts = { ...facts, reported_to_bank: { value: null, label: 'not_sure' } }
  assert.deepEqual(validateOutput({ t: 'It is not confirmed whether you reported the incident to your bank or received any reply from them.' }, notSure), [])
  assert.deepEqual(validateOutput({ t: 'There are no confirmed details on whether you reported it to your bank.' }, notSure), [])
  assert.equal(validateOutput({ t: 'You reported the incident to your bank, but it is not confirmed whether you received a reply.' }, notSure)[0]?.check, 'unqualified')
})

test('references must be ones the person confirmed (corpus, 8 Nov)', () => {
  const withRef: SnapshotFacts = { ...facts, police_report_number: { value: 'G/20261004/0000', label: 'confirmed' } }
  assert.deepEqual(validateOutput({ t: 'Your police report number is G/20261004/0000.' }, withRef), [])
  assert.deepEqual(validateOutput({ t: 'Your police report number is G/20261004/0000.' }, facts).map((f) => f.check), ['reference'])
  assert.deepEqual(validateOutput({ t: 'You were given police report number 123456.' }, facts).map((f) => f.check), ['reference'])
  assert.deepEqual(validateOutput({ t: 'Your bank case reference is SYN-0001.' }, facts).map((f) => f.check), ['reference'])
  assert.deepEqual(validateOutput({ t: 'From mid-2026 onwards, banks follow covid-19 era rules on 3/10.' }, facts).filter((f) => f.check === 'reference'), [])
})

test('a loss without a document is attributed unless the confirmed payments add up to it (corpus, 8 Nov)', () => {
  const claimed: SnapshotFacts = { ...facts, transactions: { value: null, label: 'not_sure' }, total_loss: { value: sgd(3000), label: 'claimant_only' } }
  assert.deepEqual(validateOutput({ t: 'S$3,000 was taken from your account.' }, claimed).map((f) => f.check), ['unqualified'])
  assert.deepEqual(validateOutput({ t: 'You told us that S$3,000 was taken from your account.' }, claimed), [])
  assert.deepEqual(validateOutput({ t: 'You reported a total loss of S$3,000.' }, claimed), [])
  const backed: SnapshotFacts = { ...facts, total_loss: { value: sgd(3000), label: 'claimant_only' } }
  assert.deepEqual(validateOutput({ t: 'S$3,000 was taken from your account.' }, backed), [])
})

test('payment amounts without a document are attributed, and the code repair adds "You told us that" (corpus, 8 Nov)', () => {
  const claimed: SnapshotFacts = { ...facts, total_loss: { value: sgd(3000), label: 'claimant_only' }, transactions: { ...facts.transactions!, label: 'claimant_only' } }
  const plain = 'S$2,400 was transferred to an unknown account.'
  assert.deepEqual(validateOutput({ t: plain }, claimed).map((f) => f.check), ['unqualified'])
  const repaired = qualifyUnsupportedStatements(plain, claimed)
  assert.equal(repaired, 'You told us that S$2,400 was transferred to an unknown account.')
  assert.deepEqual(validateOutput({ t: repaired }, claimed), [])
})

test('a payee on a confirmed payment is not an institution claim; "from your bank account" is not telling the bank (corpus, 8 Nov)', () => {
  const card: SnapshotFacts = {
    ...facts,
    transactions: { value: [{ date: '2026-10-03', amount: sgd(600), channel: null, payee: 'SHOPEEPAY', last4: null, instrument: 'sg_card' }], label: 'confirmed' },
  }
  assert.deepEqual(validateOutput({ t: 'S$600 was charged by ShopeePay on 3 Oct 2026.' }, card).filter((f) => f.check === 'institution'), [])
  assert.deepEqual(validateOutput({ t: 'I hold an account with DBS.' }, card).map((f) => f.check), ['institution'])
  const notSure: SnapshotFacts = { ...facts, reported_to_bank: { value: null, label: 'not_sure' } }
  assert.deepEqual(validateOutput({ t: 'You reported a total loss of S$3,000 from your bank account.' }, notSure), [])
  assert.equal(validateOutput({ t: 'You reported it to your bank on 3 Oct 2026.' }, notSure)[0]?.check, 'unqualified')
})
