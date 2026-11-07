import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSnapshot,
  carryOverStatus,
  type CurrentFinding,
  type FactCandidate,
  type FactKey,
  type Money,
  openCount,
  reconcile,
  type ReconciledFinding,
  type Transaction,
} from '../../lib/facts'

// Synthetic fixtures only.
const sgd = (amount: number): Money => ({ amount, currency: 'SGD', amountSgd: amount })
const story = { sourceType: 'story' as const, sourceRef: { storyRevision: 1 } }
const answer = (key: string) => ({ sourceType: 'answer' as const, sourceRef: { questionKey: key } })
const doc = (id: string) => ({ sourceType: 'document' as const, sourceRef: { documentId: id } })
const event = (value: 'yes' | 'no' | 'unsure', date: string | null = null) => ({ value, date, reference: null, channel: null })
const txn = (date: string, amount: number, instrument: Transaction['instrument'] = 'account_transfer'): Transaction => ({
  date, amount: sgd(amount), channel: null, payee: null, last4: null, instrument,
})

function candidate<K extends FactKey>(factKey: K, value: FactCandidate<K>['value'], source: Omit<FactCandidate, 'factKey' | 'value'>): FactCandidate {
  return { factKey, value, ...source } as FactCandidate
}

async function findingFor(key: FactKey, candidates: FactCandidate[]): Promise<ReconciledFinding> {
  return (await reconcile(candidates)).find((f) => f.factKey === key)!
}

test('police report: story says yes, answer says no -> conflict with both values', async () => {
  const f = await findingFor('reported_to_police', [
    candidate('reported_to_police', event('yes'), story),
    candidate('reported_to_police', event('no'), answer('journey_police_report')),
  ])
  assert.equal(f.findingType, 'conflict')
  assert.deepEqual(f.values.map((v) => (v.value as { value: string }).value).sort(), ['no', 'yes'])
})

test('police report "yes" with no document -> unsupported; with a police document -> agreed', async () => {
  const unsupported = await findingFor('reported_to_police', [
    candidate('reported_to_police', event('yes', '2026-10-04'), story),
    candidate('reported_to_police', event('yes', '2026-10-04'), answer('journey_police_report')),
  ])
  assert.equal(unsupported.findingType, 'unsupported')
  const agreed = await findingFor('reported_to_police', [
    candidate('reported_to_police', event('yes', '2026-10-04'), story),
    candidate('reported_to_police', event('yes', '2026-10-05'), doc('police-report')),
  ])
  assert.equal(agreed.findingType, 'agreed', 'dates within one day agree')
})

test('amount lost: story vs statement beyond S$1 -> conflict; within S$1 -> agreed', async () => {
  assert.equal((await findingFor('total_loss', [
    candidate('total_loss', sgd(2400), story),
    candidate('total_loss', sgd(3000), doc('statement')),
  ])).findingType, 'conflict')
  assert.equal((await findingFor('total_loss', [
    candidate('total_loss', sgd(2400), story),
    candidate('total_loss', sgd(2400.8), doc('statement')),
  ])).findingType, 'agreed')
})

test('institution mismatch -> conflict; alias-equal or subset names -> agreed', async () => {
  assert.equal((await findingFor('institution_names', [
    candidate('institution_names', [{ name: 'OCBC', type: 'bank' }], story),
    candidate('institution_names', [{ name: 'DBS/POSB', type: 'bank' }], doc('letter')),
  ])).findingType, 'conflict')
  const agreed = await findingFor('institution_names', [
    candidate('institution_names', [{ name: 'DBS/POSB', type: 'bank' }], story),
    candidate('institution_names', [{ name: 'DBS/POSB', type: 'bank' }, { name: 'Singtel', type: 'telco' }], doc('letter')),
  ])
  assert.equal(agreed.findingType, 'agreed')
  assert.equal((agreed.values[0].value as unknown[]).length, 2, 'agreed sets are merged')
})

test('final reply claimed with no letter -> unsupported', async () => {
  const f = await findingFor('bank_reply', [
    candidate('bank_reply', { status: 'final_reply', date: '2026-10-28', outcome: 'rejected', qualifies: 'yes', reference: null }, answer('journey_bank_reply_status')),
  ])
  assert.equal(f.findingType, 'unsupported')
})

test('"unsure" gives way to a definite value instead of conflicting', async () => {
  const f = await findingFor('reported_to_bank', [
    candidate('reported_to_bank', event('unsure'), story),
    candidate('reported_to_bank', event('yes', '2026-10-03'), answer('journey_reported_to_bank')),
  ])
  assert.equal(f.findingType, 'agreed')
})

