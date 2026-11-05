import assert from 'node:assert/strict'
import test from 'node:test'
import { answerCandidates, buildFactExtractionPrompt, JOURNEY_KEYS, parseFactExtraction, reconcile } from '../../lib/facts'

// Synthetic content only.
const story =
  'On 3 October 2026 I got an SMS from "Synthetic Bank" saying my account was locked. I clicked the link and ' +
  'entered my login and OTP on the website. S$2,400 was transferred out the same day. I reported it to the bank ' +
  'and the police on 4 October 2026.'

const source = { sourceType: 'story' as const, sourceRef: { sourceKey: 'story:r1', storyRevision: 1 } }

test('the extraction prompt carries one source and forbids reconciling', () => {
  const prompt = buildFactExtractionPrompt('story', story)
  assert.match(prompt, /ONE source/)
  assert.match(prompt, /do not try to reconcile/)
  assert.ok(prompt.endsWith(story))
})

test('model output is normalised and each value keeps its quote', () => {
  const candidates = parseFactExtraction({
    institutions: [{ name: 'Synthetic Bank', quote: 'an SMS from "Synthetic Bank"' }],
    phishing_channel: { value: 'sms', quote: 'I got an SMS' },
    credentials: { value: 'entered_on_fake_site_or_app', quote: 'entered my login and OTP on the website' },
    transactions: [{ date: '2026-10-03', amount: 2400, currency: 'SGD', instrument: 'account_transfer', quote: 'S$2,400 was transferred out' }],
    reported_to_police: { value: 'yes', date: '2026-10-04', quote: 'reported it to the bank and the police on 4 October 2026' },
  }, story, source)
  const keys = candidates.map((c) => c.factKey).sort()
  assert.deepEqual(keys, ['credentials_or_otp_shared', 'institution_names', 'phishing_channel', 'reported_to_police', 'transactions'])
  const police = candidates.find((c) => c.factKey === 'reported_to_police')!
  assert.deepEqual(police.value, { value: 'yes', date: '2026-10-04', reference: null, channel: null })
  assert.deepEqual((police.sourceRef as { quotes: string[] }).quotes, ['reported it to the bank and the police on 4 October 2026'])
})

test('a value whose quote is not in the source is dropped (no invented facts)', () => {
  const candidates = parseFactExtraction({
    total_loss: { amount: 9000, currency: 'SGD', quote: 'I lost S$9,000 in total' },
    reported_to_police: { value: 'no', quote: 'I did not go to the police' },
    phishing_channel: { value: 'carrier_pigeon', quote: 'I got an SMS' },
  }, story, source)
  assert.deepEqual(candidates, [])
})

test('garbage model output yields no candidates instead of throwing', () => {
  for (const raw of [null, 'text', [], { transactions: 'none', institutions: [{}] }]) {
    assert.deepEqual(parseFactExtraction(raw, story, source), [])
  }
})

test('answers map without a model; conflicting answers to different questions both survive', async () => {
  const rows = [
    { questionKey: 'institution_name', value: 'Synthetic Bank', revisionId: 'a1' },
    { questionKey: 'previous_contact', value: 'No', revisionId: 'a2' },
    { questionKey: JOURNEY_KEYS.reportedToBank, value: 'yes', revisionId: 'a3' },
    { questionKey: JOURNEY_KEYS.reportedToBankDate, value: '2026-10-04', revisionId: 'a4' },
    { questionKey: JOURNEY_KEYS.bankReplyStatus, value: 'final_reply', revisionId: 'a5' },
    { questionKey: JOURNEY_KEYS.bankReplyDate, value: '28/10/2026', revisionId: 'a6' },
    { questionKey: JOURNEY_KEYS.finalReplyQualifies, value: 'Not sure', revisionId: 'a7' },
    { questionKey: 'financial_impact', value: 'about two and a half thousand', revisionId: 'a8' },
    { questionKey: 'incident.channel', value: 'whatsapp', revisionId: 'a9' },
  ]
  const { candidates, freeText } = answerCandidates(rows)
  const reply = candidates.find((c) => c.factKey === 'bank_reply')!
  assert.deepEqual(reply.value, { status: 'final_reply', date: '2026-10-28', outcome: null, qualifies: 'unsure', reference: null })
  assert.deepEqual(candidates.find((c) => c.factKey === 'phishing_channel')!.value, 'messaging_app')
  assert.deepEqual(freeText.map((r) => r.questionKey), ['financial_impact'], 'unparsable free text goes to the model')

  const bank = (await reconcile(candidates)).find((f) => f.factKey === 'reported_to_bank')!
  assert.equal(bank.findingType, 'conflict', 'intake "No" vs journey "Yes" is shown to the user')
})

test('answer-only facts become findings without comparison', async () => {
  const { candidates } = answerCandidates([
    { questionKey: JOURNEY_KEYS.fidrecFiled, value: 'No', revisionId: 'b1' },
  ])
  const fidrec = (await reconcile(candidates)).find((f) => f.factKey === 'fidrec_filed')!
  assert.equal(fidrec.findingType, 'agreed')
})
