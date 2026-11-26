import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assessSrf, FINAL_REPLY_EXPIRED_NOTE, FINAL_REPLY_RENEW_NOTE, recommend, srfFactsFromSnapshot } from '../../lib/facts'
import { agreeWithGenerator } from '../../lib/billing/fidrec-offer-check'

// Elena's decisions of 27 Nov 2026 on the Part B re-test. Synthetic facts only.
const today = '2026-11-27'
const no = { value: 'no' as const, date: null, reference: null, channel: null }
const yes = (date: string) => ({ value: 'yes' as const, date, reference: null, channel: null })
const reply = (date: string) => ({ status: 'final_reply' as const, date, outcome: 'rejected' as const, qualifies: null, reference: null })
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const confirmed = <T>(value: T) => ({ value, label: 'confirmed' as const })

test('a closed window tells the person to go back to the bank, in the evaluation notes and on every blocked screen', () => {
  assert.match(FINAL_REPLY_RENEW_NOTE, /confirm in writing: \(a\) whether its reply was its final reply; \(b\) whether it told you that you can take the dispute to FIDReC; \(c\) its final offer/)
  assert.match(FINAL_REPLY_RENEW_NOTE, /may start a new six-month window\. Come back when you have the updated letter\.$/)
  const notes = recommend(
    { reportedToBank: yes('2026-02-11'), writtenComplaint: no, bankReply: reply('2026-04-01'), fidrecFiled: null, totalLoss: sgd(3000), recovered: null, institutions: [] },
    { today, bankPackEnabled: true },
  ).notes
  assert.equal(notes.indexOf(FINAL_REPLY_RENEW_NOTE), notes.indexOf(FINAL_REPLY_EXPIRED_NOTE) + 1)
  for (const file of ['components/state-machine/transition/fidrec-offer.tsx', 'components/state-machine/facts/confirm-and-evaluate.tsx', 'components/state-machine/facts/next-steps.tsx']) {
    assert.match(readFileSync(file, 'utf8'), /\$\{FINAL_REPLY_RENEW_NOTE\}/, file)
  }
})

test('once the window has closed the rules paragraph no longer sends the person to FIDReC', () => {
  const facts = (date: string) => ({
    scam_type: confirmed(['non_digital_phishing']),
    phishing_channel: confirmed('phone_call'),
    transactions: confirmed([{ date: '2026-02-10', amount: sgd(3000), channel: null, payee: null, last4: null, instrument: 'account_transfer' }]),
    bank_reply: confirmed(reply(date)),
  }) as never
  const closed = assessSrf(srfFactsFromSnapshot(facts('2026-04-01'), today)).remedies!.text
  assert.match(closed, /Your bank assesses this; you can complain in writing\. MAS and IMDA/)
  assert.doesNotMatch(closed, /go to FIDReC/)
  assert.match(assessSrf(srfFactsFromSnapshot(facts('2026-10-01'), today)).remedies!.text, /if you disagree with the outcome, go to FIDReC\./)
})

// The offer sold on the typed answer while the generator checked the confirmed facts.
test('the offer refuses what the generator would refuse on the confirmed facts', () => {
  const ready = { ready: true as const, reason: null }
  const expired = { written_complaint_sent: confirmed(no), bank_reply: confirmed(reply('2026-04-01')), reported_to_bank: confirmed(yes('2026-02-11')) } as never
  const closed = agreeWithGenerator(ready, { facts: expired, confirmedAt: '2026-11-26T10:00:00Z' }, '2026-11-26T09:00:00Z', today)
  assert.deepEqual(closed, { ready: false, reason: 'fidrec_window_expired' })
  // An answer given after the facts were confirmed is newer information: the confirm step will put it to the person.
  assert.deepEqual(agreeWithGenerator(ready, { facts: expired, confirmedAt: '2026-11-26T08:00:00Z' }, '2026-11-26T09:00:00Z', today), ready)
  assert.deepEqual(agreeWithGenerator(ready, null, '2026-11-26T09:00:00Z', today), ready)
  const blocked = { ready: false as const, reason: 'complaint_not_raised' as const }
  assert.deepEqual(agreeWithGenerator(blocked, { facts: expired, confirmedAt: '2026-11-26T10:00:00Z' }, null, today), blocked)
})
