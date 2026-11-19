import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assembleFidrecPack,
  buildEvidenceIndex,
  buildFidrecPackInput,
  evidenceIdFailures,
  FIDREC_PACK_FALLBACK_TITLE,
  type FidrecPackProse,
  fidrecPackChecks,
  fidrecPackFallback,
  fidrecPackSystem,
  fidrecPackTexts,
  fidrecRouteFromFacts,
  mapFidrecPackProse,
  parseFidrecPackProse,
  produceChecked,
  ProviderFailure,
  qualifyingFinalReplyDocumentId,
  type SnapshotFacts,
  validateOutput,
} from '../../lib/facts'

// The FIDReC pack (S$188) reuses the bank pack's pattern: confirmed facts, the free evaluation's ladder and validator,
// third person for FIDReC's case officer (stage2-plan milestone 3). All facts, letters and texts are synthetic.

const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const event = (value: 'yes' | 'no', date: string | null) => ({ value, date, reference: null, channel: null })
const finalReply = { status: 'final_reply', date: '2026-09-01', outcome: 'rejected', qualifies: 'yes', reference: null }
const facts: SnapshotFacts = {
  scam_type: { value: ['phishing'], label: 'confirmed' },
  phishing_channel: { value: 'sms', label: 'confirmed' },
  institution_names: { value: [{ name: 'Synthetic Bank', type: 'bank' }], label: 'confirmed' },
  total_loss: { value: { ...sgd(3000), account: null, portions: [] }, label: 'confirmed' },
  transactions: {
    value: [{ date: '2026-08-02', amount: sgd(3000), channel: 'FAST transfer', payee: null, last4: null, instrument: 'bank_transfer' }],
    label: 'confirmed',
  },
  reported_to_bank: { value: event('yes', '2026-08-03'), label: 'confirmed' },
  written_complaint_sent: { value: event('yes', '2026-08-05'), label: 'confirmed' },
  bank_reply: { value: finalReply, label: 'confirmed' },
  reported_to_police: { value: event('yes', '2026-08-04'), label: 'claimant_only' },
  amount_recovered_or_offered: { value: null, label: 'not_known' },
}

const letterSource = (confidence: number) => ({
  sourceType: 'document',
  sourceRef: { documentId: 'doc-letter', documentType: 'bank_correspondence', confidence, documentName: 'synthetic.pdf' },
})
const findings = [
  { fact_key: 'bank_reply', finding_type: 'agreed', values: [{ value: finalReply, sources: [letterSource(0.92)] }], resolution: { kind: 'agreed' } },
  {
    fact_key: 'transactions',
    finding_type: 'agreed',
    values: [{ value: facts.transactions!.value, sources: [{ sourceType: 'document', sourceRef: { documentId: 'doc-statement', documentType: 'bank_statement', confidence: 0.95 } }] }],
    resolution: { kind: 'agreed' },
  },
]

const words = (n: number) => Array.from({ length: n }, () => 'details').join(' ')
const GOOD: FidrecPackProse = {
  title: 'Disputed payment of S$3,000 after an SMS scam',
  executive_summary: `On 2 Aug 2026 the complainant lost S$3,000 from a Synthetic Bank account after an SMS scam. The complainant reported it to Synthetic Bank on 3 Aug 2026 and complained in writing on 5 Aug 2026. ${words(200)}.`,
  claimant_position: 'The complainant asks FIDReC to review whether Synthetic Bank should restore the disputed payment.',
  institution_position: 'In its final reply of 1 Sep 2026, Synthetic Bank declined the claim.',
  arguments_for_claimant: [{ text: 'The complainant reported the scam promptly to Synthetic Bank.', evidence_ids: ['E1'] }],
  arguments_for_institution: [{ text: 'Synthetic Bank says the payment was made from the complainant’s own device.', evidence_ids: ['E1'] }],
}

const index = buildEvidenceIndex(findings)
const today = '2026-10-15'
const route = fidrecRouteFromFacts(facts, today)
const checks = fidrecPackChecks(route.available && route.route === 'final_reply' ? [route.deadline] : [])
const ladder = (generate: (previous: string | null) => Promise<FidrecPackProse>) =>
  produceChecked({
    facts,
    options: checks,
    generate,
    mapText: mapFidrecPackProse,
    texts: fidrecPackTexts,
    fallback: fidrecPackFallback,
    extraChecks: (prose) => evidenceIdFailures(prose, index),
  })

