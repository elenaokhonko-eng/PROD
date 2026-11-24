import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFactExtractionPrompt,
  DOCUMENT_TYPES,
  documentTypeOf,
  type FactCandidate,
  FACT_EXTRACTION_PROMPT_VERSION,
  looksLikeRecord,
  normaliseDateTime,
  normaliseIpText,
  parseFactExtraction,
} from '../../lib/facts'
import type { AccessEvent, CardAuthEvent } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { TECHNICAL_RECORD_DOCUMENT_TYPES } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { accountSrfCase, cardOnlyCase } from '../fixtures/fidrec-update/index.ts'

// FIDReC update, Lane 2 (brief v5, Phase 3): the two technical-record document types and the new facts, extracted
// from synthetic records only. Records are built as text here from the synthetic cases: IP addresses from the
// documentation ranges, invented device and token references. CLAUDE.md: nothing from a real case.

const doc = (documentId: string) => ({ sourceType: 'document' as const, sourceRef: { sourceKey: `document:${documentId}`, documentId } })
const local = (iso: string | null) => (iso ? iso.slice(0, 19).replace('T', ' ') : '-')
const cell = (v: string | null) => v ?? '-'
const byKey = (candidates: FactCandidate[], key: string) => candidates.filter((c) => c.factKey === key)

// ---- A synthetic access record (Example Bank A), one line per event, times without a zone as many records give them.
const accessEvents = accountSrfCase.data.facts.access_events!.value as AccessEvent[]
const accessLine = (e: AccessEvent) =>
  [local(e.timestamp), e.kind, cell(e.deviceLabel), cell(e.deviceRef), cell(e.ip), cell(e.channel), cell(e.authorisedBy), cell(e.sentTo)].join(' | ')
const accessRecord = [
  'EXAMPLE BANK A - DIGITAL BANKING ACCESS LOG (SYNTHETIC)',
  'Time | Event | Device | Device ID | IP address | Channel | Authorised by | Sent to',
  ...accessEvents.map(accessLine),
].join('\n')
const accessModelOutput = {
  document_type: 'bank_access_record',
  access_events: accessEvents.map((e) => ({
    timestamp: local(e.timestamp),
    kind: e.kind,
    device_label: e.deviceLabel,
    device_ref: e.deviceRef,
    ip: e.ip,
    channel: e.channel,
    authorised_by: e.authorisedBy,
    sent_to: e.sentTo,
    quote: accessLine(e),
    confidence: 0.95,
  })),
}

// ---- A synthetic card authentication record (Example Bank A, card ending 0001).
const cardEvents = cardOnlyCase.data.facts.card_auth_events!.value as CardAuthEvent[]
const cardLine = (e: CardAuthEvent) =>
  [local(e.timestamp), cell(e.merchant), e.entryMode, e.authentication, e.authenticationResult, cell(e.deviceLabel), cell(e.deviceRef), cell(e.tokenRef),
    e.walletProvisionedAt ? `wallet ${local(e.walletProvisionedAt)} on ${e.walletDeviceLabel}` : '-'].join(' | ')
const cardRecord = ['EXAMPLE BANK A - CARD AUTHENTICATION RECORD (SYNTHETIC), CARD ENDING 0001', ...cardEvents.map(cardLine)].join('\n')
const cardModelOutput = {
  document_type: 'card_authentication_record',
  card_auth_events: cardEvents.map((e) => ({
    timestamp: local(e.timestamp),
    card_scheme: e.cardScheme,
    merchant: e.merchant,
    merchant_country: e.merchantCountry,
    entry_mode: e.entryMode,
    authentication: e.authentication,
    authentication_result: e.authenticationResult,
    sent_to: e.sentTo,
    device_label: e.deviceLabel,
    device_ref: e.deviceRef,
    token_ref: e.tokenRef,
    wallet_provisioned_at: e.walletProvisionedAt ? local(e.walletProvisionedAt) : null,
    wallet_device_label: e.walletDeviceLabel,
    wallet_provisioning_authentication: e.walletProvisioningAuthentication,
    wallet_provisioning_sent_to: e.walletProvisioningSentTo,
    wallet_token_removed_at: e.walletTokenRemovedAt ? local(e.walletTokenRemovedAt) : null,
    quote: cardLine(e),
    confidence: 0.9,
  })),
}

