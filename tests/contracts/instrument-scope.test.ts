import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  appliesToCase,
  appliesToInstrument,
  appliesToLabel,
  eupgParagraphAppliesToCards,
  numberClauses,
  paragraphOf,
  routeClauses,
  standardFamily,
} from '../../lib/facts'

// FIDReC standards brief v5, Phase 0b (decision 18): no card payment is set against an SRF clause or an EUPG paragraph
// outside 4.2-4.6, 4.10-4.12 and 4.14-4.16 (EUPG 4.1, 5.1; SRF footnote 1), in the pack or in the older pipeline.
// Clause shapes follow the corpus rows: EUPG and SRF rows have no clause_ref, so the paragraph is read from the text.

const EUPG = 'MAS E-Payments User Protection Guidelines (2018, revised 2024)'
const SRF = 'MAS SRF Guidelines (2024)'
const ABS = 'ABS CODE OF PRACTICE BANKS CREDIT CARDS 2020'
const row = (source: string, title: string, text: string, clause_ref: string | null = null) => ({ source, title, text_content: text, clause_ref })

const eupg = (text: string) => row(EUPG, 'EPUG – FI Duty', text)
const clauses = {
  eupg41: eupg('4 Duties of the responsible FI 4.1 Section 4 does not apply to any responsible FI in respect of card products…'),
  eupg42: eupg('4.2 A responsible FI should inform every account holder of a protected account of the user protection duties…'),
  eupg44: eupg('4.4 The responsible FI should not send clickable links or QR codes via email or SMS…'),
  eupg47: eupg('4.7 The responsible FI should impose a cooling off period of at least 12 hours…'),
  eupg410: eupg('4.10 The responsible FI should provide outgoing transaction notifications…'),
  eupg416: eupg('4.16 The responsible FI should provide a reporting channel…'),
  eupg421: eupg('4.21 The responsible FI should put in place real-time fraud surveillance…'),
  eupg51: eupg('5 Liability for losses arising from unauthorised transactions 5.1 Section 5 does not apply to card transactions…'),
  eupg52: eupg('5.2 The account holder of a protected account is liable for actual loss arising from an unauthorised transaction where…'),
  eupgDefinition: eupg('‘access code’ means a password, code or any other arrangement…'),
  srf421: row(SRF, 'SRF – FI Duty: 12-Hour Cooling-Off for New Token/Device', '4.2.1 [From paragraph 4.7 of the EUPG] The responsible FI imposes a cooling off period…'),
  srfAdhere: row(SRF, 'SRF – FI Duty: Adhere to EUPG Section 4 Duties', '4 Duties of the responsible FI 4.1 Responsible FIs’ duties set out in Section 4 of these…'),
  abs5a: row(ABS, 'Liability', 'A cardholder who has not acted fraudulently or with gross negligence…', '5(a)'),
  notice: row('MAS Notice FSM-N05 (2024)', 'Customer information', 'A bank shall implement IT controls to protect customer information…', '9'),
}

test('the document is recognised before the clause title, so an SRF clause naming the EUPG stays SRF', () => {
  const locate = (c: ReturnType<typeof row>) => ({ source: c.source, title: c.title, clause_ref: c.clause_ref, text: c.text_content })
  assert.equal(standardFamily(locate(clauses.srfAdhere)), 'srf')
  assert.equal(standardFamily(locate(clauses.eupg47)), 'eupg')
  assert.equal(standardFamily(locate(clauses.abs5a)), 'abs_card_code')
  assert.equal(standardFamily(locate(clauses.notice)), 'other')
  // The older pipeline has clause titles only.
  assert.equal(standardFamily({ title: 'EPUG – Loss Rule: Scope of Section 5 (Card Products Excluded)' }), 'eupg')
  assert.equal(standardFamily({ title: 'SRF – FI Duty: Adhere to EUPG Section 4 Duties' }), 'srf')
})

test('the paragraph comes from clause_ref, or from the start of the text after any section heading', () => {
  assert.equal(paragraphOf({ text: clauses.eupg41.text_content }), '4.1')
  assert.equal(paragraphOf({ text: clauses.eupg52.text_content }), '5.2')
  assert.equal(paragraphOf({ text: clauses.srf421.text_content }), '4.2.1')
  assert.equal(paragraphOf({ text: clauses.eupgDefinition.text_content }), null)
  assert.equal(paragraphOf({ clause_ref: '4.10', text: 'anything' }), '4.10')
})