test('transactions: one-to-one match agrees; an extra statement line or a story-only payment needs the user', async () => {
  const both = [txn('2026-10-03', 2400)]
  assert.equal((await findingFor('transactions', [
    candidate('transactions', both, story),
    candidate('transactions', [txn('2026-10-04', 2405)], doc('statement')),
  ])).findingType, 'agreed', 'date within a day and amount within 1%')
  assert.equal((await findingFor('transactions', [
    candidate('transactions', both, story),
    candidate('transactions', [txn('2026-10-03', 2400), txn('2026-10-03', 600, 'sg_card')], doc('statement')),
  ])).findingType, 'conflict')
  assert.equal((await findingFor('transactions', [
    candidate('transactions', both, story),
  ])).findingType, 'unsupported')
})

test('a fact no source mentions is missing', async () => {
  assert.equal((await findingFor('amount_recovered_or_offered', [])).findingType, 'missing')
})

test('a resolution survives a re-run with the same values and reopens when the values change', async () => {
  const run1 = await findingFor('reported_to_police', [
    candidate('reported_to_police', event('yes'), story),
    candidate('reported_to_police', event('no'), answer('journey_police_report')),
  ])
  const stored = [{ factKey: 'reported_to_police' as const, valuesHash: run1.valuesHash, status: 'resolved' as const, resolution: { kind: 'choice', index: 0 } }]
  const sameValuesNewSources = await findingFor('reported_to_police', [
    candidate('reported_to_police', event('no'), answer('journey_police_report')),
    candidate('reported_to_police', event('yes'), { sourceType: 'story', sourceRef: { storyRevision: 2 } }),
  ])
  assert.equal(carryOverStatus(sameValuesNewSources, stored).status, 'resolved')
  const changed = await findingFor('reported_to_police', [
    candidate('reported_to_police', event('yes', '2026-10-09'), story),
    candidate('reported_to_police', event('no'), answer('journey_police_report')),
  ])
  const carried = carryOverStatus(changed, stored)
  assert.equal(carried.status, 'open')
  assert.equal(carried.reopened, true)
})

function stored(key: FactKey, findingType: CurrentFinding['findingType'], value: unknown, status: CurrentFinding['status'] = 'resolved', resolution: CurrentFinding['resolution'] = { kind: 'agreed' }): CurrentFinding {
  return { id: `f-${key}`, factKey: key, findingType, values: value === undefined ? [] : [{ value, sources: [] }], status, resolution }
}

const freeAgreed = [
  stored('institution_names', 'agreed', [{ name: 'DBS/POSB', type: 'bank' }]),
  stored('scam_type', 'agreed', ['digital_phishing']),
  stored('phishing_channel', 'agreed', 'sms'),
  stored('reported_to_bank', 'agreed', event('yes', '2026-10-03')),
  stored('bank_reply', 'agreed', { status: 'none', date: null, outcome: null, qualifies: null, reference: null }),
]

test('no snapshot while a conflict is open; resolved facts are labelled for the report', () => {
  const open = [...freeAgreed, stored('reported_to_police', 'conflict', event('yes'), 'open', null)]
  assert.deepEqual(buildSnapshot(open, 'free').blocks.map((b) => b.reason), ['open_finding'])
  assert.equal(openCount(open, 'free'), 1)

  const resolved = [...freeAgreed, stored('reported_to_police', 'conflict', event('yes'), 'not_sure', { kind: 'not_sure' })]
  const snap = buildSnapshot(resolved, 'free')
  assert.deepEqual(snap.blocks, [])
  assert.equal(snap.facts.reported_to_police?.label, 'not_sure')
  assert.equal(snap.facts.institution_names?.label, 'confirmed')
})

test('a missing fact blocks only the stages that need it; "not known" unblocks', () => {
  const findings = [...freeAgreed, stored('amount_recovered_or_offered', 'missing', undefined, 'open', null)]
  assert.deepEqual(buildSnapshot(findings, 'free').blocks, [])
  const notKnown = [...freeAgreed, stored('amount_recovered_or_offered', 'missing', undefined, 'resolved', { kind: 'not_known' })]
  assert.equal(buildSnapshot(notKnown, 'fidrec').facts.amount_recovered_or_offered?.label, 'not_known')
})

test('a kept unsupported claim is labelled claimant_only', () => {
  const findings = [...freeAgreed, stored('reported_to_police', 'unsupported', event('yes'), 'acknowledged', { kind: 'acknowledged' })]
  assert.equal(buildSnapshot(findings, 'free').facts.reported_to_police?.label, 'claimant_only')
})

