import assert from 'node:assert/strict'
import test from 'node:test'
import { answerCandidates, buildFactExtractionPrompt, evidenceLists, JOURNEY_KEYS, parseFactExtraction, reconcile } from '../../lib/facts'

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

test('a police report the model calls a scam message is still a police report, and its number and date can conflict (walkthrough, 8 Nov)', async () => {
  const report = 'SINGAPORE POLICE FORCE - Police Report Acknowledgement\nReport No: G/20241031/0000\nDate of report: 31 Oct 2024\n' +
    'Informant states that on 30 Oct 2024 she received an SMS from "Synthetic Bank" and entered her OTP on a link.'
  const doc = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:d1', documentId: 'd1', documentName: 'synthetic.pdf' } }
  const fromDoc = parseFactExtraction({
    document_type: 'scam_message',
    reported_to_police: { value: 'yes', date: '2024-10-31', reference: 'G/20241031/0000', quote: 'Police Report Acknowledgement', confidence: 0.95 },
    phishing_channel: { value: 'sms', quote: 'received an SMS', confidence: 0.9 },
  }, report, doc)
  const police = fromDoc.find((c) => c.factKey === 'reported_to_police')!
  assert.equal((police.sourceRef as { documentType?: string }).documentType, 'police_report')
  assert.equal((police.sourceRef as { context?: boolean }).context, false, 'a police report can state the police facts')

  const fromStory = parseFactExtraction({
    reported_to_police: { value: 'yes', date: '2026-10-04', quote: 'reported it to the bank and the police on 4 October 2026' },
  }, story, source)
  const { candidates: fromAnswers } = answerCandidates([
    { questionKey: JOURNEY_KEYS.policeReport, value: 'yes', revisionId: 'a0' },
    { questionKey: JOURNEY_KEYS.policeReportNumber, value: '123456', revisionId: 'a1' },
  ])
  const findings = await reconcile([...fromDoc, ...fromStory, ...fromAnswers])
  assert.equal(findings.find((f) => f.factKey === 'police_report_number')?.findingType, 'conflict', 'the confirmed number differs from the report')
  assert.equal(findings.find((f) => f.factKey === 'reported_to_police')?.findingType, 'conflict', 'the report date differs from the story')
})

test('a bank letter that asks for a police report is not a police report', () => {
  const letter = 'Synthetic Bank\nDear Customer,\nRe: your report of unauthorised transactions.\nPlease send us a copy of your police report.'
  const doc = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:d2' } }
  const [reply] = parseFactExtraction({ document_type: 'bank_correspondence', bank_reply: { status: 'acknowledged', quote: 'your report of unauthorised transactions', confidence: 0.9 } }, letter, doc)
  assert.equal((reply.sourceRef as { documentType?: string }).documentType, 'bank_correspondence')
})

test('a police report whose number the model left out still states the report and its number (walkthrough, 9 Nov)', async () => {
  const report = 'Police report no. A20990101009999\nSYNTHETIC TEST DOCUMENT\nDate and time of report: 2 January 2099\n' +
    'Brief facts: the informant received an SMS from "Synthetic Bank" and entered a one-time password.'
  const doc = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:d3', documentId: 'd3', documentName: 'synthetic.pdf' } }
  const fromDoc = parseFactExtraction({
    document_type: 'police_report',
    phishing_channel: { value: 'sms', quote: 'received an SMS', confidence: 0.9 },
  }, report, doc)
  const police = fromDoc.find((c) => c.factKey === 'reported_to_police')!
  assert.deepEqual(police.value, { value: 'yes', date: null, reference: 'A20990101009999', channel: null })
  assert.equal((police.sourceRef as { context?: boolean }).context, false)

  const { candidates: fromAnswers } = answerCandidates([
    { questionKey: JOURNEY_KEYS.policeReport, value: 'yes', revisionId: 'a0' },
    { questionKey: JOURNEY_KEYS.policeReportNumber, value: 'A20990101001111', revisionId: 'a1' },
  ])
  const findings = await reconcile([...fromDoc, ...fromAnswers])
  assert.equal(findings.find((f) => f.factKey === 'police_report_number')?.findingType, 'conflict', 'the typed number differs from the report')
  assert.equal(findings.find((f) => f.factKey === 'reported_to_police')?.findingType, 'agreed', 'the report backs the answer')

  const withoutNumber = parseFactExtraction({
    document_type: 'police_report',
    reported_to_police: { value: 'yes', date: null, reference: null, quote: 'Date and time of report', confidence: 0.9 },
  }, report, doc)
  assert.equal((withoutNumber.find((c) => c.factKey === 'reported_to_police')!.value as { reference: string }).reference, 'A20990101009999')
})

