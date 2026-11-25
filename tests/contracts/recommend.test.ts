import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { FINAL_REPLY_EXPIRED_NOTE, fidrecAvailability, recommend, type RecommendFacts } from '../../lib/facts'

// Synthetic journeys. "today" is fixed so every date boundary is exact.
const today = '2026-11-30'
const yes = (date: string | null = null) => ({ value: 'yes' as const, date, reference: null, channel: null })
const no = { value: 'no' as const, date: null, reference: null, channel: null }
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const base: RecommendFacts = {
  reportedToBank: null, writtenComplaint: null, bankReply: null, fidrecFiled: null,
  totalLoss: sgd(2400), recovered: null, institutions: [{ name: 'Synthetic Bank', type: 'other' }],
}
const finalReply = (date: string, qualifies: 'yes' | 'no' | 'unsure' | null = 'yes', outcome: 'rejected' | 'full_offer' = 'rejected') =>
  ({ status: 'final_reply' as const, date, outcome, qualifies, reference: null })
const run = (facts: Partial<RecommendFacts>, bankPackEnabled = true) => recommend({ ...base, ...facts }, { today, bankPackEnabled })
const state = (r: ReturnType<typeof recommend>, product: string) => r.products.find((p) => p.product === product)!

test('not yet told the bank -> bank pack, with urgent guidance', () => {
  const r = run({ reportedToBank: no })
  assert.equal(r.position, 'not_told')
  assert.equal(r.recommended, 'bank_pack')
  assert.match(r.guidance.join(' '), /bank and to the police now/)
  assert.deepEqual(state(r, 'fidrec_pack'), { product: 'fidrec_pack', state: 'not_offered', reason: 'complaint_not_raised' })
})

test('told the bank, no written complaint -> bank pack', () => {
  const r = run({ reportedToBank: yes('2026-11-01') })
  assert.equal(r.position, 'told_no_complaint')
  assert.equal(r.recommended, 'bank_pack')
})

test('written complaint under four weeks -> optional bank pack; FIDReC available from complaint + 28 days', () => {
  const r = run({ reportedToBank: yes(), writtenComplaint: yes('2026-11-03') })
  assert.equal(r.position, 'complaint_recent')
  assert.equal(r.recommended, 'bank_pack')
  assert.equal(r.optional, true)
  assert.deepEqual(state(r, 'fidrec_pack'), { product: 'fidrec_pack', state: 'available_from', date: '2026-12-01' })
})

test('4-week boundary: 27 days too early, 28 days available (ToR Rule 13(1)(i))', () => {
  const at27 = fidrecAvailability({ reportedToBank: yes(), writtenComplaint: yes('2026-11-03'), bankReply: null }, today)
  assert.equal(at27.available, false)
  const at28 = fidrecAvailability({ reportedToBank: yes(), writtenComplaint: yes('2026-11-02'), bankReply: null }, today)
  assert.deepEqual(at28, { available: true, route: 'four_weeks', deadline: null })
})

test('written complaint four weeks or more, no final reply -> FIDReC, bank pack still available, no deadline', () => {
  const r = run({ reportedToBank: yes(), writtenComplaint: yes('2026-10-01') })
  assert.equal(r.position, 'complaint_four_weeks')
  assert.equal(r.recommended, 'fidrec_pack')
  assert.equal(state(r, 'bank_pack').state, 'available')
  assert.equal(r.deadline, null)
})

test('qualifying final reply in the window -> FIDReC with the deadline; bank pack not offered', () => {
  const r = run({ reportedToBank: yes(), writtenComplaint: yes('2026-09-01'), bankReply: finalReply('2026-10-28') })
  assert.equal(r.position, 'final_reply_in_window')
  assert.equal(r.recommended, 'fidrec_pack')
  assert.deepEqual(r.deadline, { date: '2027-04-28', daysLeft: 149, soon: false })
  assert.deepEqual(state(r, 'bank_pack'), { product: 'bank_pack', state: 'not_offered', reason: 'final_reply_received' })
})

test('deadline soon (30 days or fewer) and expired', () => {
  const soon = run({ reportedToBank: yes(), bankReply: finalReply('2026-06-15') })
  assert.deepEqual(soon.deadline, { date: '2026-12-15', daysLeft: 15, soon: true })
  const expired = run({ reportedToBank: yes(), bankReply: finalReply('2026-05-01') })
  assert.equal(expired.position, 'final_reply_expired')
  assert.equal(expired.recommended, null)
  assert.deepEqual(state(expired, 'fidrec_pack'), { product: 'fidrec_pack', state: 'not_offered', reason: 'fidrec_window_expired' })
})

