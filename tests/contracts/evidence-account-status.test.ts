import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFactExtractionPrompt,
  creditAccountStatusSource,
  type CurrentFinding,
  type FactCandidate,
  formatFactValue,
  PAID_STAGE_ONLY_FACT_KEYS,
  parseFactExtraction,
  reconcile,
  requiredFactsFor,
} from '../../lib/facts'
import { findingsForStage, stageSnapshot } from '../../lib/server/facts/facts-service'
import type { CreditAccountStatus } from '../../supabase/functions/_shared/facts/update/contract.ts'
import {
  BALANCE_LINE,
  CREDIT_BUREAU_OVERDUE_TEXT,
  MODEL_OUTPUT_WITH_STATUS,
  OVERDUE_LINE,
} from '../fixtures/evidence/credit-bureau-overdue.ts'

// The account-overdue fact, credit_account_status (Elena, 25 Nov 2026; Lane 6's contract): the account's status as a
// credit bureau report or the institution's letter gives it, separate from credit_bureau_reports. Synthetic data only.

const doc = (id: string) => ({ sourceType: 'document' as const, sourceRef: { sourceKey: `document:${id}`, documentId: id } })
const byKey = (candidates: FactCandidate[], key: string) => candidates.filter((c) => c.factKey === key)
const statusItem = (quote: string, statusText: string, extra: Record<string, unknown> = {}) => ({ as_of: '2025-10-15', status_text: statusText, facility: null, bureau: null, quote, confidence: 0.9, ...extra })

test('the overdue report gives one account status entry and no credit bureau report entry', () => {
  const candidates = parseFactExtraction(MODEL_OUTPUT_WITH_STATUS, CREDIT_BUREAU_OVERDUE_TEXT, doc('cb-1'))
  const [status] = byKey(candidates, 'credit_account_status')
  const expected: CreditAccountStatus = {
    asOf: '2025-10-15',
    statusText: '30 days overdue',
    facility: 'credit card ending 0001',
    bureau: 'Example Credit Information Bureau',
    source: 'credit_bureau_report',
    evidenceId: null,
    quote: OVERDUE_LINE,
  }
  assert.deepEqual(status.value, [expected])
  assert.equal(status.sourceRef.documentType, 'credit_bureau_report')
  assert.equal(status.sourceRef.context, false)
  // The overdue line never becomes a report of the disputed amount (#81).
  assert.deepEqual(byKey(candidates, 'credit_bureau_reports'), [])
})

test("the status must be in the entry's own quote, and the quote in the document", () => {
  const text = CREDIT_BUREAU_OVERDUE_TEXT
  const out = (items: unknown[]) => byKey(parseFactExtraction({ document_type: 'credit_bureau_report', credit_account_status: items }, text, doc('cb-1')), 'credit_account_status')
  // A status not in the quote (paraphrased or from another line) is dropped.
  assert.deepEqual(out([statusItem(OVERDUE_LINE, 'one month late')]), [])
  assert.deepEqual(out([statusItem(BALANCE_LINE, '30 days overdue')]), [])
  // A quote not in the document is dropped.
  assert.deepEqual(out([statusItem('Payment status as at 15 Oct 2025: 60 days overdue', '60 days overdue')]), [])
  // A facility or bureau the document does not name is not kept.
  const [kept] = out([statusItem(OVERDUE_LINE, '30 days overdue', { facility: 'debit card ending 9999', bureau: 'Some Other Bureau' })])
  assert.deepEqual((kept.value as CreditAccountStatus[]).map((s) => [s.statusText, s.facility, s.bureau]), [['30 days overdue', null, null]])
})