test('the two technical-record types are document types, and the prompt version moved on', () => {
  for (const type of TECHNICAL_RECORD_DOCUMENT_TYPES) assert.ok((DOCUMENT_TYPES as readonly string[]).includes(type))
  assert.equal(FACT_EXTRACTION_PROMPT_VERSION, 'fact-extract-v4')
})

test('a document prompt asks for the record lines and says how to type a record; a story prompt does not', () => {
  const documentPrompt = buildFactExtractionPrompt('document', accessRecord)
  assert.match(documentPrompt, /bank_access_record/)
  assert.match(documentPrompt, /card_authentication_record/)
  assert.match(documentPrompt, /"access_events"/)
  assert.match(documentPrompt, /"card_auth_events"/)
  assert.match(documentPrompt, /a letter\s+that only describes such events in prose is bank_correspondence/)
  const storyPrompt = buildFactExtractionPrompt('story', 'Synthetic story.')
  assert.doesNotMatch(storyPrompt, /"access_events"|"card_auth_events"|"institution_fault_label"/)
  assert.match(storyPrompt, /"card_dispute_requested"/)
})

test('an access record yields the access events of the synthetic case, line by line', () => {
  const candidates = parseFactExtraction(accessModelOutput, accessRecord, doc('access-1'))
  const [access] = byKey(candidates, 'access_events')
  assert.ok(access)
  assert.equal(access.sourceRef.documentType, 'bank_access_record')
  assert.equal(access.sourceRef.context, false)
  // Zone-less times are read as Singapore time; the payment links are made later, against the confirmed payments.
  assert.deepEqual(access.value, accessEvents.map((e) => ({ ...e, relatedTransactionIndex: null })))
  assert.equal((access.sourceRef.quotes as string[]).length, accessEvents.length)
})

test('a card authentication record yields the card events of the synthetic case', () => {
  const candidates = parseFactExtraction(cardModelOutput, cardRecord, doc('card-1'))
  const [card] = byKey(candidates, 'card_auth_events')
  assert.ok(card)
  assert.equal(card.sourceRef.documentType, 'card_authentication_record')
  assert.equal(card.sourceRef.context, false)
  assert.deepEqual(card.value, cardEvents.map((e) => ({ ...e, transactionIndex: null })))
})

test('identifiers the record does not contain word for word are dropped, never guessed', () => {
  const line = accessLine(accessEvents[1])
  const candidates = parseFactExtraction({
    document_type: 'bank_access_record',
    access_events: [
      { ...accessModelOutput.access_events[1], ip: '203.0.113.99', device_ref: 'dev-ex-9999' },
      { ...accessModelOutput.access_events[1], kind: 'teleported' },
      { ...accessModelOutput.access_events[1], quote: 'a line the record does not have' },
      { ...accessModelOutput.access_events[1], ip: 'not-an-address' },
      // An address and a device that are in the record, but on another line.
      { ...accessModelOutput.access_events[1], ip: accessEvents[5].ip, device_ref: accessEvents[5].deviceRef },
    ],
  }, `${accessRecord}\n${line}`, doc('access-2'))
  const [access] = byKey(candidates, 'access_events')
  const events = access.value as AccessEvent[]
  assert.equal(events.length, 3, 'an unknown kind and an unquoted line are dropped')
  assert.equal(events[0].ip, null)
  assert.equal(events[0].deviceRef, null)
  assert.equal(events[0].deviceLabel, accessEvents[1].deviceLabel)
  assert.equal(events[1].ip, null)
  assert.ok(accessRecord.includes(accessEvents[5].ip!))
  assert.equal(events[2].ip, null)
  assert.equal(events[2].deviceRef, null)
})