function scripted(...outputs: Array<FidrecPackProse | ProviderFailure>) {
  const calls: Array<string | null> = []
  return {
    calls,
    generate: async (previous: string | null) => {
      calls.push(previous)
      const next = outputs[calls.length - 1]
      if (next instanceof ProviderFailure) throw next
      return next
    },
  }
}

test('the evidence index numbers the documents behind confirmed facts, by kind, never by file name', () => {
  assert.deepEqual(index.map((e) => [e.id, e.documentId, e.label]), [
    ['E1', 'doc-letter', 'a letter or email from your bank (uploaded)'],
    ['E2', 'doc-statement', 'your bank statement (uploaded)'],
  ])
  assert.doesNotMatch(JSON.stringify(index), /synthetic\.pdf/)
})

test('the final reply letter is used only when read as a bank letter with confidence above 0.7', () => {
  assert.equal(qualifyingFinalReplyDocumentId(findings), 'doc-letter')
  const unsure = [{ ...findings[0], values: [{ value: finalReply, sources: [letterSource(0.7)] }] }]
  assert.equal(qualifyingFinalReplyDocumentId(unsure), null, 'exactly 0.7 is not above it')
  const notFinal = [{ ...findings[0], values: [{ value: { ...finalReply, status: 'interim' }, sources: [letterSource(0.95)] }] }]
  assert.equal(qualifyingFinalReplyDocumentId(notFinal), null)
  const statement = [{ ...findings[0], values: [{ value: finalReply, sources: [{ sourceType: 'document', sourceRef: { documentId: 'x', documentType: 'bank_statement', confidence: 0.99 } }] }] }]
  assert.equal(qualifyingFinalReplyDocumentId(statement), null)
})

test('decision 7: the route comes from the confirmed facts; past six months after the final reply, nothing is generated', () => {
  assert.deepEqual(route, { available: true, route: 'final_reply', deadline: '2027-03-01', daysLeft: 137, deadlineSoon: false })
  assert.equal(fidrecRouteFromFacts(facts, '2027-03-02').available, false)
  const early: SnapshotFacts = { ...facts, bank_reply: { value: { status: 'none', date: null, outcome: null, qualifies: null, reference: null }, label: 'confirmed' } }
  assert.deepEqual(fidrecRouteFromFacts(early, '2026-08-20'), { available: false, reason: 'fidrec_too_early', availableFrom: '2026-09-02' })
  const fn = readFileSync('supabase/functions/run_fidrec_pack_v1/index.ts', 'utf8')
  assert.ok(fn.indexOf('if (!route.available)') < fn.indexOf('chatJson('), 'refused before any model call')
})

test('a faithful pack is delivered as written, in the third person, with every argument citing the index', async () => {
  const model = scripted(GOOD)
  const result = await ladder(model.generate)
  assert.equal(result.source, 'model')
  assert.deepEqual(model.calls, [null])
  assert.deepEqual(validateOutput(fidrecPackTexts(GOOD), facts, checks), [])
})

test('an unknown or missing evidence ID is regenerated with the problem fed back, then replaced by fixed wording', async () => {
  const unknownId = { ...GOOD, arguments_for_claimant: [{ text: GOOD.arguments_for_claimant[0].text, evidence_ids: ['E9'] }] }
  const noId = { ...GOOD, arguments_for_institution: [{ text: GOOD.arguments_for_institution[0].text, evidence_ids: [] }] }
  assert.deepEqual(evidenceIdFailures(unknownId, index).map((f) => f.check), ['reference'])
  const model = scripted(unknownId, noId)
  const result = await ladder(model.generate)
  assert.equal(result.source, 'fallback')
  assert.match(model.calls[1] ?? '', /E9/)
  assert.equal(result.output.title, FIDREC_PACK_FALLBACK_TITLE)
})