test('a confirmed total that differs from the confirmed payments by more than S$1 blocks the snapshot', () => {
  const findings = [
    ...freeAgreed,
    stored('transactions', 'agreed', [txn('2026-10-03', 2400), txn('2026-10-03', 600, 'sg_card')]),
    stored('total_loss', 'conflict', sgd(2400), 'resolved', { kind: 'choice', index: 0 }),
  ]
  const blocks = buildSnapshot(findings, 'free').blocks
  assert.deepEqual(blocks, [{ reason: 'total_differs_from_transactions', factKey: 'total_loss', total: 2400, sum: 3000 }])
})

test('the same payment from the story and an answer, matched by the statement, agrees (staging run, 5 Nov)', async () => {
  const f = await findingFor('transactions', [
    candidate('transactions', [txn('2026-10-03', 2400)], story),
    candidate('transactions', [txn('2026-10-03', 2400)], answer('incident_summary')),
    candidate('transactions', [txn('2026-10-03', 2400)], doc('statement')),
  ])
  assert.equal(f.findingType, 'agreed')
  assert.equal(f.values.length, 1)
  assert.equal(f.values[0].sources.length, 3)
})

test('dependency rule: a bank reply implies the bank was told, so "No" becomes a conflict (Elena, 5 Nov)', async () => {
  const f = await findingFor('reported_to_bank', [
    candidate('reported_to_bank', event('no'), answer('previous_contact')),
    candidate('bank_reply', { status: 'final_reply', date: null, outcome: 'rejected', qualifies: null, reference: null }, story),
  ])
  assert.equal(f.findingType, 'conflict')
  const implied = f.values.find((v) => (v.value as { value: string }).value === 'yes')!
  assert.equal(implied.sources[0].sourceRef.impliedBy, 'bank_reply')
})

test('dependency rule: confirmed "No" with a kept bank reply cannot be frozen', () => {
  const findings = [
    ...freeAgreed.filter((f) => f.factKey !== 'reported_to_bank' && f.factKey !== 'bank_reply'),
    stored('reported_to_bank', 'agreed', event('no')),
    stored('bank_reply', 'unsupported', { status: 'final_reply', date: null, outcome: 'rejected', qualifies: null, reference: null }, 'acknowledged', { kind: 'acknowledged' }),
  ]
  assert.deepEqual(buildSnapshot(findings, 'free').blocks, [{ reason: 'inconsistent_facts', factKey: 'reported_to_bank', relatedFactKey: 'bank_reply' }])
})

test('walkthrough 7 Nov: an agreed fact that does not fit with another can be corrected, which unblocks the snapshot', () => {
  const bankReply = stored('bank_reply', 'unsupported', { status: 'final_reply', date: null, outcome: 'rejected', qualifies: null, reference: null }, 'acknowledged', { kind: 'acknowledged' })
  const others = freeAgreed.filter((f) => f.factKey !== 'reported_to_bank' && f.factKey !== 'bank_reply')
  const corrected = stored('reported_to_bank', 'agreed', event('no'), 'resolved', { kind: 'value', value: event('yes', '2026-10-03') })
  const snapshot = buildSnapshot([...others, corrected, bankReply], 'free')
  assert.deepEqual(snapshot.blocks, [])
  assert.deepEqual(snapshot.facts.reported_to_bank, { value: event('yes', '2026-10-03'), label: 'confirmed' })
  const unsure = stored('reported_to_bank', 'agreed', event('no'), 'not_sure', { kind: 'not_sure' })
  assert.equal(buildSnapshot([...others, unsure, bankReply], 'free').facts.reported_to_bank?.label, 'not_sure')
})

test('walkthrough 7 Nov: a correction to an agreed fact survives a re-run with the same values, and is dropped when they change', async () => {
  const run1 = await findingFor('reported_to_police', [candidate('reported_to_police', event('no'), story)])
  assert.equal(run1.findingType, 'agreed')
  const correction = { kind: 'value', value: event('yes', '2026-10-04') }
  const storedRows = [{ factKey: 'reported_to_police' as const, valuesHash: run1.valuesHash, status: 'resolved' as const, resolution: correction }]
  assert.deepEqual(carryOverStatus(run1, storedRows), { status: 'resolved', resolution: correction, reopened: false })
  const changed = await findingFor('reported_to_police', [candidate('reported_to_police', event('no', '2026-10-09'), story)])
  assert.deepEqual(carryOverStatus(changed, storedRows), { status: 'resolved', resolution: { kind: 'agreed' }, reopened: false })
  const plainAgreed = [{ ...storedRows[0], resolution: { kind: 'agreed' } }]
  assert.deepEqual(carryOverStatus(run1, plainAgreed), { status: 'resolved', resolution: { kind: 'agreed' }, reopened: false })
})