test('a letter that only describes logins in prose stays bank_correspondence; its events are context only', () => {
  const letter =
    'Dear Customer, we refer to your complaint. Our records show that a digital token was activated on a new device ' +
    'on 3 July 2025 and that payments were then approved with it. Yours faithfully, Example Bank A (synthetic).'
  assert.equal(looksLikeRecord(letter), false)
  assert.equal(documentTypeOf('bank_access_record', letter), 'bank_correspondence')
  const candidates = parseFactExtraction({
    document_type: 'bank_access_record',
    access_events: [{ timestamp: '2025-07-03', kind: 'token_activated', quote: 'a digital token was activated on a new device', confidence: 0.9 }],
  }, letter, doc('letter-1'))
  const [access] = byKey(candidates, 'access_events')
  assert.equal(access.sourceRef.documentType, 'bank_correspondence')
  assert.equal(access.sourceRef.context, true, 'kept for the record, never compared')
})

test('only the two record types can state the record lists; a statement cannot, and a story is never asked', () => {
  const statementCandidates = parseFactExtraction({ ...accessModelOutput, document_type: 'bank_statement' }, accessRecord, doc('statement-1'))
  assert.equal(byKey(statementCandidates, 'access_events')[0].sourceRef.context, true)
  const storyCandidates = parseFactExtraction(accessModelOutput, accessRecord, { sourceType: 'story', sourceRef: { sourceKey: 'story:r1' } })
  assert.equal(byKey(storyCandidates, 'access_events').length, 0)
})

test('a low-confidence record line is context only', () => {
  const output = { ...accessModelOutput, access_events: accessModelOutput.access_events.map((e) => ({ ...e, confidence: 0.4 })) }
  const [access] = byKey(parseFactExtraction(output, accessRecord, doc('access-3')), 'access_events')
  assert.equal(access.sourceRef.context, true)
})

test("the institution's letter: dispute response, its word for the conduct, the alert threshold, the token method", () => {
  const letter = [
    'Example Bank A (synthetic) - Final reply, 20 October 2025',
    'We have declined to raise a dispute with the merchants because the payments were authenticated with the registered digital token.',
    'We consider that you were grossly negligent in entering your card details and a one-time code on a website reached from a message.',
    'Your digital token was activated with an SMS code sent to your registered mobile number.',
    'Transaction alerts are sent for payments above S$500, the threshold you set.',
    'You asked us on 20 September 2025 for the records of logins and devices on your account.',
  ].join('\n')
  const candidates = parseFactExtraction({
    document_type: 'bank_correspondence',
    card_dispute_response: { status: 'declined', date: '2025-10-20', reason_stated: 'the payments were authenticated with the registered digital token', outcome: null, quote: 'We have declined to raise a dispute with the merchants', confidence: 0.9 },
    institution_fault_label: { label: 'grossly negligent', conduct: 'entering card details and a one-time code on a website reached from a message', quote: 'you were grossly negligent in entering your card details', confidence: 0.9 },
    token_activation_method: { value: 'sms_code', quote: 'Your digital token was activated with an SMS code', confidence: 0.9 },
    transaction_alert_threshold: { amount: 500, currency: 'SGD', set_by: 'account_holder', quote: 'Transaction alerts are sent for payments above S$500, the threshold you set', confidence: 0.9 },
    access_record_requested: { value: 'yes', date: '2025-09-20', quote: 'You asked us on 20 September 2025 for the records of logins and devices', confidence: 0.9 },
  }, letter, doc('letter-2'))
  const value = (key: string) => byKey(candidates, key)[0]?.value
  assert.deepEqual(value('card_dispute_response'), { status: 'declined', date: '2025-10-20', reasonStated: 'the payments were authenticated with the registered digital token', outcome: null })
  assert.deepEqual(value('institution_fault_label'), { label: 'grossly negligent', labelEvidenceId: null, conduct: 'entering card details and a one-time code on a website reached from a message', conductEvidenceId: null })
  assert.equal(value('token_activation_method'), 'sms_code')
  assert.deepEqual(value('transaction_alert_threshold'), { amount: { amount: 500, currency: 'SGD', amountSgd: 500 }, setBy: 'account_holder' })
  assert.deepEqual(value('access_record_requested'), { value: 'yes', date: '2025-09-20', reference: null, channel: null })
  for (const c of candidates) assert.equal(c.sourceRef.context, false, `${c.factKey} is something a bank letter can state`)
})

