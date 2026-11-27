import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  APPROVED,
  bankPackTimeline,
  describeReferenceSource,
  evidenceLists,
  fidrecChronology,
  parseFidrecPackProse,
  reportItNowText,
  TIER0_CHECKS,
  validateOutput,
  type SnapshotFacts,
} from '../../lib/facts'

// The rest of the decision sheet, approved by Elena on 27 Nov 2026 (items 6-11, 14, 15, 17-21, and her additions).
// Synthetic values only.
const read = (file: string) => readFileSync(file, 'utf8')
const confirmed = <T>(value: T) => ({ value, label: 'confirmed' as const })
const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const fromDocument = (value: unknown, documentId: string) => ({ value, sources: [{ sourceType: 'document', sourceRef: { documentId, documentType: 'bank_statement' } }] })
const fromStory = (value: unknown) => ({ value, sources: [{ sourceType: 'story', sourceRef: {} }] })

test('item 6: a document that shows another value is described beside the confirmed one', () => {
  const facts = { total_loss: confirmed(sgd(900)) }
  const findings = [{ factKey: 'total_loss' as const, values: [fromStory(sgd(900)), fromDocument(sgd(700), 'doc-1')], resolution: { kind: 'choice' as const, index: 0 } }]
  const typed = findings as never
  assert.ok(evidenceLists(facts, typed).shown.includes('You confirmed S$900. Your bank statement (uploaded) shows S$700.'))
  const forFidrec = evidenceLists(facts, typed, { voice: 'complainant', evidenceId: (id) => (id === 'doc-1' ? 'E2' : null) })
  assert.ok(forFidrec.shown.includes('The complainant states S$900. Your bank statement (uploaded) (E2) shows S$700.'), forFidrec.shown.join(' | '))
})

test('item 7: a fact with no document and no example of proof is still listed as missing one', () => {
  const lists = evidenceLists({ date_discovered: confirmed('2026-10-02') }, [])
  assert.match(lists.missing[0], /: 2 Oct 2026\. No document yet\.$/)
})

test('item 8 and 9: the free evaluation is never delivered as a summary version, and nothing says we were notified', () => {
  const screen = read('components/state-machine/facts/confirm-and-evaluate.tsx')
  assert.ok(screen.includes('We couldn’t complete your free evaluation this time. You can try again now. If it still doesn’t work, email info@guidebuoyai.sg.'))
  assert.doesNotMatch(screen, /notified/)
  // Replaced by the wording approved with section 8.3 (limits-and-faults.test.ts).
  assert.match(APPROVED.evaluationCap, /come back tomorrow/)
  const fn = read('supabase/functions/bright-function/index.ts')
  const refusal = fn.indexOf('if (result.source === "fallback") {')
  assert.ok(refusal > 0 && refusal < fn.indexOf('await upsertNarrative('), 'refused before anything is saved')
  assert.match(fn.slice(refusal, refusal + 700), /APPROVED\.evaluationCap/)
})

test('item 10: no words are deleted from the summary; they are rewritten by the AI', () => {
  assert.doesNotMatch(read('supabase/functions/bright-function/index.ts'), /sanitizeSummary|BANNED_SUMMARY_PATTERNS/)
  const failures = validateOutput(['You were at home when the message arrived.'], {}, { forbidden: TIER0_CHECKS.forbidden })
  assert.ok(failures.some((f) => f.check === 'forbidden'))
})

test('item 11: "Report it now" is there when both have been told', () => {
  const told = confirmed({ value: 'yes' })
  assert.equal(reportItNowText({ reported_to_bank: told, reported_to_police: told }), 'You have told your bank and the police.')
  assert.doesNotMatch(read('supabase/functions/bright-function/index.ts'), /delete\(\)\.eq\("case_id", case_id\)\.eq\("narrative_type", "tier0_report_now"\)/)
})

