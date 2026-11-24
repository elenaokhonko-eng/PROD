import assert from 'node:assert/strict'
import test from 'node:test'
import {
  answerDevices,
  buildSnapshot,
  canStateUpdateFact,
  type CurrentFinding,
  deviceKey,
  devicesInRecords,
  type FactCandidate,
  factsYouConfirmed,
  formatFactValue,
  linkRecordsToTransactions,
  reconcile,
  type ReconciledFinding,
  requiredFactsFor,
  type Transaction,
  validateFactValue,
} from '../../lib/facts'
import { findingsForStage, stageSnapshot } from '../../lib/server/facts/facts-service'
import type { AccessEvent, CardAuthEvent, DeviceRecognition } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { accountSrfCase, cardOnlyCase, mixedCase, noTechnicalRecordsCase } from '../fixtures/fidrec-update/index.ts'

// FIDReC update, Lane 2 (brief v5, 3b): how the new facts are reconciled, the device list the confirm screen asks
// about, and how they reach (or stay out of) each stage's snapshot. Synthetic cases only.

const value = <T>(c: { data: { facts: Record<string, unknown> } }, key: string) => (c.data.facts[key] as { value: T } | undefined)?.value as T
const record = (factKey: string, v: unknown, documentType = 'bank_access_record', documentId = 'd1'): FactCandidate =>
  ({ factKey, value: v, sourceType: 'document', sourceRef: { sourceKey: `document:${documentId}`, documentId, documentType, confidence: 0.9, context: false } }) as FactCandidate
const story = (factKey: string, v: unknown): FactCandidate =>
  ({ factKey, value: v, sourceType: 'story', sourceRef: { sourceKey: 'story:r1' } }) as FactCandidate
const find = (findings: ReconciledFinding[], key: string) => findings.find((f) => f.factKey === key)

const srfAccess = value<AccessEvent[]>(accountSrfCase, 'access_events')
const cardAccess = value<AccessEvent[]>(cardOnlyCase, 'access_events')
const cardEvents = value<CardAuthEvent[]>(cardOnlyCase, 'card_auth_events')

const current = (findings: ReconciledFinding[], resolved: Partial<Record<string, CurrentFinding['resolution']>> = {}): CurrentFinding[] =>
  findings.map((f, i) => ({
    id: `f${i}`,
    factKey: f.factKey,
    findingType: f.findingType,
    values: f.values,
    status: f.findingType === 'agreed' || resolved[f.factKey] ? 'resolved' : 'open',
    resolution: resolved[f.factKey] ?? (f.findingType === 'agreed' ? { kind: 'agreed' } : null),
  }))

test('the device list: one entry per device, first seen at its earliest line, a wallet device matched by its label', () => {
  const devicesOf = (c: typeof mixedCase | typeof cardOnlyCase | typeof accountSrfCase) =>
    devicesInRecords(value<AccessEvent[]>(c, 'access_events') ?? [], value<CardAuthEvent[]>(c, 'card_auth_events') ?? [])
  const answered = (c: typeof mixedCase | typeof cardOnlyCase | typeof accountSrfCase) =>
    value<DeviceRecognition[]>(c, 'device_recognition').map(({ answer: _answer, ...d }) => d)
  for (const c of [accountSrfCase, cardOnlyCase]) assert.deepEqual(devicesOf(c), answered(c), c.id)
  // The mixed case's card is added to a wallet on a phone that appears nowhere else in the records. It is a distinct
  // device, so it is asked about too (the fixture lists only the access record's device; reported to Lane 6).
  assert.deepEqual(devicesOf(mixedCase), [
    ...answered(mixedCase),
    { deviceRef: null, deviceLabel: 'Phone model EX-400', firstSeenAt: '2025-05-20T11:00:00+08:00' },
  ])
  assert.deepEqual(devicesInRecords([], []), [])
})

test('two records of one account are combined; the same line saying different things is a conflict', async () => {
  const early = srfAccess.slice(0, 5)
  const late = srfAccess.slice(3)
  const findings = await reconcile([record('access_events', early, 'bank_access_record', 'd1'), record('access_events', late, 'bank_access_record', 'd2')])
  const access = find(findings, 'access_events')!
  assert.equal(access.findingType, 'agreed')
  assert.deepEqual(access.values[0].value, srfAccess)
  assert.equal(access.values[0].sources.length, 2)

  const changed = late.map((e, i) => (i === 0 ? { ...e, ip: '192.0.2.200' } : e))
  const conflict = await reconcile([record('access_events', early, 'bank_access_record', 'd1'), record('access_events', changed, 'bank_access_record', 'd2')])
  assert.equal(find(conflict, 'access_events')!.findingType, 'conflict')
})