test('the fee and the award cap may be stated; other amounts and an SRF verdict may not', () => {
  const fee = { ...GOOD, claimant_position: `${GOOD.claimant_position} If the case goes to adjudication, FIDReC charges a S$50 fee; awards are capped at S$150,000.` }
  assert.deepEqual(validateOutput(fidrecPackTexts(fee), facts, checks), [])
  const srf = { ...GOOD, institution_position: 'Under the SRF the institution must pay S$4,000.' }
  const failures = validateOutput(fidrecPackTexts(srf), facts, checks).map((f) => f.check)
  assert.ok(failures.includes('forbidden') && failures.includes('amount'))
})

test('a provider failure ends in fixed wording that states only the confirmed facts', async () => {
  const result = await ladder(scripted(new ProviderFailure('timeout')).generate)
  assert.equal(result.source, 'fallback')
  const text = result.output.executive_summary
  assert.match(text, /Amount recovered or offered: not confirmed/)
  assert.match(text, /Police report: yes on 2026-08-04 \(stated by the complainant; no document\)/)
})

test('the model sees the letter only when given, and the evidence index; the prompt is third person', () => {
  const input = buildFidrecPackInput({ facts, findings, storyText: 'A synthetic story.', finalReplyText: 'Synthetic letter text.', evidenceIndex: index })
  assert.equal(input.final_reply_letter, 'Synthetic letter text.')
  assert.deepEqual(input.evidence_index.map((e) => e.id), ['E1', 'E2'])
  assert.ok(!('fidrec_check' in input))
  assert.equal(buildFidrecPackInput({ facts, findings, storyText: null, finalReplyText: null, evidenceIndex: [] }).final_reply_letter, null)
  assert.match(fidrecPackSystem(null), /third person: "the complainant" and "the institution"/)
})

test('every other section is built from the confirmed facts', () => {
  const report = assembleFidrecPack({ prose: GOOD, source: 'model', facts, findings: [], evidenceIndex: index, route, finalReplyUsed: true })
  assert.equal(report.report_version, 'fidrec_pack_v1')
  assert.match(report.route, /must receive the complaint by 2027-03-01/)
  assert.match(report.route, /charges individuals a S\$50 case fee/)
  assert.deepEqual(report.timeline.map((t) => t.event), [
    'Payment of S$3,000',
    'The complainant reported the scam to the institution',
    'The complainant reported the scam to the police',
    'The complainant sent a written complaint',
    'The institution gave its final reply',
  ])
  assert.deepEqual(report.evidence_index, [{ id: 'E1', document: 'a letter or email from your bank (uploaded)' }, { id: 'E2', document: 'your bank statement (uploaded)' }])
  assert.equal(report.final_reply_used, true)
})

test('an unusable answer is treated as empty', () => {
  assert.equal(parseFidrecPackProse({ ...GOOD, arguments_for_claimant: [] }), null)
  assert.equal(parseFidrecPackProse({ ...GOOD, institution_position: ' ' }), null)
  assert.deepEqual(parseFidrecPackProse({ ...GOOD, arguments_for_claimant: [{ text: 'x', evidence_ids: ['e1', 'E1'] }] })?.arguments_for_claimant, [{ text: 'x', evidence_ids: ['E1'] }])
})

test('the Edge Function and route are paid-only, once per case, exempt from the daily cap but metered', () => {
  const fn = readFileSync('supabase/functions/run_fidrec_pack_v1/index.ts', 'utf8')
  assert.ok(fn.indexOf('allow_escalation_pack') < fn.indexOf('chatJson('))
  assert.ok(fn.indexOf('report_type", "fidrec_pack_v1"') < fn.indexOf('chatJson('))
  assert.doesNotMatch(fn, /dailyBreaker/)
  assert.match(fn, /purpose: "fidrec_pack"/)
  assert.match(fn, /rpc\("commit_fidrec_pack_v1"/)
  const route = readFileSync('app/api/edge/fidrec-pack/route.ts', 'utf8')
  assert.match(route, /loadCurrentSnapshot\(service, caseId, 'fidrec', snapshotId\)/)
  assert.match(route, /allow_escalation_pack !== true/)
  const migration = readFileSync('supabase/migrations/20261121120000_fidrec_pack.sql', 'utf8')
  assert.match(migration, /'run_bank_pack_v1', 'run_fidrec_pack_v1'\)/)
  assert.match(migration, /s\.stage = 'fidrec'/)
})
