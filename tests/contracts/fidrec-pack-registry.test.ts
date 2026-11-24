// The section registry of the FIDReC pack update (Lane 6, assembly): every section in the contract's order, built from
// a SectionInput that a real case's snapshot gives exactly as the synthetic fixtures give it. Synthetic data only.

import assert from 'node:assert/strict'
import test from 'node:test'
import type { SnapshotFacts } from '../../lib/facts'
import {
  type AccessEvent,
  type CardAuthEvent,
  createFakeClauseProvider,
  SECTION_IDS,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { buildUpdateSections, sectionBuilders } from '../../supabase/functions/_shared/facts/update/registry.ts'
import { evidenceIdsByFact, excludedFromDrainTest, ipLocationFromRow, sectionInputFromSnapshot } from '../../supabase/functions/_shared/facts/update/section-input.ts'
import { FIDREC_UPDATE_CASES, syntheticCorpus } from '../fixtures/fidrec-update/index.ts'

const provider = createFakeClauseProvider(syntheticCorpus)

test('registry: one builder per section, called in the contract order; the standards section (Phase 5) prints nothing', async () => {
  assert.deepEqual(Object.keys(sectionBuilders()).sort(), [...SECTION_IDS].sort())
  for (const c of FIDREC_UPDATE_CASES) {
    const results = await buildUpdateSections({ ...c.data, provider })
    assert.deepEqual(results.map((r) => r.sectionId), [...SECTION_IDS], c.id)
    assert.deepEqual(results.find((r) => r.sectionId === 'standards')?.lines, [], c.id)
  }
})

test('registry: the record sections print one row per record line, and nothing without a record', async () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const results = await buildUpdateSections({ ...c.data, provider })
    const rows = (id: string) => results.find((r) => r.sectionId === id)!.lines.filter((l) => l.kind === 'record')
    assert.equal(rows('access_records').length, ((c.data.facts.access_events?.value ?? []) as AccessEvent[]).length, c.id)
    assert.equal(rows('card_authentication_records').length, ((c.data.facts.card_auth_events?.value ?? []) as CardAuthEvent[]).length, c.id)
    const ip = results.find((r) => r.sectionId === 'ip_locations')!
    assert.equal(ip.lines.length > 0, c.data.ipLocations.length > 0, c.id)
  }
  const card = FIDREC_UPDATE_CASES.find((c) => c.id === 'card-only')!
  const [access] = await buildUpdateSections({ ...card.data, provider })
  const first = access.lines[0]
  assert.ok(first.kind === 'record')
  assert.deepEqual(first.fields, {
    time: '20:10 on 12 September 2025',
    entry: 'Digital token activated',
    device: 'Phone model EX-300',
    device_reference: 'dev-ex-0102',
    ip_address: '198.51.100.40',
    channel: 'mobile app',
    authorised_by: 'SMS one-time code',
    sent_to: 'registered mobile number',
    token_reference: 'tok-ex-0102',
  })
  assert.deepEqual(first.evidenceIds, ['E4'])
})

test('section input: a snapshot gives the same input as the fixtures (payments, institution, instruments, evidence IDs)', () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const index = Object.entries(c.data.evidenceIds).flatMap(([fact, ids]) => (ids ?? []).map((id) => ({ id, fact })))
    const entries = [...new Set(index.map((x) => x.id))].map((id) => ({ id, facts: index.filter((x) => x.id === id).map((x) => x.fact) }))
    const input = sectionInputFromSnapshot({
      facts: c.data.facts as unknown as SnapshotFacts,
      evidenceIndex: entries,
      institutionCode: c.data.institution?.code ?? null,
      ipLocations: c.data.ipLocations,
      provider,
      generatedOn: c.data.generatedOn,
    })
    assert.deepEqual(input.payments.map((p) => [p.index, p.date, p.amount.amount, p.instrument]), c.data.payments.map((p) => [p.index, p.date, p.amount.amount, p.instrument]), c.id)
    assert.deepEqual(input.institution, c.data.institution, c.id)
    assert.deepEqual([...input.instruments].sort(), [...c.data.instruments].sort(), c.id)
    for (const [fact, ids] of Object.entries(c.data.evidenceIds)) assert.deepEqual(input.evidenceIds[fact as keyof typeof input.evidenceIds], ids, `${c.id}: ${fact}`)
    assert.equal(input.generatedOn, '2026-11-24')
  }
  assert.deepEqual(evidenceIdsByFact([{ id: 'E1', facts: ['transactions'] }, { id: 'E2', facts: ['transactions', 'bank_reply'] }]), { transactions: ['E1', 'E2'], bank_reply: ['E2'] })
})

test('section input: the drain test leaves out card payments, GIRO, standing instructions, bill payments and own-account transfers', () => {
  assert.equal(excludedFromDrainTest({ instrument: 'account_transfer', channel: 'FAST transfer' }), false)
  assert.equal(excludedFromDrainTest({ instrument: 'sg_card', channel: 'online card payment' }), true)
  for (const channel of ['GIRO deduction', 'eGIRO', 'standing instruction', 'bill payment to a billing organisation', 'own-account transfer']) {
    assert.equal(excludedFromDrainTest({ instrument: 'account_transfer', channel }), true, channel)
  }
  // A stored lookup row reads back as the contract's IpLocation.
  assert.deepEqual(ipLocationFromRow({ ip: '198.51.100.40/32', country: 'Exampleland', region: null, city: 'Example City', accuracy_radius_km: '20', asn: '64503', organisation: 'Example Broadband', flags: '{hosting}', database: 'Example IP Database', database_edition: '2025-10-01', institution_stated_location: null }), {
    ip: '198.51.100.40', country: 'Exampleland', region: null, city: 'Example City', accuracyRadiusKm: 20, asn: 64503, organisation: 'Example Broadband', flags: ['hosting'], database: 'Example IP Database', databaseEdition: '2025-10-01', institutionStatedLocation: null,
  })
})
