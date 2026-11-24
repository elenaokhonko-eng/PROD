// The bank pack's lines from the FIDReC update (Lane 6), with FIDREC_UPDATE_SECTIONS_ENABLED on: the request for missing
// technical records (brief v5, decision 9) and what EUPG Section 8 says for a dispute reported on or after 16 June 2025
// (review of 24 Nov 2026, Decision 8). With the switch off the bank pack is exactly as before (condition A), and with
// it on no record reaches the model (condition B). tests/contracts/bank-pack.test.ts is not edited (condition C).
// All data is synthetic.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assembleBankPack, bankPackSystem, buildBankPackInput, type SnapshotFacts } from '../../lib/facts'
import { buildBankPackUpdate, RECORD_REQUESTS } from '../../supabase/functions/_shared/facts/update/bank-pack-update.ts'
import { createFakeClauseProvider } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { serverOnlyValues } from '../../supabase/functions/_shared/facts/update/model-guard.ts'
import { FIDREC_UPDATE_CASES, type FidrecUpdateCase } from '../fixtures/fidrec-update/index.ts'
import { corpus, GENERATED_ON, recordValues, snapshotFacts, story } from './fidrec-pack-update-cases.ts'
import { H, lane4Corpus, statement } from './sequence-fault-corpus.ts'

const PROSE = { title: 't', executive_summary: 's', requested_resolution: 'r' }

test('condition A: the bank pack function reads the switch server-side, and every new call is behind it', () => {
  const fn = readFileSync('supabase/functions/run_bank_pack_v1/index.ts', 'utf8')
  assert.ok(fn.includes('const UPDATE_SECTIONS = fidrecUpdateSectionsEnabled((name) => Deno.env.get(name));'))
  assert.ok(fn.includes('if (UPDATE_SECTIONS) {'))
  assert.ok(fn.includes('let update: BankPackUpdate | null = null;'))
  assert.ok(fn.includes('update: update ? { redact: serverOnlyValues(facts) } : null'))
})

test("condition A: with the switch off the bank pack's prompt, input and report are exactly as before", () => {
  assert.ok(!bankPackSystem(null).includes('[record detail]'))
  for (const c of FIDREC_UPDATE_CASES) {
    const facts = snapshotFacts(c)
    assert.deepEqual(buildBankPackInput({ facts, findings: [], storyText: story(c), update: null }), buildBankPackInput({ facts, findings: [], storyText: story(c) }))
    const report = assembleBankPack({ prose: PROSE, source: 'model', facts, findings: [], update: null })
    assert.deepEqual(report, assembleBankPack({ prose: PROSE, source: 'model', facts, findings: [] }))
    assert.deepEqual(Object.keys(report).filter((k) => k.startsWith('update_')), [], c.id)
  }
})

const section8 = createFakeClauseProvider(lane4Corpus([
  statement('eupg.section8.charges', 'eupg', [['mas.eupg/5.2', H.eupg52]], { text: 'Synthetic wording of eupg.section8.charges.' }),
  statement('eupg.section8.credit_records', 'eupg', [['mas.eupg/5.2', H.eupg52]], { text: 'Synthetic wording of eupg.section8.credit_records.' }),
  statement('eupg.section8.outofscope', 'eupg', [['mas.eupg/5.2', H.eupg52]], { text: 'Synthetic wording of eupg.section8.outofscope.' }),
]))

