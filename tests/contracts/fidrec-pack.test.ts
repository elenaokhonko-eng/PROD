import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assembleFidrecPack,
  buildEvidenceIndex,
  buildFidrecPackInput,
  documentExcerpts,
  documentQuotables,
  dutyFailures,
  numberClauses,
  regulatoryQuery,
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
  institution_duties: [],
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

test('decision 7 as amended by CR-2: the route comes from the confirmed facts, and a late final reply still generates', () => {
  assert.deepEqual(route, { available: true, route: 'final_reply', deadline: '2027-03-01', daysLeft: 137, deadlineSoon: false })
  assert.equal(fidrecRouteFromFacts(facts, '2027-03-02').available, true)
  const early: SnapshotFacts = { ...facts, bank_reply: { value: { status: 'none', date: null, outcome: null, qualifies: null, reference: null }, label: 'confirmed' } }
  assert.deepEqual(fidrecRouteFromFacts(early, '2026-08-20'), { available: false, reason: 'fidrec_too_early', availableFrom: '2026-09-02', complaintDate: '2026-08-05' })
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
  // PB-13 (wording chosen by Elena, 25 Nov) and PB-10's date form: whose date it is and how the deadline was counted.
  assert.equal(
    report.route,
    'You told us the final reply is dated 1 Sep 2026. Counted from that date, FIDReC must receive the complaint by 1 Mar 2027 (six months after the final reply). If the case goes to adjudication, FIDReC charges individuals a S$50 case fee.',
  )
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

// Elena, 20 Nov 2026: the bank's technical records (devices, IP addresses) and its duties under the SRF, the E-Payments
// Guidelines and MAS notices belong in the FIDReC pack.
const accessLog = {
  id: 'doc-access-log',
  evidenceType: 'RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA',
  text: 'Digital token activated 2 Oct 2026 19:46 on device AND-58F3-0D9A-E7C4 from IP 198.51.100.23. Transfer limit raised to S$10,000. Released 12 November 2026.',
}
const clauses = numberClauses([
  { clause_ref: '4.2(b)', title: 'Cooling period', text_content: 'A cooling period of at least 12 hours applies after activation of a digital security token on a new device.', source: 'MAS SRF Guidelines (2024)' },
  { clause_ref: '7', title: 'Access control', text_content: 'A financial institution shall implement controls to detect unauthorised access.', source: 'MAS Notice FSM-N06 (2024)' },
])

test('every ready document is evidence, after those behind the facts; the model gets each one whole', () => {
  const index = buildEvidenceIndex(findings, [{ id: 'doc-letter', evidenceType: null, text: 'x' }, accessLog])
  assert.deepEqual(index.map((e) => [e.id, e.label]), [
    ['E1', 'a letter or email from your bank (uploaded)'],
    ['E2', 'your bank statement (uploaded)'],
    ['E3', 'the bank’s login, device and IP records (uploaded)'.replace('’', "'")],
  ])
  const excerpts = documentExcerpts(index, [accessLog, { id: 'doc-letter', evidenceType: null, text: 'y'.repeat(9_000) }])
  assert.equal(excerpts.find((e) => e.id === 'E1')?.excerpt.length, 9_000, 'whole')
  assert.equal(excerpts.find((e) => e.id === 'E3')?.excerpt, accessLog.text)
})

test('device IDs, dates and amounts in the documents may be quoted; others still fail', () => {
  const quotables = documentQuotables([{ excerpt: accessLog.text }])
  assert.ok(quotables.references.includes('AND-58F3-0D9A-E7C4'))
  assert.ok(quotables.dates.includes('2026-11-12') && quotables.amounts.includes(10_000))
  const options = fidrecPackChecks([], quotables)
  const quoted = 'The institution’s records show a digital token was activated on device AND-58F3-0D9A-E7C4 and the transfer limit was raised to S$10,000.'
  assert.deepEqual(validateOutput([quoted], facts, { ...options, userFacing: undefined }), [])
  const invented = validateOutput(['A token was activated on device XYZ-11-22 and S$7,777 was moved.'], facts, { ...options, userFacing: undefined })
  assert.deepEqual(invented.map((f) => f.check).sort(), ['amount', 'reference'])
})

test('duties cite retrieved clauses and evidence, may name the frameworks, but never decide liability', () => {
  const duty = {
    text: 'The SRF requires a cooling period of at least 12 hours after a new token is activated; the institution’s records show the token was activated at 19:46 and the first transfer followed minutes later.',
    clause_ids: ['R1'],
    evidence_ids: ['E1'],
  }
  const checks = fidrecPackChecks([])
  assert.deepEqual(dutyFailures({ ...GOOD, institution_duties: [duty] }, clauses, facts, checks), [])
  const unknownClause = dutyFailures({ ...GOOD, institution_duties: [{ ...duty, clause_ids: ['R9'] }] }, clauses, facts, checks)
  assert.deepEqual(unknownClause.map((f) => f.check), ['reference'])
  const conclusion = dutyFailures({ ...GOOD, institution_duties: [{ ...duty, text: 'The institution is liable and must refund the complainant.' }] }, clauses, facts, checks)
  assert.ok(conclusion.some((f) => f.check === 'forbidden'))
  // Outside the duties section the SRF assessment stays the server's.
  assert.ok(validateOutput([`${GOOD.claimant_position} Under the SRF the bank pays.`], facts, checks).some((f) => f.check === 'forbidden'))
})

test('the clauses and documents reach the model; the report lists only the clauses the duties cite', () => {
  const index = buildEvidenceIndex(findings, [accessLog])
  const input = buildFidrecPackInput({ facts, findings, storyText: null, finalReplyText: null, evidenceIndex: index, documents: documentExcerpts(index, [accessLog]), clauses })
  assert.deepEqual(input.regulatory_clauses.map((c) => c.id), ['R1', 'R2'])
  assert.equal(input.documents.length, 1)
  assert.match(fidrecPackSystem(null), /INSTITUTION DUTIES[\s\S]*never say the institution is liable/)
  assert.match(regulatoryQuery(facts), /cooling-off before high-risk activities[\s\S]*Scam type: phishing/)
  // Brief v5, 1.4c: a login on a new device is a trigger only for accounts issued by payment service providers.
  assert.doesNotMatch(regulatoryQuery(facts), /new device/i)
  const prose = { ...GOOD, institution_duties: [{ text: 'A duty.', clause_ids: ['R1'], evidence_ids: ['E1'] }] }
  const report = assembleFidrecPack({ prose, source: 'model', facts, findings: [], evidenceIndex: index, route, finalReplyUsed: false, clauses })
  assert.deepEqual(report.regulatory_sources, [{ id: 'R1', source: 'MAS SRF Guidelines (2024)', clause_ref: '4.2(b)', title: 'Cooling period' }])
})

test('the route question becomes facts, so the purchase and the generation agree (decision 7)', () => {
  const { answerCandidates } = require('../../lib/facts') as typeof import('../../lib/facts')
  const row = (questionKey: string, value: string) => ({ questionKey, value, revisionId: `r-${questionKey}` })
  const finalReply = answerCandidates([row('fidrec_route', 'final_reply'), row('fidrec_final_reply_date', '2026-11-10')]).candidates
  assert.deepEqual(finalReply.find((c) => c.factKey === 'bank_reply')?.value, {
    status: 'final_reply',
    date: '2026-11-10',
    outcome: null,
    qualifies: 'yes',
    reference: null,
  })
  const notQualifying = answerCandidates([
    row('fidrec_route', 'final_reply'),
    row('fidrec_final_reply_date', '2026-11-10'),
    row('journey_final_reply_qualifies', 'no'),
  ]).candidates
  assert.equal((notQualifying.find((c) => c.factKey === 'bank_reply')?.value as { qualifies: string }).qualifies, 'no')
  const noReply = answerCandidates([row('fidrec_route', 'no_reply'), row('fidrec_complaint_date', '2026-10-04')]).candidates
  assert.deepEqual(noReply.find((c) => c.factKey === 'written_complaint_sent')?.value, { value: 'yes', date: '2026-10-04', reference: null, channel: null })
  assert.equal(answerCandidates([row('fidrec_route', 'not_complained')]).candidates.length, 0)
  // The same answers, as facts, open the route the generation checks.
  const routeFacts: SnapshotFacts = { ...facts, bank_reply: { value: finalReply.find((c) => c.factKey === 'bank_reply')!.value, label: 'confirmed' } }
  assert.equal(fidrecRouteFromFacts(routeFacts, '2026-11-20').available, true)
})

test('a fact without a document is attributed in the third person, and the model is told which dates it may use', () => {
  const { qualifyUnsupportedStatements } = require('../../lib/facts') as typeof import('../../lib/facts')
  // The police report is the complainant's own account here (claimant_only).
  const checks = fidrecPackChecks([])
  const text = 'The complainant reported the scam to the police on 4 Aug 2026.'
  assert.ok(validateOutput([text], facts, { ...checks, userFacing: undefined }).some((f) => f.check === 'unqualified'))
  const repaired = qualifyUnsupportedStatements(text, facts, [], true)
  assert.equal(repaired, 'The complainant states that the complainant reported the scam to the police on 4 Aug 2026.')
  assert.deepEqual(validateOutput([repaired], facts, { ...checks, userFacing: undefined }), [])
  const input = buildFidrecPackInput({ facts, findings, storyText: null, finalReplyText: null, evidenceIndex: [], allowedDates: ['2026-09-01', '2027-03-01', '2026-09-01'] })
  assert.deepEqual(input.allowed_dates, ['2026-09-01', '2027-03-01'])
  assert.match(fidrecPackSystem(null), /State only dates listed in allowed_dates/)
})

test('more Singapore banks are recognised, including names with "and" in them (Elena, 20 Nov 2026)', () => {
  const { institutionsIn, institutionsMentioned } = require('../../lib/facts') as typeof import('../../lib/facts')
  assert.deepEqual(institutionsIn('Industrial and Commercial Bank of China and MariBank').map((i) => i.name), ['ICBC', 'MariBank'])
  assert.deepEqual(institutionsIn('Bank of China / CIMB, RHB').map((i) => [i.name, i.type]), [['Bank of China', 'bank'], ['CIMB', 'bank'], ['RHB', 'bank']])
  assert.deepEqual(institutionsMentioned('I complained to ICBC, not Bank of China.').map((i) => i.name).sort(), ['Bank of China', 'ICBC'])
})

test('card duties come from the ABS Code; the model says nothing of card scheme rules (brief v5, Phase 0b and decision 19)', () => {
  const system = fidrecPackSystem(null)
  assert.match(system, /For card payments, set out the issuer's duties from the ABS Code of Practice for credit cards/)
  assert.match(system, /Do not say what card scheme rules \(Visa, Mastercard, American Express\) allow or require of the issuer/)
  assert.match(system, /Each clause's applies_to names the payments it covers: set a clause only against those payments/)
  // The hand-written chargeback sentence is gone; the reviewed scheme statements of Phase 7 replace it.
  assert.doesNotMatch(system, /right against the scheme/)
  const cardOnly = { ...facts, transactions: { value: [{ date: null, amount: sgd(1), channel: null, payee: null, last4: null, instrument: 'sg_card' }], label: 'confirmed' } } as SnapshotFacts
  assert.match(regulatoryQuery(cardOnly), /card issuer to a cardholder/)
  assert.doesNotMatch(regulatoryQuery(cardOnly), /cooling|token|new device|chargeback/i)
})

test("a regulation's own issue and effective dates may be stated (measured 20 Nov 2026)", () => {
  const [abs] = numberClauses([{ clause_ref: '1', title: 'Safeguards', text_content: 'Enhanced safeguards from 15 October 2025.', source: 'ABS media release', dates: ['2025-10-03', '2025-10-15', null] }])
  assert.deepEqual(abs.dates, ['2025-10-03', '2025-10-15'])
  const duty = { text: 'From 15 October 2025 the ABS safeguards apply; the records show the limit was raised minutes before the transfers.', clause_ids: ['R1'], evidence_ids: ['E1'] }
  const refused = dutyFailures({ ...GOOD, institution_duties: [duty] }, [abs], facts, fidrecPackChecks([]))
  assert.ok(refused.some((f) => f.check === 'date'), 'without the dates the pack is refused')
  assert.deepEqual(dutyFailures({ ...GOOD, institution_duties: [duty] }, [abs], facts, fidrecPackChecks(abs.dates)).filter((f) => f.check === 'date'), [])
  const fn = readFileSync('supabase/functions/run_fidrec_pack_v1/index.ts', 'utf8')
  assert.match(fn, /\.\.\.clauses\.flatMap\(\(c\) => c\.dates\)/)
})

// Part B walk-through, case B (25 Nov), PB-24: a final reply read from a letter has no "qualifies" answer, so the
// filing section said the complaint "is not resolved" and left out the deadline. It now counts from any confirmed
// final reply, and names the document that shows the date (PB-13, wording chosen by Elena).
test('the filing section counts the deadline from a confirmed final reply, whoever states its date', () => {
  const fromLetter = { ...finalReply, date: '2026-11-10', qualifies: null }
  const caseB: SnapshotFacts = { ...facts, bank_reply: { value: fromLetter, label: 'confirmed' } }
  const caseBRoute = fidrecRouteFromFacts(caseB, '2026-11-25')
  assert.equal(caseBRoute.available && caseBRoute.route, 'final_reply', 'a dated reply read from a letter opens the route (Elena, 26 Nov)')
  // doc-letter is E1 in the evidence index.
  const letter = [{ factKey: 'bank_reply' as const, values: [{ value: fromLetter, sources: [{ sourceType: 'document', sourceRef: { documentId: 'doc-letter', documentType: 'bank_correspondence' } }] }], resolution: { kind: 'agreed' as const } }]
  const report = assembleFidrecPack({ prose: GOOD, source: 'model', facts: caseB, findings: letter as never, evidenceIndex: index, route: caseBRoute, finalReplyUsed: true, today: '2026-11-25' })
  // Wording chosen by Elena (25 Nov): the pack says whose date it is and never decides whether the reply "qualifies".
  assert.equal(
    report.route,
    "The institution's letter dated 10 Nov 2026 says it is its final reply (E1). Counted from that date, FIDReC must receive the complaint by 10 May 2027 (six months after the final reply). If the case goes to adjudication, FIDReC charges individuals a S$50 case fee.",
  )
  assert.doesNotMatch(report.route, /not resolved|qualif/)

  const late = assembleFidrecPack({ prose: GOOD, source: 'model', facts: caseB, findings: letter as never, evidenceIndex: index, route: caseBRoute, finalReplyUsed: true, today: '2027-06-01' })
  // CR-2 (27 Nov): after the six months the pack states both dates, the rules and the passage on what a final reply is.
  assert.ok(late.route.startsWith("The institution's letter dated 10 Nov 2026 says it is its final reply (E1). Six months from that date ended on 10 May 2027 (Rule 13(1)(ii); Rule 5(vi)). FIDReC's Terms of Reference say a final reply is"), late.route)

  const noFinalReply: SnapshotFacts = { ...facts, bank_reply: { value: { ...finalReply, status: 'acknowledged', date: null }, label: 'confirmed' } }
  const fourWeeks = assembleFidrecPack({ prose: GOOD, source: 'model', facts: noFinalReply, findings: [], evidenceIndex: index, route: fidrecRouteFromFacts(noFinalReply, '2026-11-25'), finalReplyUsed: false })
  assert.match(fourWeeks.route, /^The complainant complained in writing more than four weeks ago and the complaint is not resolved\./)
})

// PB-23 (wording chosen by Elena, 25 Nov): a case outside the SRF says so before the SRF duties.
test('the duties section opens with one sentence when every payment is likely outside the SRF', () => {
  const investment: SnapshotFacts = {
    ...facts,
    scam_type: { value: ['investment'], label: 'confirmed' },
    transactions: { value: [{ date: '2026-08-02', amount: sgd(3000), channel: null, payee: null, last4: null, instrument: 'account_transfer' }], label: 'confirmed' },
  }
  const outside = assembleFidrecPack({ prose: GOOD, source: 'model', facts: investment, findings: [], evidenceIndex: index, route, finalReplyUsed: false })
  assert.equal(
    outside.duties_note,
    "This payment is likely not covered by the SRF (see 'How the rules may apply'). The duties below are listed because FIDReC can consider how the institution handled the case.",
  )
  const phishing: SnapshotFacts = {
    ...facts,
    scam_type: { value: ['phishing_sms_or_message'], label: 'confirmed' },
    credentials_or_otp_shared: { value: 'entered_on_fake_site_or_app', label: 'confirmed' },
    transactions: { value: [{ date: '2026-08-02', amount: sgd(3000), channel: null, payee: null, last4: null, instrument: 'account_transfer' }], label: 'confirmed' },
  }
  assert.equal(assembleFidrecPack({ prose: GOOD, source: 'model', facts: phishing, findings: [], evidenceIndex: index, route, finalReplyUsed: false }).duties_note, null)
  const view = readFileSync('components/state-machine/layer3/fidrec-pack-view.tsx', 'utf8')
  assert.match(view, /\{pack\.duties_note \? <p className="mb-3 text-sm" data-duties-note>\{pack\.duties_note\}<\/p> : null\}/)
  assert.match(readFileSync('lib/server/facts/fidrec-pack-pdf.ts', 'utf8'), /if \(pack\.duties_note\) await builder\.addParagraph\(pack\.duties_note\)/)
})

// PB-12 (Part B walk-through, 25 Nov): points ended "(E1). (E1)".
test('a closing citation the page adds anyway is not printed twice', () => {
  const prose = {
    ...GOOD,
    arguments_for_claimant: [
      { text: 'The statement records the S$3,000 transfer (E1).', evidence_ids: ['E1'] },
      { text: 'The letter is about another payment (E9).', evidence_ids: ['E1'] },
    ],
    institution_duties: [{ text: 'The records do not show whether the payment was held (R1, R2; E1).', clause_ids: ['R1', 'R2'], evidence_ids: ['E1'] }],
  }
  const report = assembleFidrecPack({ prose, source: 'model', facts, findings: [], evidenceIndex: index, route, finalReplyUsed: false })
  assert.equal(report.arguments_for_claimant[0].text, 'The statement records the S$3,000 transfer.')
  assert.equal(report.arguments_for_claimant[1].text, 'The letter is about another payment (E9).', 'a citation the page does not add stays')
  assert.equal(report.institution_duties[0].text, 'The records do not show whether the payment was held.')
  assert.equal(report.timeline[0].date, '2 Aug 2026', 'PB-10: chronology dates read like the rest of the pack')
})