test("the fault label must be the letter's own word, inside the quote", () => {
  const letter = 'Example Bank A (synthetic): we consider that you did not take reasonable care of your card details.'
  const candidates = parseFactExtraction({
    document_type: 'bank_correspondence',
    institution_fault_label: { label: 'reckless', conduct: null, quote: 'you did not take reasonable care of your card details' },
  }, letter, doc('letter-3'))
  assert.equal(byKey(candidates, 'institution_fault_label').length, 0)
})

test('the balance before the first disputed payment comes from a bank statement only', () => {
  const statement = 'Example Bank A (synthetic) statement\n03 Jul 2025 21:00 Balance brought forward 62,500.00\n03 Jul 2025 21:40 FAST transfer 18,000.00 44,500.00'
  const output = { document_type: 'bank_statement', balance_before_first_disputed_payment: { amount: 62500, currency: 'SGD', quote: 'Balance brought forward 62,500.00', confidence: 0.9 } }
  const [fromStatement] = byKey(parseFactExtraction(output, statement, doc('statement-2')), 'balance_before_first_disputed_payment')
  assert.equal(fromStatement.sourceRef.context, false)
  assert.deepEqual(fromStatement.value, { amount: 62500, currency: 'SGD', amountSgd: 62500 })
  const [fromLetter] = byKey(parseFactExtraction({ ...output, document_type: 'bank_correspondence' }, statement, doc('letter-4')), 'balance_before_first_disputed_payment')
  assert.equal(fromLetter.sourceRef.context, true)
})

test('a story can say the complainant asked for a card dispute, and nothing the institution recorded', () => {
  const story = 'On 14 September 2025 I emailed Example Bank A asking them to dispute the three card payments.'
  const candidates = parseFactExtraction({
    card_dispute_requested: { value: 'yes', date: '2025-09-14', channel: 'email', quote: 'I emailed Example Bank A asking them to dispute the three card payments' },
    card_dispute_response: { status: 'declined', quote: 'asking them to dispute' },
    token_activation_method: { value: 'sms_code', quote: 'I emailed' },
  }, story, { sourceType: 'story', sourceRef: { sourceKey: 'story:r2' } })
  assert.deepEqual(candidates.map((c) => c.factKey), ['card_dispute_requested'])
  assert.deepEqual(candidates[0].value, { value: 'yes', date: '2025-09-14', reference: null, channel: 'email' })
})

test('record times: offsets kept, zone-less read as Singapore time, impossible times refused', () => {
  assert.equal(normaliseDateTime('2025-07-03 21:05'), '2025-07-03T21:05:00+08:00')
  assert.equal(normaliseDateTime('2025-07-03T13:05:00Z'), '2025-07-03T13:05:00+00:00')
  assert.equal(normaliseDateTime('2025-07-03T21:05:00+0800'), '2025-07-03T21:05:00+08:00')
  assert.equal(normaliseDateTime('2025-02-30 10:00'), null)
  assert.equal(normaliseDateTime('2025-07-03 25:00'), null)
  assert.equal(normaliseDateTime('3 July 2025'), null)
})

test('IP addresses: v4 and v6 accepted as written, anything else refused', () => {
  assert.equal(normaliseIpText(' 192.0.2.150 '), '192.0.2.150')
  assert.equal(normaliseIpText('2001:DB8::1'), '2001:db8::1')
  assert.equal(normaliseIpText('192.0.2.256'), null)
  assert.equal(normaliseIpText('2001:db8::1::2'), null)
  assert.equal(normaliseIpText('dev-ex-0002'), null)
})