test('only a technical record states the record lists; only a document states what the institution did', async () => {
  assert.equal(canStateUpdateFact(record('access_events', srfAccess, 'bank_correspondence')), false)
  assert.equal(canStateUpdateFact(record('card_auth_events', cardEvents, 'card_authentication_record')), true)
  assert.equal(canStateUpdateFact(story('card_dispute_response', { status: 'declined', date: null, reasonStated: null, outcome: null })), false)
  assert.equal(canStateUpdateFact(story('card_dispute_requested', { value: 'yes', date: null, reference: null, channel: null })), true)
  const findings = await reconcile([
    record('access_events', srfAccess, 'bank_correspondence'),
    story('institution_fault_label', { label: 'negligent', labelEvidenceId: null, conduct: null, conductEvidenceId: null }),
  ])
  assert.equal(find(findings, 'access_events'), undefined)
  assert.equal(find(findings, 'institution_fault_label'), undefined)
  assert.equal(find(findings, 'device_recognition'), undefined)
})

test('a case with no technical records gets no new findings, so nothing new is asked', async () => {
  const findings = await reconcile([story('reported_to_bank', { value: 'yes', date: '2025-08-01', reference: null, channel: null })])
  for (const key of ['access_events', 'card_auth_events', 'device_recognition', 'card_dispute_response', 'token_activation_method']) {
    assert.equal(find(findings, key), undefined, key)
  }
  assert.equal(noTechnicalRecordsCase.shape.hasAccessRecord, false)
})

test('the device finding lists the devices and changes when a record adds one', async () => {
  const one = await reconcile([record('access_events', cardAccess), record('card_auth_events', cardEvents, 'card_authentication_record', 'd2')])
  const devices = find(one, 'device_recognition')!
  assert.equal(devices.findingType, 'missing')
  assert.deepEqual(devices.values[0].value, devicesInRecords(cardAccess, cardEvents))
  assert.equal(devices.values[0].sources.length, 2)
  const two = await reconcile([record('access_events', [...cardAccess, { ...cardAccess[2], timestamp: '2025-09-14T10:00:00+08:00', deviceRef: 'dev-ex-0199', deviceLabel: 'Tablet model EX-T9' }])])
  assert.notEqual(find(two, 'device_recognition')!.valuesHash, devices.valuesHash)
})

test('device answers: one per listed device, labels and times from the records, never from the request', () => {
  const recorded = devicesInRecords(srfAccess, [])
  const answers = answerDevices(recorded, [
    { deviceRef: 'dev-ex-0004', deviceLabel: 'forged label', answer: 'not_sure' },
    { deviceRef: 'dev-ex-0002', deviceLabel: null, answer: 'not_mine' },
    { deviceRef: 'dev-ex-0003', deviceLabel: null, answer: 'not_mine' },
  ])
  assert.deepEqual(answers, value<DeviceRecognition[]>(accountSrfCase, 'device_recognition'))
  assert.equal(answerDevices(recorded, [{ deviceRef: 'dev-ex-0002', answer: 'mine' }]), null, 'every device needs an answer')
  assert.equal(answerDevices(recorded, [...recorded.map((d) => ({ ...d, answer: 'mine' })), { deviceRef: 'dev-ex-0999', deviceLabel: null, answer: 'mine' }]), null, 'no unlisted device')
  assert.equal(answerDevices(recorded, recorded.map((d) => ({ ...d, answer: 'probably' }))), null)
  assert.equal(answerDevices(recorded, recorded.map((d, i) => ({ ...d, answer: 'mine', deviceRef: i === 0 ? recorded[1].deviceRef : d.deviceRef }))), null, 'no device answered twice')
  // A device known only by its label.
  const byLabel = [{ deviceRef: null, deviceLabel: 'Phone model EX-300', firstSeenAt: null }]
  assert.deepEqual(answerDevices(byLabel, [{ deviceRef: null, deviceLabel: 'phone model ex-300 ', answer: 'mine' }]), [{ ...byLabel[0], answer: 'mine' }])
  assert.equal(deviceKey(byLabel[0]), 'label:phone model ex-300')
  // Device answers are never typed in as a plain value.
  assert.equal(validateFactValue('device_recognition', answers), null)
  assert.equal(validateFactValue('access_events', srfAccess), null)
})