test('a reference with no digits is not a case reference (walkthrough, 9 Nov)', async () => {
  const { candidates } = answerCandidates([
    { questionKey: JOURNEY_KEYS.reportedToBank, value: 'yes', revisionId: 'b0' },
    { questionKey: JOURNEY_KEYS.reportedToBankReference, value: 'morning', revisionId: 'b1' },
  ])
  const findings = await reconcile(candidates)
  assert.equal(findings.find((f) => f.factKey === 'bank_case_reference')?.findingType, 'missing')
})

// Part B walk-through, case B (25 Nov), PB-24: the route answer "I complained in writing and haven't had a final reply"
// was kept only as a written complaint, so a final-reply letter met no conflict and the pack followed one of them
// quietly. It is now also "no final reply yet", which agrees with any other reply and conflicts with a final reply.
test('"no final reply" from the FIDReC route conflicts with a final-reply letter, and with nothing else', async () => {
  const route = [
    { questionKey: 'fidrec_route', value: 'no_reply', revisionId: 'r0' },
    { questionKey: 'fidrec_complaint_date', value: '2026-10-04', revisionId: 'r1' },
  ]
  const fromRoute = answerCandidates(route).candidates.filter((c) => c.factKey === 'bank_reply')
  assert.deepEqual(fromRoute.map((c) => (c.value as { status: string }).status), ['not_final'])

  const letterText = 'Synthetic Bank - Final reply to your complaint\nThis is our final reply. You may refer the matter to FIDReC.'
  const letter = parseFactExtraction(
    { document_type: 'bank_correspondence', institutions: [{ name: 'Synthetic Bank', quote: 'Synthetic Bank', confidence: 0.95 }], bank_reply: { status: 'final_reply', date: '2026-11-10', outcome: 'rejected', quote: 'This is our final reply.', confidence: 0.95 } },
    letterText,
    { sourceType: 'document', sourceRef: { sourceKey: 'document:b3', documentId: 'b3' } },
  )
  const clash = (await reconcile([...answerCandidates(route).candidates, ...letter])).find((f) => f.factKey === 'bank_reply')!
  assert.equal(clash.findingType, 'conflict', 'the confirm screen asks which is right')
  assert.deepEqual(clash.values.map((v) => (v.value as { status: string }).status).sort(), ['final_reply', 'not_final'])

  const acknowledged = answerCandidates([...route, { questionKey: JOURNEY_KEYS.bankReplyStatus, value: 'acknowledged', revisionId: 'j0' }]).candidates
  const agreed = (await reconcile(acknowledged)).find((f) => f.factKey === 'bank_reply')!
  assert.notEqual(agreed.findingType, 'conflict')
  assert.deepEqual(agreed.values.map((v) => (v.value as { status: string }).status), ['acknowledged'], 'the more specific answer is kept')

  const alone = (await reconcile(answerCandidates(route).candidates)).find((f) => f.factKey === 'bank_reply')!
  const { missing } = evidenceLists({ bank_reply: { value: alone.values[0].value, label: 'confirmed' } }, [])
  assert.deepEqual(missing, [], '"no final reply yet" needs no document')
})
