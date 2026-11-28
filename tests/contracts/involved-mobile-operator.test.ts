import assert from 'node:assert/strict'
import test from 'node:test'
import { answerCandidates, assessSrf, JOURNEY_KEYS, reconcile, srfFactsFromSnapshot } from '../../lib/facts'

// Elena, 28 Nov 2026: the answer to "Which of these are involved?" was saved and never used. Ticking "A mobile
// operator (the scam SMS came through it)" says the scam came by SMS, which the SRF's mobile operator duties turn on.
// Synthetic content only.

const ticked = (value: string, revisionId = 'i1') => ({ questionKey: JOURNEY_KEYS.institutionTypes, value, revisionId })
const channels = (rows: Parameters<typeof answerCandidates>[0]) =>
  answerCandidates(rows).candidates.filter((c) => c.factKey === 'phishing_channel')

test('ticking the mobile operator records that the scam came by SMS, from that answer', () => {
  const found = channels([ticked('bank,telco')])
  assert.deepEqual(found.map((c) => c.value), ['sms'])
  assert.deepEqual(found[0].sourceRef, { questionKeys: [JOURNEY_KEYS.institutionTypes], revisionIds: ['i1'] })
})

test('the other choices say nothing about how the scammer made contact', () => {
  for (const value of ['bank', 'ewallet', 'other', 'bank,ewallet,other', '']) {
    assert.deepEqual(channels([ticked(value)]), [], value)
  }
})

test('the tick reaches the mobile operator rule that the free evaluation and both packs print', async () => {
  const { candidates } = answerCandidates([ticked('bank,telco')])
  const finding = (await reconcile(candidates)).find((f) => f.factKey === 'phishing_channel')!
  assert.equal(finding.findingType, 'agreed')
  const confirmed = (value: unknown) => ({ value, label: 'confirmed' as const })
  const assessment = assessSrf(srfFactsFromSnapshot({
    phishing_channel: confirmed(finding.values[0].value),
    scam_type: confirmed(['phishing_sms_or_message']),
    credentials_or_otp_shared: confirmed('entered_on_fake_site_or_app'),
    impersonated_entity_type: confirmed('bank_or_fi'),
    transactions: confirmed([{ date: '2026-10-03', amount: { amount: 2400, currency: 'SGD', amountSgd: 2400 }, channel: null, payee: null, last4: null, instrument: 'account_transfer' }]),
  }))
  assert.equal(assessment.telco?.code, 'telco_sms')
})

test('a different channel from another answer is put to the person, not decided for them', async () => {
  const { candidates } = answerCandidates([ticked('telco'), { questionKey: 'incident.channel', value: 'whatsapp', revisionId: 'c1' }])
  const finding = (await reconcile(candidates)).find((f) => f.factKey === 'phishing_channel')!
  assert.equal(finding.findingType, 'conflict')
  assert.deepEqual(finding.values.map((v) => v.value).sort(), ['messaging_app', 'sms'])
})