test('month-end deadline: 31 May + 6 months = 30 Nov', () => {
  const r = run({ reportedToBank: yes(), bankReply: finalReply('2026-05-31') })
  assert.deepEqual(r.deadline, { date: '2026-11-30', daysLeft: 0, soon: true })
})

test('a final reply that may not qualify starts no clock; FIDReC via the 4-week route only', () => {
  const recent = run({ reportedToBank: yes(), writtenComplaint: yes('2026-11-20'), bankReply: finalReply('2026-11-25', 'unsure') })
  assert.equal(recent.position, 'final_reply_not_qualifying')
  assert.equal(recent.recommended, null)
  assert.equal(recent.deadline, null)
  const later = run({ reportedToBank: yes(), writtenComplaint: yes('2026-09-01'), bankReply: finalReply('2026-10-01', 'no') })
  assert.equal(later.recommended, 'fidrec_pack')
  assert.equal(later.deadline, null)
})

test('already filed with FIDReC -> FIDReC pack', () => {
  assert.equal(run({ reportedToBank: yes(), fidrecFiled: yes('2026-11-10') }).recommended, 'fidrec_pack')
})

test('full refund -> no further step', () => {
  const r = run({ reportedToBank: yes(), bankReply: finalReply('2026-11-01', 'yes', 'full_offer') })
  assert.equal(r.position, 'resolved')
  assert.equal(r.recommended, null)
})

test('emergency switch off: bank pack unavailable, the reporting steps are given without promising a section that may not exist (C4)', () => {
  const r = run({ reportedToBank: no }, false)
  assert.equal(r.recommended, null)
  assert.deepEqual(state(r, 'bank_pack'), { product: 'bank_pack', state: 'unavailable' })
  assert.match(r.guidance.join(' '), /report it to your bank's 24-hour fraud hotline, the police and ScamShield \(helpline 1799\)/)
  assert.doesNotMatch(r.guidance.join(' '), /sets out how to report/)
})

test('loss above S$150,000 mentions the FIDReC award cap; unknown members get a soft note', () => {
  const r = recommend(
    { ...base, totalLoss: sgd(200_000), reportedToBank: yes(), writtenComplaint: yes('2026-09-01') },
    { today, bankPackEnabled: true, isFidrecMember: () => false },
  )
  assert.match(r.notes.join(' '), /capped at S\$150,000 per claim/)
  assert.match(r.notes.join(' '), /couldn't confirm that Synthetic Bank is a FIDReC member/)
  assert.equal(run({ totalLoss: sgd(150_000), reportedToBank: yes() }).notes.length, 0)
})

// Rules review, 25 Nov (row 22, wording approved by Elena): only once the six months after a final reply have passed,
// whether or not the letter was read as qualifying; never within the six months.
test('a final reply more than six months old explains what a final reply is under Rule 13(2)', () => {
  const reply = (date: string, qualifies: 'yes' | null) => ({ status: 'final_reply' as const, date, outcome: 'rejected' as const, qualifies, reference: null })
  const expired = run({ reportedToBank: yes(), writtenComplaint: yes('2026-03-01'), bankReply: reply('2026-04-01', 'yes') })
  assert.equal(expired.position, 'final_reply_expired')
  assert.ok(expired.notes.includes(FINAL_REPLY_EXPIRED_NOTE))
  assert.ok(run({ reportedToBank: yes(), bankReply: reply('2026-04-01', null) }).notes.includes(FINAL_REPLY_EXPIRED_NOTE), 'also when not read as qualifying')
  assert.ok(!run({ reportedToBank: yes(), bankReply: reply('2026-10-01', 'yes') }).notes.includes(FINAL_REPLY_EXPIRED_NOTE), 'not within six months')
  assert.ok(!run({ reportedToBank: yes(), bankReply: reply('2026-05-30', 'yes') }).notes.includes(FINAL_REPLY_EXPIRED_NOTE), 'not on the last day')
  assert.match(FINAL_REPLY_EXPIRED_NOTE, /^FIDReC's Terms of Reference say a final reply is a letter that expressly states it is the institution's final reply, tells you that you can contact FIDReC within six months, and gives FIDReC's contact details \(Rule 13\(2\)\)\. If the reply you received did not state these, you can ask your bank in writing to confirm whether it was its final reply\. Whether a document is a final reply is decided by FIDReC\.$/)
  // Signed-in only: the recommendation is served by a case-access route, and no public page imports it.
  assert.match(readFileSync('app/api/cases/[caseId]/recommendation/route.ts', 'utf8'), /await factsCaseAccess\(caseId\)/)
})