test('the paid stages need the device answers once a record lists a device; the free stage never sees the new facts', async () => {
  assert.ok(requiredFactsFor('bank', null).includes('device_recognition'))
  assert.ok(requiredFactsFor('fidrec', null).includes('device_recognition'))
  assert.ok(!requiredFactsFor('free', null).includes('device_recognition'))

  const findings = current(await reconcile([record('access_events', srfAccess)]))
  const blocked = (stage: 'free' | 'bank' | 'fidrec') => stageSnapshot(findings, stage).blocks.map((b) => b.factKey as string)
  assert.ok(blocked('bank').includes('device_recognition'))
  assert.ok(blocked('fidrec').includes('device_recognition'))
  assert.ok(!blocked('free').includes('device_recognition'))
  assert.equal(stageSnapshot(findings, 'free').facts.access_events, undefined)
  assert.equal(findingsForStage(findings, 'free').some((f) => f.factKey === 'access_events' || f.factKey === 'device_recognition'), false)

  const devices = findings.find((f) => f.factKey === 'device_recognition')!
  const answered = answerDevices(devices.values[0].value as never, value<DeviceRecognition[]>(accountSrfCase, 'device_recognition'))
  const resolved = current(await reconcile([record('access_events', srfAccess)]), { device_recognition: { kind: 'value', value: answered } })
  const snapshot = stageSnapshot(resolved, 'fidrec')
  assert.ok(!snapshot.blocks.some((b) => b.factKey === 'device_recognition'))
  assert.deepEqual(snapshot.facts.device_recognition, { value: answered, label: 'confirmed' })
  assert.equal(snapshot.facts.access_events?.label, 'confirmed')
  // The plain snapshot builder (used by other code) keeps working on the same findings.
  assert.deepEqual(buildSnapshot(resolved, 'fidrec').facts.device_recognition, snapshot.facts.device_recognition)
})

test('record lines are linked to a confirmed payment only where exactly one fits', () => {
  const payments = value<Transaction[]>(cardOnlyCase, 'transactions')
  const { card } = linkRecordsToTransactions(payments, [], cardEvents.map((e) => ({ ...e, transactionIndex: null })))
  assert.deepEqual(card.map((e) => e.transactionIndex), cardEvents.map((e) => e.transactionIndex))
  // Two account payments on one day: neither access line can be linked by date alone.
  const srfPayments = value<Transaction[]>(accountSrfCase, 'transactions')
  const { access } = linkRecordsToTransactions(srfPayments, srfAccess.map((e) => ({ ...e, relatedTransactionIndex: null })), [])
  const linked = access.filter((e) => e.relatedTransactionIndex !== null).map((e) => [e.timestamp?.slice(0, 10), e.relatedTransactionIndex])
  for (const [date, index] of linked) assert.equal(srfPayments[index as number].date, date)
  assert.equal(access.filter((e) => e.kind === 'payment_authenticated' && e.timestamp?.startsWith('2025-07-03')).every((e) => e.relatedTransactionIndex === null), true)
})

test('the record lists are summarised for display, never listed: no address or device reference is shown', () => {
  const text = formatFactValue('access_events', srfAccess)
  assert.equal(text, '13 lines from 3 Jul 2025 to 4 Jul 2025')
  assert.equal(formatFactValue('card_auth_events', cardEvents), '4 lines from 12 Sep 2025 to 13 Sep 2025')
  const confirmed = factsYouConfirmed({ access_events: { value: srfAccess, label: 'confirmed' }, card_auth_events: { value: cardEvents, label: 'confirmed' } })
  for (const line of confirmed) {
    assert.doesNotMatch(line.text, /\d+\.\d+\.\d+\.\d+|dev-ex-|tok-ex-/)
  }
  assert.equal(
    formatFactValue('device_recognition', value(cardOnlyCase, 'device_recognition')),
    'Phone model EX-300 (first seen 12 Sep 2025, 20:10): not mine',
  )
  assert.equal(formatFactValue('institution_fault_label', value(cardOnlyCase, 'institution_fault_label')),
    '“grossly negligent”, for: entered card details and a one-time code on a website reached from a message')
  assert.equal(formatFactValue('transaction_alert_threshold', value(cardOnlyCase, 'transaction_alert_threshold')), 'S$500 (set by you)')
  assert.equal(formatFactValue('token_activation_method', 'sms_code'), 'With a code sent by SMS')
})
