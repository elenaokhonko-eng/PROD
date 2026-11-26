import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assessSrf, FINAL_REPLY_ASK, FINAL_REPLY_EXPIRED_NOTE, recommend, srfFactsFromSnapshot } from '../../lib/facts'
import { agreeWithGenerator } from '../../lib/billing/fidrec-offer-check'

// Elena's decisions of 27 Nov 2026 on the Part B re-test. Synthetic facts only.
const today = '2026-11-27'
const no = { value: 'no' as const, date: null, reference: null, channel: null }
const yes = (date: string) => ({ value: 'yes' as const, date, reference: null, channel: null })
const reply = (date: string) => ({ status: 'final_reply' as const, date, outcome: 'rejected' as const, qualifies: null, reference: null })
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const confirmed = <T>(value: T) => ({ value, label: 'confirmed' as const })

// Wording approved by Elena, 27 Nov 2026 ("approved for both").
const ASK = "You can ask your bank to confirm in writing: (a) whether its reply was its final reply; (b) whether you can take the dispute to FIDReC, and by when; (c) what it offers: nothing, part of the amount, or all of it. Whether a letter is a final reply is decided by FIDReC (Rule 13(2)). When you have the bank's letter, add it to your case."

test('a closed window: the evaluation says it as one passage, and the offer and refusal screens ask the same', () => {
  assert.equal(FINAL_REPLY_ASK, ASK)
  assert.equal(
    FINAL_REPLY_EXPIRED_NOTE,
    "FIDReC's Terms of Reference say a final reply is a letter that expressly states it is the institution's final reply, tells you that you can contact FIDReC within six months, and gives FIDReC's contact details (Rule 13(2)). " + ASK,
  )
  const notes = recommend(
    { reportedToBank: yes('2026-02-11'), writtenComplaint: no, bankReply: reply('2026-04-01'), fidrecFiled: null, totalLoss: sgd(3000), recovered: null, institutions: [] },
    { today, bankPackEnabled: true },
  ).notes
  assert.deepEqual(notes.slice(notes.indexOf(FINAL_REPLY_EXPIRED_NOTE) - 1, notes.indexOf(FINAL_REPLY_EXPIRED_NOTE) + 1), [
    'The final reply you told us about is dated 1 Apr 2026. Six months from that date ended on 1 Oct 2026 (Rule 13(1)(ii)).',
    FINAL_REPLY_EXPIRED_NOTE,
  ])
  assert.equal(notes.filter((n) => n.includes('confirm in writing')).length, 1, 'said once')
  const offer = readFileSync('components/state-machine/transition/fidrec-offer.tsx', 'utf8')
  assert.ok(offer.includes('FIDReC takes complaints up to six months after the bank’s final reply, and that time has passed. ${FINAL_REPLY_ASK}`'))
  const refusal = readFileSync('components/state-machine/facts/confirm-and-evaluate.tsx', 'utf8')
  assert.ok(refusal.includes('more than six months have passed since your bank’s final reply. ${FINAL_REPLY_ASK}`'))
  // The next-steps card sits on the same page as the passage, so it states only the fact.
  const card = readFileSync('components/state-machine/facts/next-steps.tsx', 'utf8')
  assert.ok(card.includes("return 'The six-month window to go to FIDReC after the final reply has passed.'"))
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

// Pack first: the account's waiting case may already own the pack the button names.
test('pressing a pack already bought for the waiting case goes to My cases, not to an error', () => {
  const route = readFileSync('app/api/cases/pack-first/route.ts', 'utf8')
  assert.match(route, /readiness\.reason === 'already_purchased'/)
  assert.match(route, /case_id: caseId, owned/)
  const client = readFileSync('app/(case)/app/pack/[pack]/_components/pack-first-client.tsx', 'utf8')
  assert.match(client, /if \(data\.owned\) \{\s+router\.replace\('\/app'\)/)
})
