import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildChronologyEvents, type BuildChronologyEventsInput } from '../../lib/server/fidrec/build-chronology-events'
import type { EvidenceLabel, FidrecEvidenceType } from '../../lib/types/fidrec-evidence-labels'

// The chronology builder reads any case's evidence by general patterns (CLAUDE.md: no real-case data in the repo;
// Elena, 21 Nov 2026). Everything below is invented: the bank, payees, dates, amounts and file names.

type Doc = { type: FidrecEvidenceType; title: string; text: string; filename?: string }

function input(docs: Doc[], narrative = ''): BuildChronologyEventsInput {
  const evidenceLabels: EvidenceLabel[] = docs.map((doc, index) => ({
    evidence_id: `ev-${index + 1}`,
    case_document_id: `doc-${index + 1}`,
    label: `E${index + 1}`,
    label_number: index + 1,
    title: doc.title,
    evidence_type: doc.type,
    original_filename: doc.filename ?? `synthetic-${index + 1}.png`,
    document_date: null,
    uploaded_at: null,
    short_description: '',
    source_confidence: 'high',
    linked_finding_ids: [],
    linked_theme_ids: [],
    linked_evidence_request_ids: [],
  }))
  return {
    findings: [],
    assertions: [],
    evidenceLabels,
    evidenceReviewModel: {} as BuildChronologyEventsInput['evidenceReviewModel'],
    documentPresentationById: new Map(
      docs.map((doc, index) => [
        `doc-${index + 1}`,
        { verifiedProcessedType: null, predictedProcessedType: null, extractedText: doc.text },
      ]),
    ),
    primaryNarrative: narrative,
  }
}

const tokenFirst: Doc = {
  type: 'token_registration_record',
  title: 'Token SMS',
  text: 'You are setting up your digital token on 03/03 21:05. For your security, some transactions are held for 12 hours.',
}
const tokenAgain: Doc = {
  type: 'token_registration_record',
  title: 'Token SMS',
  text: 'A digital token was registered on 04/03 06:40.',
}
const limitSms: Doc = {
  type: 'sms_or_email_alert',
  title: 'Limit SMS',
  text: 'You have increased your daily transfer limit to SGD 25,000 on 04/03 09:10.',
}
const transfers: Doc[] = [
  { type: 'sms_or_email_alert', title: 'Alert', text: 'Successful PayNow transfer of SGD 4,000.00 to ALPHA TRADING PTE LTD on 4 Mar 09:31 SGT.' },
  { type: 'sms_or_email_alert', title: 'Alert', text: 'Successful PayNow transfer of SGD 3,500.00 to BETA GOODS on 4 Mar 09:58 SGT.' },
]

test('limit change and the transfers after it are read from any dates, amounts and payees', () => {
  const { events } = buildChronologyEvents(input([tokenFirst, tokenAgain, limitSms, ...transfers]))
  const limit = events.find((event) => event.event_type === 'limit_change')
  assert.ok(limit, 'limit change event')
  assert.match(limit.event_text, /increased to S\$25000/)
  assert.match(limit.event_text, /registered on 3 March/)
  assert.match(limit.event_text, /transfers to ALPHA TRADING PTE LTD and BETA GOODS occurred between 09:10 and 09:58 on the same day/)
  assert.equal(events.some((event) => event.event_type === 'fraud_transactions'), false, 'transfers fold into the limit change')
  const token = events.find((event) => event.event_type === 'token_registration')
  assert.ok(token)
})

test('the later registration is the one reported as registered again', () => {
  const phishing: Doc = { type: 'screenshot', title: 'Email', text: 'Phishing email: Your digital token has expired. 3 Mar 2026 20:47' }
  const { events } = buildChronologyEvents(input([phishing, tokenFirst, tokenAgain]))
  const token = events.find((event) => event.event_type === 'token_registration')
  assert.ok(token)
  assert.match(token.event_text, /registered again .* on 4 March/)
  assert.deepEqual(token.supporting_evidence, ['E3'])
})

test('without a stated amount the sentence names none; there is no default limit', () => {
  const noAmount: Doc = { type: 'sms_or_email_alert', title: 'Limit SMS', text: 'Your daily transfer limit was changed on 04/03 09:10. Ref S$ only.' }
  const { events } = buildChronologyEvents(input([noAmount], 'The daily transfer limit was changed.'))
  const limit = events.find((event) => event.event_type === 'limit_change')
  assert.ok(limit)
  assert.doesNotMatch(limit.event_text, /S\$\d/)
})

test('a hotline call is recognised by any 1800 number, not by a file name', () => {
  const call: Doc = { type: 'screenshot', title: 'Call log', text: '1800 222 3333\n10:15 Outgoing Call\n4 Mar 2026' }
  const { events } = buildChronologyEvents(input([...transfers, call]))
  assert.ok(events.some((event) => event.event_type === 'hotline_call' || event.event_type === 'fraud_discovery'))
})

test('the builder holds no file names, phone numbers or fixed amounts', () => {
  const source = readFileSync('lib/server/fidrec/build-chronology-events.ts', 'utf8')
  for (const pattern of [/[\w-]+\\?\.pdf\b/i, /\b1800[\s-]\d{3}[\s-]\d{4}\b/, /"\d{4,}"/]) {
    assert.doesNotMatch(source, pattern, String(pattern))
  }
})

// The real case's values are kept outside the repository (CLAUDE.md, personal data): one regular expression per line
// in the file named by GUIDEBUOY_CHRONOLOGY_FORBIDDEN_PATTERNS. Skipped when it is not set.
const forbiddenPatternsPath = process.env.GUIDEBUOY_CHRONOLOGY_FORBIDDEN_PATTERNS
test('no case-specific values stay in the builder (private list)', { skip: !forbiddenPatternsPath }, () => {
  const source = readFileSync('lib/server/fidrec/build-chronology-events.ts', 'utf8')
  const patterns = readFileSync(forbiddenPatternsPath!, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  assert.ok(patterns.length > 0, 'the private list is empty')
  for (const [index, line] of patterns.entries()) {
    assert.doesNotMatch(source, new RegExp(line, 'i'), `private pattern ${index + 1}`)
  }
})