test("the institution's letter gives a status with no bureau; a story or a bank statement gives none", () => {
  const letter = 'Example Bank A (synthetic letter), 20 Oct 2025.\nYour card account ending 0001 is in arrears as at 15 Oct 2025.'
  const line = 'Your card account ending 0001 is in arrears as at 15 Oct 2025.'
  const fromLetter = byKey(parseFactExtraction({
    document_type: 'bank_correspondence',
    credit_account_status: [statusItem(line, 'in arrears', { facility: 'card account ending 0001', bureau: 'Example Bank A' })],
  }, letter, doc('l-1')), 'credit_account_status')
  assert.deepEqual((fromLetter[0].value as CreditAccountStatus[]).map((s) => [s.source, s.statusText, s.bureau, s.facility]), [['institution_letter', 'in arrears', null, 'card account ending 0001']])

  const story = 'My card account was 30 days overdue in October 2025.'
  const fromStory = parseFactExtraction({ credit_account_status: [statusItem(story, '30 days overdue')] }, story, { sourceType: 'story', sourceRef: { sourceKey: 'story:r1' } })
  assert.deepEqual(byKey(fromStory, 'credit_account_status'), [])

  const statement = 'EXAMPLE BANK A - CARD STATEMENT (SYNTHETIC)\nAccount status: 30 days overdue'
  const fromStatement = parseFactExtraction({
    document_type: 'card_statement',
    credit_account_status: [statusItem('Account status: 30 days overdue', '30 days overdue')],
  }, statement, doc('s-1'))
  // Nothing at all, not even a context candidate.
  assert.deepEqual(byKey(fromStatement, 'credit_account_status'), [])
  for (const type of ['bank_statement', 'card_statement', 'police_report', 'scam_message', 'bank_access_record', 'card_authentication_record', 'other'] as const) {
    assert.equal(creditAccountStatusSource(type), null, type)
  }
})

test('the prompt asks documents for the status, verbatim, and keeps it out of credit_bureau_reports; stories are not asked', () => {
  const prompt = buildFactExtractionPrompt('document', 'x')
  assert.match(prompt, /"credit_account_status":\[\{"as_of"/)
  assert.match(prompt, /status_text\s+is the status in the document's own words, copied exactly from quote/)
  assert.match(prompt, /a status line goes here, never in credit_bureau_reports/)
  assert.doesNotMatch(buildFactExtractionPrompt('story', 'x'), /credit_account_status/)
})

const statusOf = (asOf: string, statusText: string, quote: string): CreditAccountStatus =>
  ({ asOf, statusText, facility: null, bureau: 'Example Credit Information Bureau', source: 'credit_bureau_report', evidenceId: null, quote })
const stated = (value: CreditAccountStatus[], id: string): FactCandidate =>
  ({ factKey: 'credit_account_status', value, sourceType: 'document', sourceRef: { sourceKey: `document:${id}`, documentId: id, documentType: 'credit_bureau_report', confidence: 0.9, context: false } }) as FactCandidate

test('two reports combine their statuses by date, never as a conflict; paid stages only, behind the switch, never required', async () => {
  const findings = await reconcile([
    stated([statusOf('2025-11-15', '60 days overdue', 'Payment status as at 15 Nov 2025: 60 days overdue')], 'cb-2'),
    stated([statusOf('2025-10-15', '30 days overdue', OVERDUE_LINE)], 'cb-1'),
  ])
  const finding = findings.find((f) => f.factKey === 'credit_account_status')!
  assert.equal(finding.findingType, 'agreed')
  assert.deepEqual((finding.values[0].value as CreditAccountStatus[]).map((s) => s.asOf), ['2025-10-15', '2025-11-15'])

  assert.ok(PAID_STAGE_ONLY_FACT_KEYS.has('credit_account_status'))
  for (const stage of ['free', 'bank', 'fidrec'] as const) assert.ok(!requiredFactsFor(stage, null).includes('credit_account_status'))
  const current = findings.map((f, i) => ({ id: `f${i}`, factKey: f.factKey, findingType: f.findingType, values: f.values, valuesHash: f.valuesHash, status: 'open', resolution: null }) as unknown as CurrentFinding)
  assert.equal(findingsForStage(current, 'free').some((f) => f.factKey === 'credit_account_status'), false)
  assert.equal(findingsForStage(current, 'fidrec', { updateFacts: false }).some((f) => f.factKey === 'credit_account_status'), false)
  assert.equal(findingsForStage(current, 'fidrec', { updateFacts: true }).some((f) => f.factKey === 'credit_account_status'), true)
  assert.equal(stageSnapshot(current, 'fidrec', { updateFacts: false }).facts.credit_account_status, undefined)
})

test('display: the status in the document\'s own words, its date and who gives it', () => {
  assert.equal(
    formatFactValue('credit_account_status', [statusOf('2025-10-15', '30 days overdue', OVERDUE_LINE)]),
    '“30 days overdue”, as at 15 Oct 2025, Example Credit Information Bureau',
  )
  assert.equal(
    formatFactValue('credit_account_status', [{ ...statusOf('2025-10-15', 'in arrears', 'x'), bureau: null, source: 'institution_letter', facility: 'card account ending 0001' }]),
    '“in arrears”, as at 15 Oct 2025, card account ending 0001, the bank\'s letter',
  )
})
