// Each account status (credit_account_status) cites only the document it was read from (Lane 6, 25 Nov 2026). Lane 2's
// extraction leaves evidenceId null; the pack sets it from the one document whose text contains the status's quote.
// With no such document, or more than one, it stays null and the line falls back to every document behind the fact.
// Synthetic data only: two invented bureau reports built on Lane 2's overdue fixture.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { SnapshotFacts } from '../../lib/facts'
import { SECTION_8_CLAUSES, SECTION_8_FROM } from '../../supabase/functions/_shared/facts/rules/dispute-charges-checks.ts'
import { buildFidrecUpdate } from '../../supabase/functions/_shared/facts/update/assemble.ts'
import { CLAUSE_KEYS, createFakeClauseProvider, type CreditAccountStatus } from '../../supabase/functions/_shared/facts/update/contract.ts'
import { withStatusEvidenceIds } from '../../supabase/functions/_shared/facts/update/section-input.ts'
import { CREDIT_BUREAU_OVERDUE_TEXT, OVERDUE_LINE } from '../fixtures/evidence/credit-bureau-overdue.ts'
import { cardOnlyCase } from '../fixtures/fidrec-update/index.ts'
import { corpus, evidenceIndex, GENERATED_ON, snapshotFacts } from './fidrec-pack-update-cases.ts'

const SECOND_LINE = 'Account status as at 10 Oct 2025: payment past due'
const SECOND_TEXT = [
  'SECOND EXAMPLE BUREAU (SYNTHETIC) - CREDIT REPORT',
  'Facility: credit card ending 0001',
  SECOND_LINE,
].join('\n')

// The statuses name the case's account (Example Bank A, card ending 0001), as the scoped rule needs (gap a).
const status = (quote: string, statusText: string, asOf: string, bureau: string): CreditAccountStatus =>
  ({
    asOf, statusText, facility: 'credit card ending 0001', bureau, source: 'credit_bureau_report', evidenceId: null, quote,
    accountName: 'Example Bank A credit card ending 0001', lender: 'Example Bank A', last4: '0001', reportDate: '2025-11-02',
  })
const FIRST = status(OVERDUE_LINE, '30 days overdue', '2025-10-15', 'Example Credit Information Bureau')
const SECOND = status(SECOND_LINE, 'payment past due', '2025-10-10', 'Second Example Bureau')

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
function heldSection8() {
  const held = structuredClone(corpus)
  for (const v of held.versions.filter((x) => x.document_key === 'mas.eupg' && x.status === 'verified')) {
    for (const key of CLAUSE_KEYS.disputed_amount_charges) {
      const text = key === SECTION_8_CLAUSES.p8_4
        ? 'Synthetic 8.4: during the following periods: (a) from the investigation up to 30 calendar days after the outcome is given; and (b) after FIDReC completes or closes the case.'
        : `Placeholder text of ${key}.`
      v.clauses.push({ clause_id: `se-${v.version_id}-${key}`, clause_key: key, clause_ref: key.split('/')[1], text_content: text, text_sha256: sha(text), ...(v.effective_from! < SECTION_8_FROM ? { effective_from_override: SECTION_8_FROM } : {}) })
    }
  }
  return held
}

test('a status is placed on the one document whose text holds its quote; otherwise it stays unplaced', () => {
  const facts = { credit_account_status: { value: [FIRST, SECOND, { ...SECOND, evidenceId: 'E2' }], label: 'confirmed' } } as unknown as SnapshotFacts
  const placed = withStatusEvidenceIds(facts, [{ id: 'E7', text: CREDIT_BUREAU_OVERDUE_TEXT }, { id: 'E8', text: SECOND_TEXT }, { id: 'E9', text: null }])
  assert.deepEqual((placed.credit_account_status!.value as CreditAccountStatus[]).map((s) => s.evidenceId), ['E7', 'E8', 'E2'], 'one match each; a set E-number is kept')
  const both = withStatusEvidenceIds(facts, [{ id: 'E7', text: CREDIT_BUREAU_OVERDUE_TEXT }, { id: 'E8', text: `${SECOND_TEXT}\n${OVERDUE_LINE}` }])
  assert.equal((both.credit_account_status!.value as CreditAccountStatus[])[0].evidenceId, null, 'a quote in two documents stays unplaced')
  const none = withStatusEvidenceIds(facts, [{ id: 'E1', text: 'Synthetic statement.' }])
  assert.equal((none.credit_account_status!.value as CreditAccountStatus[])[0].evidenceId, null, 'a quote in no document stays unplaced')
  assert.equal(withStatusEvidenceIds({}, [{ id: 'E1', text: 'x' }]).credit_account_status, undefined)
})

test('two bureau reports: in the assembled pack each status line cites only its own E-number', async () => {
  const facts = { ...snapshotFacts(cardOnlyCase), credit_account_status: { value: [FIRST, SECOND], label: 'confirmed' } } as unknown as SnapshotFacts
  const index = [...evidenceIndex(cardOnlyCase), { id: 'E7', facts: ['credit_account_status'] }, { id: 'E8', facts: ['credit_account_status'] }]
  const build = (documents?: Array<{ id: string; text: string | null }>) => buildFidrecUpdate({
    facts,
    evidenceIndex: index,
    institutionCode: cardOnlyCase.data.institution?.code ?? null,
    ipLocations: cardOnlyCase.data.ipLocations,
    provider: createFakeClauseProvider(heldSection8()),
    creditBureauReportRead: true,
    generatedOn: GENERATED_ON,
    firstClauseNumber: 1,
    documents,
  })
  const statusLines = async (documents?: Array<{ id: string; text: string | null }>) => {
    const u = await build(documents)
    const section = u.results.find((r) => r.sectionId === 'disputed_amount_charges')!
    return section.lines.flatMap((l) => (l.kind === 'account_status' ? [{ quote: l.status.quote, evidenceIds: l.evidenceIds }] : []))
  }
  const placed = await statusLines([{ id: 'E7', text: CREDIT_BUREAU_OVERDUE_TEXT }, { id: 'E8', text: SECOND_TEXT }])
  assert.ok(placed.length >= 2, 'the overdue statuses print beside 8.3 and 8.4(a)')
  for (const line of placed) assert.deepEqual(line.evidenceIds, [line.quote === OVERDUE_LINE ? 'E7' : 'E8'], line.quote)
  // Without the documents' texts, each line falls back to every document behind the fact (as before).
  for (const line of await statusLines()) assert.deepEqual(line.evidenceIds, ['E7', 'E8'], line.quote)
})

test('run_fidrec_pack_v1 passes the index documents with their texts', async () => {
  const { readFileSync } = await import('node:fs')
  const fn = readFileSync('supabase/functions/run_fidrec_pack_v1/index.ts', 'utf8')
  assert.ok(fn.includes('documents: evidenceIndex.map((e) => ({ id: e.id, text: caseDocuments.find((d) => d.id === e.documentId)?.text ?? null })),'))
})