test('items 14, 17 and 18: an empty section says so, on screen and in the PDF, and the total always shows', () => {
  for (const file of ['components/state-machine/layer2/report-view.tsx', 'lib/server/facts/bank-pack-pdf.ts', 'components/state-machine/layer3/fidrec-pack-view.tsx', 'lib/server/facts/fidrec-pack-pdf.ts']) {
    for (const key of ['noDatedEvents', 'noPayments', 'noTotal', 'noDocuments']) assert.ok(read(file).includes(`APPROVED.${key}`), `${file}: ${key}`)
  }
  for (const file of ['components/state-machine/layer3/fidrec-pack-view.tsx', 'lib/server/facts/fidrec-pack-pdf.ts']) {
    assert.ok(read(file).includes('APPROVED.noInstitutionPoint'), file)
  }
})

test('item 15: the bank’s reply is in the bank pack’s timeline, in date order, with its date said once', () => {
  const facts = {
    date_discovered: confirmed('2026-10-01'),
    bank_reply: confirmed({ status: 'final_reply', date: '2026-10-20', outcome: null, qualifies: null, reference: null }),
    written_complaint_sent: confirmed({ value: 'yes', date: '2026-10-05', reference: null, channel: null }),
  } as unknown as SnapshotFacts
  const items = bankPackTimeline(facts)
  assert.deepEqual(items.map((i) => i.event), ['I found out about the scam', 'I sent a written complaint', 'My bank gave its final reply on 20 Oct 2026.'])
  assert.equal(items[2].date, undefined)
  const interim = bankPackTimeline({ bank_reply: confirmed({ status: 'interim', date: '2026-10-09', outcome: null, qualifies: null, reference: null }) } as unknown as SnapshotFacts)
  assert.equal(interim[0].event, 'My bank replied on 9 Oct 2026.')
})

test('item 19: an unreadable file is refused with a request to upload it again', () => {
  const panel = read('components/state-machine/layer1/evidence-upload-panel.tsx')
  assert.ok(panel.includes('APPROVED.unreadableFile'))
  assert.doesNotMatch(panel, /could not be processed/)
})

test('item 20: a long list is rewritten, not cut', () => {
  const argument = { text: 'p', evidence_ids: [] }
  const prose = parseFidrecPackProse({
    title: 't', executive_summary: 'e', claimant_position: 'c', institution_position: 'i',
    arguments_for_claimant: Array(14).fill(argument), arguments_for_institution: [argument], institution_duties: Array(11).fill({ text: 'd', clause_ids: ['R1'], evidence_ids: [] }),
  })
  assert.equal(prose?.arguments_for_claimant.length, 14)
  assert.equal(prose?.institution_duties.length, 11)
  assert.match(read('supabase/functions/run_fidrec_pack_v1/index.ts'), /listLengthFailures\(prose\)/)
})

test('item 21: the FIDReC chronology says when no final reply had been received', () => {
  const facts = { bank_reply: confirmed({ status: 'none', date: null, outcome: null, qualifies: null, reference: null }) } as unknown as SnapshotFacts
  assert.deepEqual(fidrecChronology(facts).map((i) => i.event), ['No final reply from the institution had been received when the facts were confirmed.'])
})

test('the bank pack names the institution’s letter in the customer’s voice', () => {
  const documents = [{ id: 'x', label: '', type: 'bank_correspondence', text: 'Our reference TST-100.' }]
  assert.equal(describeReferenceSource('TST-100', { documents, story: '', voice: 'first_person' }), 'the reference shown in my bank’s letter or email')
})

test('every payment is read: the reading step has room for a long statement', () => {
  const reconcile = read('lib/server/facts/run-reconcile.ts')
  assert.match(reconcile, /const DOCUMENT_PART_CHARS = 5_000/)
  assert.match(reconcile, /const DOCUMENT_OUTPUT_CAP = 8_192/)
  assert.match(reconcile, /maxOutputTokens: schemaName === "facts_document" \? DOCUMENT_OUTPUT_CAP : OUTPUT_CAPS\.fact_extraction/)
})
