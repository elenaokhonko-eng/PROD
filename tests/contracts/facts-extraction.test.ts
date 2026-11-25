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

// Part B walk-through, 25 Nov: a statement headed by its bank gave the payments but not the bank, so "Banks involved"
// was listed as having no document.
test('the bank that issued a statement is named from its heading, never from its transaction lines', () => {
  assert.match(buildFactExtractionPrompt('document', 'x'), /the bank or provider that issued a statement, alert or letter is one of them/)
  const statement = 'OCBC Statement of Account\n03 Oct 2026 FAST transfer to UOB account S$2,400.00\n04 Oct 2026 GrabPay top-up S$50.00'
  const doc = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:d4', documentId: 'd4' } }
  const transactions = { amount: 2400, currency: 'SGD', date: '2026-10-03', payee: null, card_last4: null, instrument: 'account_transfer', quote: 'FAST transfer to UOB account', confidence: 0.9 }
  const fromDoc = parseFactExtraction({ document_type: 'bank_statement', institutions: [], transactions: [transactions] }, statement, doc)
  const institutions = fromDoc.filter((c) => c.factKey === 'institution_names')
  assert.equal(institutions.length, 1)
  assert.deepEqual(institutions[0].value, [{ name: 'OCBC', type: 'bank' }], 'the issuer only: not the payee bank or the e-wallet')
  assert.equal((institutions[0].sourceRef as { context?: boolean }).context, false, 'it counts as shown by the statement')
  assert.deepEqual((institutions[0].sourceRef as { quotes?: string[] }).quotes, ['OCBC'])
})

test('the heading backstop adds nothing when the model named the bank, when the heading names no known bank, or for other documents', () => {
  const doc = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:d5' } }
  const synthetic = 'Synthetic Bank - Statement of account Account: Savings ending 0000 03 Oct 2026 Transfer to DBS S$2,400.00 debit'
  const named = parseFactExtraction({ document_type: 'bank_statement', institutions: [{ name: 'Synthetic Bank', quote: 'Synthetic Bank', confidence: 0.95 }] }, synthetic, doc)
  assert.deepEqual(named.filter((c) => c.factKey === 'institution_names').map((c) => c.value), [[{ name: 'Synthetic Bank', type: 'other' }]])
  const unnamed = parseFactExtraction({ document_type: 'bank_statement', institutions: [] }, synthetic, doc)
  assert.equal(unnamed.filter((c) => c.factKey === 'institution_names').length, 0, 'an unknown name is not guessed, and DBS after the date is a payee')
  const report = 'DBS customer reported a scam\nThe informant transferred S$2,400.'
  const police = parseFactExtraction({ document_type: 'police_report', institutions: [] }, report, doc)
  assert.equal(police.filter((c) => c.factKey === 'institution_names').length, 0)
})