test('EUPG 4.1: only 4.2-4.6, 4.10-4.12 and 4.14-4.16 apply to card payments', () => {
  const table: Array<[string | null, boolean]> = [
    ['4.1', false], ['4.2', true], ['4.6', true], ['4.7', false], ['4.9', false], ['4.10', true], ['4.12', true],
    ['4.13', false], ['4.14', true], ['4.16', true], ['4.17', false], ['4.21', false], ['4.25', false], ['4.26', false],
    ['5.1', false], ['5.2', false], ['5.6', false], ['6.1', false], ['7.8', false], [null, false],
  ]
  for (const [paragraph, expected] of table) assert.equal(eupgParagraphAppliesToCards(paragraph), expected, String(paragraph))
})

test('each kind of payment gets only the clauses that apply to it', () => {
  const locate = (c: ReturnType<typeof row>) => ({ source: c.source, title: c.title, clause_ref: c.clause_ref, text: c.text_content })
  const expected: Record<keyof typeof clauses, { card: boolean; account: boolean }> = {
    eupg41: { card: false, account: true },
    eupg42: { card: true, account: true },
    eupg44: { card: true, account: true },
    eupg47: { card: false, account: true },
    eupg410: { card: true, account: true },
    eupg416: { card: true, account: true },
    eupg421: { card: false, account: true },
    eupg51: { card: false, account: true },
    eupg52: { card: false, account: true },
    eupgDefinition: { card: false, account: true },
    srf421: { card: false, account: true },
    srfAdhere: { card: false, account: true },
    abs5a: { card: true, account: false },
    notice: { card: true, account: true },
  }
  for (const [key, want] of Object.entries(expected) as Array<[keyof typeof clauses, { card: boolean; account: boolean }]>) {
    assert.equal(appliesToInstrument(locate(clauses[key]), 'sg_card'), want.card, `${key} for cards`)
    assert.equal(appliesToInstrument(locate(clauses[key]), 'account_transfer'), want.account, `${key} for account transfers`)
    assert.equal(appliesToInstrument(locate(clauses[key]), 'ewallet'), want.account, `${key} for e-wallets`)
    assert.equal(appliesToInstrument(locate(clauses[key]), 'other'), true, `${key} for an unknown kind`)
  }
})

test('a card-only case receives no SRF clause and no EUPG paragraph outside the card list', () => {
  const routed = routeClauses(Object.values(clauses), ['sg_card', 'sg_card'], 20)
  for (const c of routed) {
    assert.notEqual(c.source, SRF)
    if (c.source === EUPG) assert.ok(/^4\.(2|4|10|16)\b/.test(c.text_content), c.text_content)
  }
  assert.ok(routed.some((c) => c.source === ABS))
  assert.ok(routed.every((c) => c.applies_to === 'all payments'))
})

test('a mixed case gets each clause labelled with the payments it covers', () => {
  const instruments = ['account_transfer', 'sg_card'] as const
  const routed = numberClauses(routeClauses(Object.values(clauses), [...instruments], 20))
  const label = (text: string) => routed.find((c) => c.text.startsWith(text))?.applies_to
  assert.equal(label('5.2 The account holder'), 'bank account payments')
  assert.equal(label('4.2.1 [From paragraph 4.7'), 'bank account payments')
  assert.equal(label('4.10 The responsible FI'), 'all payments')
  assert.equal(label('A cardholder who has not'), 'card payments')
  assert.equal(appliesToLabel({ source: SRF, text: '6.2 …' }, ['ewallet', 'sg_card']), 'e-wallet payments')
})

test('nothing confirmed, or a payment of unknown kind, filters nothing', () => {
  const srf = { source: SRF, text: '6.2 …' }
  assert.equal(appliesToCase(srf, []), true)
  assert.equal(appliesToCase(srf, ['sg_card', null]), true)
  assert.equal(appliesToCase(srf, ['sg_card', 'other']), true)
  assert.equal(appliesToCase(srf, ['sg_card']), false)
})

test('the routing runs in the pack, the older decision pipeline and the theme retrieval', () => {
  const pack = readFileSync('supabase/functions/run_fidrec_pack_v1/index.ts', 'utf8')
  assert.match(pack, /routeClauses\([\s\S]*instruments, CLAUSE_COUNT\)/)
  const decision = readFileSync('supabase/functions/run_case_decision_v1/index.ts', 'utf8')
  assert.match(decision, /const clauseMatches = \(rawClauseMatches \?\? \[\]\)\.filter\(\(c\)=>appliesToCase\(clauseLocator\(c\), instruments\)\)/)
  assert.match(decision, /if \(isUnauthorisedCase && !cardOnly\)/, 'no EUPG force-include for a card-only case')
  assert.match(decision, /selectedClauses = selectedClauses\.filter\(\(c\)=>appliesToCase\(clauseLocator\(c\), instruments\)\)/)
  assert.equal(decision.match(/rawClauseMatches/g)?.length, 2, 'the unfiltered matches are read once, by the filter')
  const theme = readFileSync('lib/server/fidrec/retrieve-theme-regulatory-clauses.ts', 'utf8')
  assert.match(theme, /appliesToCase\(/)
})
