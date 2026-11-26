// CR-1 (Elena, 25 Nov 2026): the "Police investigation" section of the FIDReC pack, the optional police reply, the
// documents-to-provide entry, the fidrec.tor/5 citation and the switch. Synthetic data only: invented dates, invented
// E-numbers and an invented police reply.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assembleFidrecPack,
  buildFactExtractionPrompt,
  DOCUMENT_TYPES,
  documentTypeOf,
  type FactCandidate,
  FACT_LABELS,
  fidrecPackFallback,
  fidrecRouteFromFacts,
  formatFactValue,
  parseFactExtraction,
  PAID_STAGE_ONLY_FACT_KEYS,
  type SnapshotFacts,
} from '../../lib/facts'
import { checkPackEvidence, EVIDENCE_ITEMS, EVIDENCE_RULES, type EvidenceDocument } from '../../supabase/functions/_shared/evidence-minimums.ts'
import * as extractionV3 from '../../supabase/functions/_shared/facts/extraction-v3.ts'
import { verbatimSpan } from '../../supabase/functions/_shared/facts/extraction.ts'
import { buildEvidenceIndex, type EvidenceIndexEntry, policeReplyChecklistItem, policeReplyEvidenceIds } from '../../supabase/functions/_shared/facts/fidrec-pack.ts'
import { DOCUMENT_LABELS, POLICE_REPLY_SUGGESTION } from '../../supabase/functions/_shared/facts/free-sections.ts'
import { DOCUMENT_ONLY_FACT_KEYS } from '../../supabase/functions/_shared/facts/keys.ts'
import { FIDREC_CLAUSE_KEYS, FIDREC_RULES } from '../../supabase/functions/_shared/facts/rules/fidrec.ts'
import {
  createPoliceInvestigationSection,
  POLICE_INVESTIGATION_CLAUSE_KEY,
  POLICE_INVESTIGATION_WORDING,
  readPoliceInvestigation,
} from '../../supabase/functions/_shared/facts/rules/police-investigation.ts'
import { buildFidrecUpdate } from '../../supabase/functions/_shared/facts/update/assemble.ts'
import {
  CLAUSE_KEYS,
  type ContractFacts,
  createFakeClauseProvider,
  OPTIONAL_UPDATE_DOCUMENT_TYPES,
  POLICE_REPLY_DOCUMENT_TYPE,
  POLICE_REPLY_EVIDENCE_TYPE,
  RULE_CLAUSE_KEYS,
  SECTION_IDS,
  type SectionInput,
  UPDATE_FACT_KEYS,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { printedText, SECTION_HEADINGS } from '../../supabase/functions/_shared/facts/update/render.ts'
import { ruleCitations } from '../../scripts/standards/seeds.ts'
import { accountSrfCase, syntheticCorpus } from '../fixtures/fidrec-update/index.ts'

const read = (path: string) => readFileSync(path, 'utf8')
const confirmed = <T>(value: T) => ({ value, label: 'confirmed' as const })
const provider = createFakeClauseProvider(syntheticCorpus)
const GENERATED_ON = '2026-11-24'

// Elena's approved wording, typed out here so a change to the constants is caught.
const RULE_SENTENCE =
  `FIDReC's Terms of Reference, Rule 5(iv), say FIDReC cannot take "cases under investigation by any law enforcement agency, including cases where allegations of fraud or criminal activity have been made, and where the matter has been referred to the police for investigation".`
const NO_REPLY_SENTENCE = 'The complainant did not provide a reply from the police on the outcome of the investigation.'

// A synthetic reply from the police. The statement is quoted word for word; nothing in it says "closed".
const REPLY_STATEMENT = 'Investigations into your report are ongoing and the matter remains under investigation.'
const POLICE_REPORT = confirmed({ value: 'yes' as const, date: '2026-09-28', reference: null, channel: 'online' })
const POLICE_REPLY = confirmed({ date: '2026-10-03', statement: REPLY_STATEMENT })

function input(facts: ContractFacts, evidenceIds: SectionInput['evidenceIds'], policeReplyEvidenceIds?: string[]): SectionInput {
  return {
    facts,
    payments: [],
    institution: null,
    instruments: [],
    ipLocations: [],
    evidenceIds,
    provider,
    generatedOn: GENERATED_ON,
    ...(policeReplyEvidenceIds ? { policeReplyEvidenceIds } : {}),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The section's two forms
// ---------------------------------------------------------------------------------------------------------------

test('with the police reply: the approved paragraph, dates as "3 Oct 2026", the reply quoted word for word with its E-number', async () => {
  const result = await createPoliceInvestigationSection()(
    input({ reported_to_police: POLICE_REPORT, police_investigation_reply: POLICE_REPLY }, { reported_to_police: ['E3'], police_investigation_reply: ['E6'] }, ['E6']),
  )
  assert.equal(result.sectionId, 'police_investigation')
  assert.equal(result.lines.length, 1)
  const line = result.lines[0]
  assert.ok(line.kind === 'text')
  assert.equal(
    line.text,
    `${RULE_SENTENCE} A police report was made on 28 Sep 2026 (E3). The police's reply dated 3 Oct 2026 states: "${REPLY_STATEMENT}" (E6).`,
  )
  // The E-numbers are inside the sentences, so the renderer adds none after them.
  assert.deepEqual(line.evidenceIds, [])
  assert.deepEqual(line.clauseKeys, [])
  assert.doesNotMatch(line.text, /closed/i, 'the reply does not say closed, so neither does the pack')
})

test('without a police reply: the last sentence is the approved "did not provide" sentence', async () => {
  const result = await createPoliceInvestigationSection()(input({ reported_to_police: POLICE_REPORT }, { reported_to_police: ['E3', 'E1'] }))
  const line = result.lines[0]
  assert.ok(line.kind === 'text')
  assert.equal(line.text, `${RULE_SENTENCE} A police report was made on 28 Sep 2026 (E1, E3). ${NO_REPLY_SENTENCE}`)
  assert.equal(POLICE_INVESTIGATION_WORDING.noReply, NO_REPLY_SENTENCE)
  assert.equal(POLICE_INVESTIGATION_WORDING.rule, RULE_SENTENCE)
})

test('the pack says the investigation is closed only when the reply itself says so', async () => {
  const closed = 'Following investigations, the case has been classified as closed with no further action.'
  const r = readPoliceInvestigation(
    input({ reported_to_police: POLICE_REPORT, police_investigation_reply: confirmed({ date: '2026-10-03', statement: closed }) }, { reported_to_police: ['E3'], police_investigation_reply: ['E6'] }),
  )
  assert.ok(r.kind === 'printed')
  assert.ok(r.text.endsWith(`states: "${closed}" (E6).`))
  // Every "closed" in the text is inside the reply's quoted words.
  const outsideQuote = r.text.replace(`"${closed}"`, '')
  assert.doesNotMatch(outsideQuote, /closed|concluded|no further action/i)
})

test('nothing is invented: with no police report, no date for it, no document behind it, or a reply it cannot read, the section prints nothing', async () => {
  const none = (facts: ContractFacts, ids: SectionInput['evidenceIds'], replyIds?: string[]) => readPoliceInvestigation(input(facts, ids, replyIds))
  assert.deepEqual(none({}, {}), { kind: 'not_printed', reason: 'no_police_report' })
  assert.deepEqual(none({ reported_to_police: confirmed({ value: 'no' as const, date: null, reference: null, channel: null }) }, {}), { kind: 'not_printed', reason: 'no_police_report' })
  assert.deepEqual(none({ reported_to_police: { ...POLICE_REPORT, label: 'not_sure' as const } }, { reported_to_police: ['E3'] }), { kind: 'not_printed', reason: 'no_police_report' })
  assert.deepEqual(none({ reported_to_police: confirmed({ ...POLICE_REPORT.value, date: null }) }, { reported_to_police: ['E3'] }), { kind: 'not_printed', reason: 'police_report_not_dated' })
  assert.deepEqual(none({ reported_to_police: POLICE_REPORT }, {}), { kind: 'not_printed', reason: 'police_report_not_documented' })
  // A reply was uploaded but no words or date could be read from it: neither form is true, so nothing prints.
  assert.deepEqual(none({ reported_to_police: POLICE_REPORT }, { reported_to_police: ['E3'] }, ['E6']), { kind: 'not_printed', reason: 'reply_not_read' })
  assert.deepEqual(
    none({ reported_to_police: POLICE_REPORT, police_investigation_reply: confirmed({ date: null, statement: REPLY_STATEMENT }) }, { reported_to_police: ['E3'], police_investigation_reply: ['E6'] }),
    { kind: 'not_printed', reason: 'reply_not_read' },
  )
  assert.deepEqual(
    none({ reported_to_police: POLICE_REPORT, police_investigation_reply: { ...POLICE_REPLY, label: 'not_sure' as const } }, { reported_to_police: ['E3'], police_investigation_reply: ['E6'] }),
    { kind: 'not_printed', reason: 'reply_not_read' },
  )
  const empty = await createPoliceInvestigationSection()(input({}, {}))
  assert.deepEqual(empty, { sectionId: 'police_investigation', lines: [], citations: [], flags: [] })
})

// ---------------------------------------------------------------------------------------------------------------
// The citation
// ---------------------------------------------------------------------------------------------------------------

test('citation: fidrec.tor/5 is listed with the clause keys the pack cites, held by the FIDReC manifest, and tracked as a rule citation', async () => {
  assert.equal(POLICE_INVESTIGATION_CLAUSE_KEY, 'fidrec.tor/5')
  assert.deepEqual([...CLAUSE_KEYS.police_investigation], ['fidrec.tor/5'])
  assert.ok((RULE_CLAUSE_KEYS as readonly string[]).includes('fidrec.tor/5'))
  // The committed FIDReC Terms of Reference manifest has a clause for Rule 5.
  const manifest = JSON.parse(read('supabase/standards/manifests/fidrec.tor.2025-07-01.json')) as { document: { document_key: string }; clauses: Array<{ clause_key: string; clause_ref: string }> }
  assert.equal(manifest.document.document_key, 'fidrec.tor')
  assert.equal(manifest.clauses.find((c) => c.clause_key === 'fidrec.tor/5')?.clause_ref, 'Rule 5')
  // The server rule and its corpus citation (standard_rule_citations, built by the seed step).
  assert.equal(FIDREC_RULES.excludedUnderInvestigation.cite, 'Rule 5(iv)')
  assert.deepEqual(FIDREC_CLAUSE_KEYS.excludedUnderInvestigation, ['fidrec.tor/5'])
  assert.ok(ruleCitations().some((r) => r.rule_id === 'fidrec.excluded_under_investigation' && r.clause_key === 'fidrec.tor/5'))
  // The section pins the clause it cites, read as of the day the pack is generated.
  const result = await createPoliceInvestigationSection()(input({ reported_to_police: POLICE_REPORT }, { reported_to_police: ['E3'] }))
  assert.deepEqual(result.citations.map((c) => [c.clauseKey, c.onDate, c.clauseId]), [['fidrec.tor/5', GENERATED_ON, 'cl-fidrec-tor-5']])
  assert.deepEqual(result.flags, [])
  // A corpus without the rule: the approved paragraph still prints (its words are Elena's) and the run is flagged.
  const bare = createFakeClauseProvider({ versions: [], statements: [] })
  const flagged = await createPoliceInvestigationSection()({ ...input({ reported_to_police: POLICE_REPORT }, { reported_to_police: ['E3'] }), provider: bare })
  assert.equal(flagged.lines.length, 1)
  assert.deepEqual(flagged.flags, [{ code: 'clause_not_held', key: 'fidrec.tor/5', onDate: GENERATED_ON }])
})

// ---------------------------------------------------------------------------------------------------------------
// The optional document
// ---------------------------------------------------------------------------------------------------------------

const doc = (id: string, type: string | null): EvidenceDocument => ({ id, verified_document_type: type, complainant_item: null, processing_status: 'ready' })
const REQUIRED = [doc('d-statement', 'BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS'), doc('d-police', 'POLICE_REPORT_OF_FRAUD_SCAM'), doc('d-reply', 'BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY')]

test('the police reply is optional: never an evidence item, never required, never blocks generation, and never counts as the police report', () => {
  assert.equal(POLICE_REPLY_DOCUMENT_TYPE, 'police_reply')
  assert.ok((OPTIONAL_UPDATE_DOCUMENT_TYPES as readonly string[]).includes(POLICE_REPLY_DOCUMENT_TYPE))
  // Not an evidence item, so the complainant_item column (CHECK constraint) needs no change.
  assert.deepEqual([...EVIDENCE_ITEMS], ['payment_proof', 'police_report', 'bank_reply_or_complaint', 'scam_message'])
  for (const rule of Object.values(EVIDENCE_RULES)) assert.ok(!rule.types.includes(POLICE_REPLY_EVIDENCE_TYPE))
  for (const product of ['bank', 'fidrec'] as const) {
    const without = checkPackEvidence(product, REQUIRED)
    const withReply = checkPackEvidence(product, [...REQUIRED, doc('d-police-reply', POLICE_REPLY_EVIDENCE_TYPE)])
    assert.equal(without.ready, true, product)
    assert.deepEqual(withReply, { ...without, items: without.items }, product)
  }
  // The reply alone does not stand in for the police report.
  assert.deepEqual(
    checkPackEvidence('fidrec', [REQUIRED[0], REQUIRED[2], doc('d-police-reply', POLICE_REPLY_EVIDENCE_TYPE)]).missing,
    ['police_report'],
  )
  const migrations = read('supabase/migrations/20261124120000_document_complainant_item.sql')
  assert.ok(!migrations.includes('police_reply'))
})

test('the documents-to-provide list: the police reply is suggested as optional when none was provided, shown when it was', () => {
  const facts = accountSrfCase.data.facts as unknown as SnapshotFacts
  const route = fidrecRouteFromFacts(facts, GENERATED_ON)
  const base = { prose: fidrecPackFallback(facts), source: 'fallback' as const, facts, findings: [], evidenceIndex: [], route, finalReplyUsed: false }
  const rendered = { sections: [], citations: [], statements: [], flags: [], generatedOn: GENERATED_ON }
  const missing = assembleFidrecPack({ ...base, update: rendered })
  assert.deepEqual(missing.evidence_checklist.at(-1), { label: POLICE_REPLY_SUGGESTION, present: false })
  assert.match(POLICE_REPLY_SUGGESTION, /optional/)
  const provided = assembleFidrecPack({ ...base, update: rendered, policeReplyEvidenceIds: ['E6'] })
  assert.deepEqual(provided.evidence_checklist.at(-1), { label: `${FACT_LABELS.police_investigation_reply}: shown by ${DOCUMENT_LABELS.police_reply}.`, present: true })
  // Already listed through the confirmed facts: not listed twice.
  assert.equal(policeReplyChecklistItem([`${FACT_LABELS.police_investigation_reply}: Dated 3 Oct 2026: “x”. Shown by y.`], true), null)
  // With the switch off (no update) the list is as before.
  const off = assembleFidrecPack(base)
  assert.ok(!off.evidence_checklist.some((i) => i.label === POLICE_REPLY_SUGGESTION || i.label.startsWith(FACT_LABELS.police_investigation_reply)))
})

test('the evidence index finds the police reply by either reading, and labels it by kind', () => {
  const documents = [
    { id: 'doc-a', evidenceType: POLICE_REPLY_EVIDENCE_TYPE, text: 'Synthetic police reply.' },
    { id: 'doc-b', evidenceType: 'BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS', text: 'Synthetic statement.' },
  ]
  const index = buildEvidenceIndex([], documents)
  assert.deepEqual(index.map((e) => [e.id, e.label]), [['E1', DOCUMENT_LABELS.police_reply], ['E2', 'your bank statement (uploaded)']])
  assert.deepEqual(policeReplyEvidenceIds(index, documents), ['E1'])
  const byFact: EvidenceIndexEntry[] = [{ id: 'E4', documentId: 'doc-c', label: 'an uploaded document', facts: ['police_investigation_reply'] }]
  assert.deepEqual(policeReplyEvidenceIds(byFact), ['E4'])
  assert.deepEqual(policeReplyEvidenceIds([{ id: 'E1', documentId: 'doc-b', label: 'your bank statement (uploaded)', facts: [] }], documents), [])
})

// ---------------------------------------------------------------------------------------------------------------
// Extraction: the reply's own words and date, never a paraphrase
// ---------------------------------------------------------------------------------------------------------------

const replyText = [
  'EXAMPLE POLICE DIVISION (SYNTHETIC)',
  'Date: 3 October 2026',
  'Dear Sir/Madam,',
  'We refer to your report made on 28 September 2026.',
  'Investigations into your report are ongoing and the matter',
  'remains under investigation.',
  'Yours faithfully, Example Officer',
].join('\n')
const source = { sourceType: 'document' as const, sourceRef: { sourceKey: 'document:d-pr', documentId: 'd-pr' } }
const byKey = (candidates: FactCandidate[], key: string) => candidates.filter((c) => c.factKey === key)

test('extraction: the statement is the reply\'s own words across a line break, the date is the one the reply writes', () => {
  const candidates = parseFactExtraction({
    document_type: 'police_reply',
    police_investigation_reply: { date: '2026-10-03', date_line: 'Date: 3 October 2026', quote: REPLY_STATEMENT, confidence: 0.9 },
  }, replyText, source)
  const [reply] = byKey(candidates, 'police_investigation_reply')
  assert.deepEqual(reply.value, { date: '2026-10-03', statement: REPLY_STATEMENT })
  assert.equal((reply.sourceRef as { documentType?: string }).documentType, 'police_reply')
  assert.equal((reply.sourceRef as { context?: boolean }).context, false)
  assert.equal(formatFactValue('police_investigation_reply', reply.value), `Dated 3 Oct 2026: “${REPLY_STATEMENT}”`)
})

test('extraction: a paraphrase, a conclusion or a date the reply does not write is dropped, never printed', () => {
  const parse = (item: Record<string, unknown>, type = 'police_reply') =>
    byKey(parseFactExtraction({ document_type: type, police_investigation_reply: { confidence: 0.9, ...item } }, replyText, source), 'police_investigation_reply')
  assert.deepEqual(parse({ date: '2026-10-03', date_line: 'Date: 3 October 2026', quote: 'The police have closed the case.' }), [])
  assert.deepEqual(parse({ date: '2026-10-03', date_line: 'Date: 3 October 2026', quote: 'investigations into your report are ongoing' }), [], 'letter case must match')
  // A date the line does not write: the statement is kept, the date is not (the section then prints nothing).
  const [noDate] = parse({ date: '2026-10-05', date_line: 'Date: 3 October 2026', quote: REPLY_STATEMENT })
  assert.deepEqual(noDate.value, { date: null, statement: REPLY_STATEMENT })
  // Only a police reply gives the fact.
  assert.deepEqual(parse({ date: '2026-10-03', date_line: 'Date: 3 October 2026', quote: REPLY_STATEMENT }, 'bank_correspondence'), [])
  // Too long to quote whole: dropped, never cut.
  assert.equal(verbatimSpan(`${'word '.repeat(200)}end`, `${'word '.repeat(200)}end`), null)
  assert.equal(verbatimSpan('He said “it is ongoing” today.', 'He said "it is ongoing" today.'), 'He said “it is ongoing” today.')
})

test('extraction: the police reply keeps its type even though it opens like a police document', () => {
  assert.ok((DOCUMENT_TYPES as readonly string[]).includes('police_reply'))
  const opening = 'Singapore Police Force (synthetic)\nPolice report no. A/20260928/0001\nYour report is under investigation.'
  assert.equal(documentTypeOf('police_reply', opening), 'police_reply')
  assert.equal(documentTypeOf('other', opening), 'police_report')
  assert.ok(UPDATE_FACT_KEYS.includes('police_investigation_reply'))
  assert.ok(DOCUMENT_ONLY_FACT_KEYS.has('police_investigation_reply'))
  assert.ok(PAID_STAGE_ONLY_FACT_KEYS.has('police_investigation_reply'))
  const prompt = buildFactExtractionPrompt('document', 'x')
  assert.match(prompt, /police_investigation_reply: only from a police_reply/)
  assert.match(prompt, /Never summarise, shorten or reword it/)
  // Stories and answers are never asked for it.
  assert.doesNotMatch(buildFactExtractionPrompt('story', 'x'), /police_investigation_reply/)
})

// ---------------------------------------------------------------------------------------------------------------
// End to end, and the switch
// ---------------------------------------------------------------------------------------------------------------

test('end to end: the assembled update prints the "Police investigation" section last before standards, quoting the reply', async () => {
  const facts = { ...(accountSrfCase.data.facts as unknown as SnapshotFacts), police_investigation_reply: POLICE_REPLY } as unknown as SnapshotFacts
  const evidenceIndex = [
    { id: 'E3', facts: ['reported_to_police'] },
    { id: 'E6', facts: ['police_investigation_reply'] },
  ]
  const u = await buildFidrecUpdate({
    facts,
    evidenceIndex,
    institutionCode: null,
    ipLocations: [],
    provider,
    generatedOn: GENERATED_ON,
    policeReplyEvidenceIds: ['E6'],
    firstClauseNumber: 1,
  })
  assert.equal(SECTION_HEADINGS.police_investigation, 'Police investigation')
  assert.equal(SECTION_IDS[SECTION_IDS.indexOf('standards') - 1], 'police_investigation')
  const section = u.rendered.sections.find((s) => s.id === 'police_investigation')!
  assert.equal(section.heading, 'Police investigation')
  assert.deepEqual(section.lines, [{
    kind: 'paragraph',
    text: `${RULE_SENTENCE} A police report was made on 4 Jul 2025 (E3). The police's reply dated 3 Oct 2026 states: "${REPLY_STATEMENT}" (E6).`,
  }])
  assert.ok(u.rendered.citations.some((c) => c.clauseKey === 'fidrec.tor/5'))
  assert.ok(u.prompt.sections.some((s) => s.id === 'police_investigation'))
  assert.ok(printedText(u.rendered).includes('Police investigation'))
})

test('switch off: nothing of CR-1 renders or is read', () => {
  // The pack function builds the section and the checklist line only through the update, which is null when off.
  const fn = read('supabase/functions/run_fidrec_pack_v1/index.ts')
  assert.match(fn, /const policeReplyIds = UPDATE_SECTIONS \? policeReplyEvidenceIds\(evidenceIndex, caseDocuments\) : \[\];/)
  assert.match(fn, /let update: \w+ \| null = null;\s*\n\s*if \(UPDATE_SECTIONS\) \{/)
  // The evidence pipeline types a document as the police's reply only with the switch on.
  const pipeline = read('supabase/functions/evidence_processed_v2/index.ts')
  assert.match(pipeline, /const UPDATE_EVIDENCE_TYPES = new Set\(\[[^\]]*"POLICE_INVESTIGATION_OUTCOME"[^\]]*\]\);/)
  assert.match(pipeline, /const ACTIVE_EVIDENCE_TYPES = UPDATE_SECTIONS \? EVIDENCE_TYPES : EVIDENCE_TYPES\.filter\(\(t\) => !UPDATE_EVIDENCE_TYPES\.has\(t\)\);/)
  assert.match(pipeline, /CREDIT_BUREAU_REPORT\|POLICE_INVESTIGATION_OUTCOME\):/, 'its definition is left out of main\'s definitions')
  // The extraction used with the switch off (fact-extract-v3) has no police reply type and asks for no reply.
  assert.ok(!(extractionV3.DOCUMENT_TYPES as readonly string[]).includes('police_reply'))
  assert.doesNotMatch(extractionV3.buildFactExtractionPrompt('document', 'x'), /police_reply|police_investigation_reply/)
  // The report assembled without the update has no police section and no checklist line.
  const facts = accountSrfCase.data.facts as unknown as SnapshotFacts
  const report = assembleFidrecPack({
    prose: fidrecPackFallback(facts),
    source: 'fallback',
    facts,
    findings: [],
    evidenceIndex: [],
    route: fidrecRouteFromFacts(facts, GENERATED_ON),
    finalReplyUsed: false,
    policeReplyEvidenceIds: ['E6'],
  })
  assert.equal(report.update_sections, undefined)
  assert.ok(!JSON.stringify(report).includes('Police investigation'))
  assert.ok(!JSON.stringify(report).includes(FACT_LABELS.police_investigation_reply))
})