test('bank pack: a case with no technical record asks for one; a card case without a card record asks for that too', async () => {
  const byId = Object.fromEntries(FIDREC_UPDATE_CASES.map((c) => [c.id, c]))
  const run = (c: FidrecUpdateCase, documentTypes: string[] = []) =>
    buildBankPackUpdate({ facts: snapshotFacts(c), documentTypes, provider: section8, generatedOn: GENERATED_ON })
  assert.deepEqual((await run(byId['no-technical-records'])).requests, [RECORD_REQUESTS.access])
  assert.deepEqual((await run(byId['card-only'])).requests, [], 'both records are in the facts')
  const withoutCardRecord = { ...byId['card-only'], data: { ...byId['card-only'].data, facts: { ...byId['card-only'].data.facts, card_auth_events: undefined } } } as FidrecUpdateCase
  assert.deepEqual((await run(withoutCardRecord)).requests, [RECORD_REQUESTS.card])
  assert.deepEqual((await run(withoutCardRecord, ['CARD_AUTHENTICATION_RECORD'])).requests, [], 'an uploaded record still being read counts')
})

test('bank pack: Section 8 prints for a dispute reported on or after 16 June 2025, credit records only for credit cards', async () => {
  const card = FIDREC_UPDATE_CASES.find((c) => c.id === 'card-only')!
  const at = (date: string) => ({ ...snapshotFacts(card), reported_to_bank: { value: { value: 'yes', date, reference: null, channel: null }, label: 'confirmed' } }) as SnapshotFacts
  const lines = async (facts: SnapshotFacts) => (await buildBankPackUpdate({ facts, documentTypes: [], provider: section8, generatedOn: GENERATED_ON })).section8
  assert.deepEqual((await lines(at('2025-06-15'))), [])
  const from = await lines(at('2025-06-16'))
  assert.deepEqual(from.map((l) => l.statementKey), ['eupg.section8.charges', 'eupg.section8.credit_records', 'eupg.section8.outofscope'])
  assert.match(from[0].references, /paragraph 5\.2/)
  const account = FIDREC_UPDATE_CASES.find((c) => c.id === 'account-srf')!
  const accountLines = await buildBankPackUpdate({ facts: snapshotFacts(account), documentTypes: [], provider: section8, generatedOn: GENERATED_ON })
  assert.deepEqual(accountLines.section8.map((l) => l.statementKey), ['eupg.section8.charges', 'eupg.section8.outofscope'])
  // No approved statement: nothing prints, and the run is flagged.
  const none = await buildBankPackUpdate({ facts: at('2025-07-01'), documentTypes: [], provider: createFakeClauseProvider(corpus), generatedOn: GENERATED_ON })
  assert.deepEqual(none.section8, [])
  assert.ok(none.flags.every((f) => f.code === 'statement_under_review'))
  // The report keeps them only with the switch on.
  const report = assembleBankPack({ prose: { title: 't', executive_summary: 's', requested_resolution: 'r' }, source: 'model', facts: at('2025-07-01'), findings: [], update: { ...none, section8: from } })
  assert.equal(report.update_section8?.length, 3)
  assert.deepEqual(report.update_record_requests, [])
})

test('bank pack: with the switch on, records stay out of the model input', () => {
  for (const c of FIDREC_UPDATE_CASES) {
    const facts = snapshotFacts(c)
    const input = buildBankPackInput({ facts, findings: [], storyText: story(c), update: { redact: serverOnlyValues(facts, c.data.ipLocations) } })
    const text = JSON.stringify(input)
    for (const value of recordValues(c)) assert.ok(!text.includes(value), `${c.id}: ${value}`)
  }
})

test("the bank PDF prints the update's lines only when the report has them", async () => {
  const { buildBankPackPdf } = await import('../../lib/server/facts/bank-pack-pdf.ts')
  const c = FIDREC_UPDATE_CASES.find((x) => x.id === 'card-only')!
  const bank = assembleBankPack({ prose: PROSE, source: 'model', facts: snapshotFacts(c), findings: [], update: null })
  const plain = await buildBankPackPdf({ ...bank }, null)
  assert.ok(plain.length > 0)
  const withLines = await buildBankPackPdf({ ...bank, update_record_requests: [RECORD_REQUESTS.card], update_section8: [{ statementKey: 'eupg.section8.charges', text: 'Synthetic wording.', references: 'paragraph 8.1' }] }, null)
  assert.ok(withLines.length > plain.length)
})
