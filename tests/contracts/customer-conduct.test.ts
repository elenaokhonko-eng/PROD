import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCustomerConduct,
  buildCustomerConductRows,
  conductMarkers,
  CONDUCT_FRAMEWORKS,
  createCustomerConductBuilder,
  MAS_REPLY_3DS_CLAUSE_KEY,
  termFamily,
} from '../../supabase/functions/_shared/facts/rules/customer-conduct.ts'
import { createStaticTermRequestSource, parseTermRequestRows } from '../../supabase/functions/_shared/facts/rules/institution-terms.ts'
import {
  CLAUSE_KEYS,
  COMPARISON_OUTCOMES,
  createFakeClauseProvider,
  type SectionInput,
  type SectionLine,
  type SectionResult,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import {
  accountSrfCase,
  cardOnlyCase,
  FIDREC_UPDATE_CASES,
  type FidrecUpdateCase,
  mixedCase,
  noTechnicalRecordsCase,
  syntheticCorpus,
} from '../fixtures/fidrec-update/index.ts'
import { lane4Corpus, verdictFree } from './sequence-fault-corpus.ts'

// Brief v5 4g (decision 6): markers from the records, set beside what each document's text names, with the contract's
// outcomes; then the institution's own words and fixed lines. No verdict.

const fake = createFakeClauseProvider(syntheticCorpus)
const input = (c: FidrecUpdateCase, patch: Partial<SectionInput> = {}): SectionInput => ({ ...c.data, provider: fake, ...patch })
const comparisons = (r: SectionResult) =>
  r.lines.filter((l): l is Extract<SectionLine, { kind: 'comparison' }> => l.kind === 'comparison').map((l) => l.comparison)
const texts = (r: SectionResult) => r.lines.filter((l): l is Extract<SectionLine, { kind: 'text' }> => l.kind === 'text').map((l) => l.text)
const withFacts = (c: FidrecUpdateCase, facts: object): SectionInput => ({ ...c.data, facts: { ...c.data.facts, ...facts } as SectionInput['facts'], provider: fake })

test('markers from the account case: entered on a website, alerts and report, block, police report', () => {
  const m = conductMarkers(input(accountSrfCase))
  assert.deepEqual(m.map((x) => x.marker), ['credentials_entered', 'alerts_and_report', 'block_used', 'police_report'])
  const alerts = m.find((x) => x.marker === 'alerts_and_report')!
  assert.equal(
    alerts.record,
    'The record shows 3 alerts, the first sent at 21:06 on 3 July 2025 to registered mobile number. The complainant reported to the institution on 4 July 2025, 1 calendar day after the first alert.',
  )
  assert.deepEqual(alerts.evidenceIds, ['E4'])
  assert.equal(m.find((x) => x.marker === 'police_report')!.record, 'The complainant reported to the police on 4 July 2025.')
})

test('a credentials answer that is not confirmed gives not_shown markers; a different confirmed answer leaves them out', () => {
  const unsure = conductMarkers(withFacts(accountSrfCase, { credentials_or_otp_shared: { value: 'unsure', label: 'confirmed' } }))
  for (const k of ['credentials_entered', 'credentials_given', 'app_installed']) {
    assert.equal(unsure.find((x) => x.marker === k)?.record, null, k)
  }
  const given = conductMarkers(withFacts(accountSrfCase, { credentials_or_otp_shared: { value: 'given_in_message', label: 'confirmed' } }))
  assert.deepEqual(given.filter((x) => x.marker.startsWith('credentials') || x.marker === 'app_installed').map((x) => x.marker), ['credentials_given'])
  const malware = conductMarkers(withFacts(accountSrfCase, { scam_type: { value: ['malware'], label: 'confirmed' } }))
  assert.equal(malware.find((x) => x.marker === 'app_installed')!.record, 'The confirmed scam type includes malware.')
})

test('the first alert on the same day as the report reads "the same calendar day"', () => {
  const facts = { reported_to_bank: { value: { value: 'yes', date: '2025-07-03', reference: null, channel: 'hotline' }, label: 'confirmed' } }
  const m = conductMarkers(withFacts(accountSrfCase, facts))
  assert.match(m.find((x) => x.marker === 'alerts_and_report')!.record!, /on 3 July 2025, the same calendar day as the first alert\.$/)
})

test('account payments are set against the EUPG and the SRF only; the SRF has no customer-fault test', async () => {
  const rows = await buildCustomerConductRows(input(accountSrfCase))
  assert.deepEqual([...new Set(rows.map((r) => r.framework))], ['eupg', 'srf'])
  assert.ok(!rows.some((r) => r.marker === 'card_payment_approved'))
  for (const r of rows.filter((x) => x.framework === 'srf')) {
    assert.equal(r.naming, 'document_has_no_such_test')
    assert.equal(r.line.outcome, 'not_applicable')
    assert.equal(r.line.clauseKey, 'mas.srf/3.1')
  }
  const eupg = Object.fromEntries(rows.filter((x) => x.framework === 'eupg').map((r) => [r.marker, r]))
  // Footnote 20 item (c) names ignoring alerts; entering credentials on a website and a police report are not named.
  assert.equal(eupg.alerts_and_report.naming, 'named')
  assert.equal(eupg.alerts_and_report.line.outcome, 'matches')
  assert.equal(eupg.alerts_and_report.line.clauseKey, 'mas.eupg/fn20')
  assert.equal(eupg.credentials_entered.naming, 'not_named')
  assert.equal(eupg.credentials_entered.line.outcome, 'differs')
  assert.equal(eupg.credentials_entered.line.clauseKey, 'mas.eupg/5.2')
  assert.equal(eupg.police_report.naming, 'not_named')
})

test('card payments are set against the card code and the MAS reply only; the reply names 3-D Secure approval', async () => {
  const rows = await buildCustomerConductRows(input(cardOnlyCase))
  assert.deepEqual([...new Set(rows.map((r) => r.framework))], ['abs_card_code', 'mas_reply'])
  for (const r of rows) assert.ok(!r.line.clauseKey.startsWith('mas.eupg/') && !r.line.clauseKey.startsWith('mas.srf/'), r.line.clauseKey)
  for (const r of rows.filter((x) => x.framework === 'abs_card_code' && x.naming !== null)) assert.equal(r.naming, 'not_named')
  const approved = rows.find((r) => r.framework === 'mas_reply' && r.marker === 'card_payment_approved')!
  assert.equal(approved.naming, 'named')
  assert.equal(approved.line.clauseKey, MAS_REPLY_3DS_CLAUSE_KEY)
  assert.equal(
    approved.line.record,
    "The record shows 3 card payments authenticated by 3-D Secure with the digital token on the device labelled 'Phone model EX-300'. The complainant states that the device labelled 'Phone model EX-300' is not hers.",
  )
  assert.deepEqual(approved.line.evidenceIds, ['E6'])
})

test('mixed case: both groups, each dated by its own payments', async () => {
  const r = await buildCustomerConduct(input(mixedCase))
  const keys = comparisons(r).map((c) => c.clauseKey)
  assert.ok(keys.includes('mas.eupg/5.2') && keys.includes('abs.card_code/5'))
  assert.ok(r.flags.some((f) => f.key === 'abs.card_code/5' && f.onDate === '2025-05-20'))
})

test('a case with no technical record: the record-based markers are not_shown', async () => {
  const rows = await buildCustomerConductRows(input(noTechnicalRecordsCase))
  for (const r of rows.filter((x) => x.marker === 'alerts_and_report' || x.marker === 'block_used')) {
    assert.equal(r.line.outcome, 'not_shown')
    assert.equal(r.naming, null)
    assert.match(r.line.record, /^The records provided do not show /)
    assert.deepEqual(r.line.evidenceIds, [])
  }
})

test('outcomes are the contract\'s, clause keys are the contract\'s or the proposed MAS reply key', async () => {
  const allowed = new Set<string>([...CLAUSE_KEYS.customer_conduct_comparison, MAS_REPLY_3DS_CLAUSE_KEY])
  for (const c of FIDREC_UPDATE_CASES) {
    for (const line of comparisons(await buildCustomerConduct(input(c)))) {
      assert.ok((COMPARISON_OUTCOMES as readonly string[]).includes(line.outcome))
      assert.ok(allowed.has(line.clauseKey), line.clauseKey)
    }
  }
})

test('Expected is the clause in the corpus\'s words, in the version in force; not held is flagged', async () => {
  const rows = await buildCustomerConductRows({ ...accountSrfCase.data, provider: createFakeClauseProvider(lane4Corpus()) })
  const fn20 = rows.find((r) => r.framework === 'eupg' && r.marker === 'alerts_and_report')!
  assert.equal(fn20.line.expected, 'Synthetic EUPG, footnote 20 (version A), item (c): "Placeholder text of footnote 20."')
  const r = await buildCustomerConduct(input(accountSrfCase))
  assert.ok(r.flags.some((f) => f.code === 'clause_not_held' && f.key === 'mas.eupg/fn20'))
  assert.ok(r.flags.some((f) => f.code === 'statement_under_review' && f.key === 'srf.fault.terms'))
})

test('the institution\'s words, and each document\'s term beside them', async () => {
  const card = texts(await buildCustomerConduct(input(cardOnlyCase)))
  assert.deepEqual(card.slice(0, 3), [
    "The institution's letter describes the complainant's conduct as 'grossly negligent'. The conduct it cites is entered card details and a one-time code on a website reached from a message.",
    "The ABS Code of Practice for Banks – Credit Cards uses the term 'gross negligence'.",
    "MAS's written reply of 7 January 2025 uses the term 'negligent'.",
  ])
  const account = texts(await buildCustomerConduct(input(accountSrfCase)))
  assert.ok(account.includes("The E-Payments User Protection Guidelines use the term 'recklessness'."))
  // The EUPG uses "negligence" (about the institution), so no "does not use" line for "negligent".
  assert.ok(!account.some((t) => t.includes('do not use the term')))
  const reckless = texts(await buildCustomerConduct(withFacts(cardOnlyCase, {
    institution_fault_label: { value: { label: 'reckless', labelEvidenceId: 'E2', conduct: null, conductEvidenceId: null }, label: 'confirmed' },
  })))
  assert.ok(reckless.includes("The ABS Code of Practice for Banks – Credit Cards does not use the term 'reckless'."))
  assert.ok(reckless.includes("MAS's written reply of 7 January 2025 does not use the term 'reckless'."))
  assert.ok(reckless.includes("The institution's letter describes the complainant's conduct as 'reckless'."))
  const none = texts(await buildCustomerConduct(input(mixedCase)))
  assert.equal(none[0], "The records provided do not show a word the institution's letters use for the complainant's conduct.")
})

test('label families', () => {
  assert.equal(termFamily('grossly negligent'), 'gross_negligence')
  assert.equal(termFamily('Gross Negligence'), 'gross_negligence')
  assert.equal(termFamily('negligent'), 'negligence')
  assert.equal(termFamily('recklessness'), 'recklessness')
  assert.equal(termFamily('careless'), null)
})

test('the institution\'s own terms line: defines, uses without defining, does not use, not held', async () => {
  const row = (term_outcome: string | null, term: string | null) =>
    createStaticTermRequestSource(parseTermRequestRows([{
      institution: 'example_bank_a',
      product: 'credit_card',
      purpose: 'fault_definition',
      document_key: 'examplebanka.card_terms',
      selector: { tags: ['definition_gross_negligence'] },
      term_outcome,
      term,
    }]))
  const last = async (src: ReturnType<typeof row> | undefined) => {
    const t = texts(await createCustomerConductBuilder({ termRequests: src })(input(cardOnlyCase)))
    return t[t.length - 1]
  }
  assert.equal(await last(row('defines', 'gross negligence')), "The institution's own terms in force on 12 September 2025 define 'grossly negligent' as set out in the definitions section.")
  assert.equal(await last(row('uses_undefined', 'gross negligence')), "The institution's own terms in force on 12 September 2025 use 'grossly negligent' without defining it.")
  assert.equal(await last(row('not_used', null)), "The institution's own terms in force on 12 September 2025 do not use the terms negligence, gross negligence or recklessness.")
  assert.equal(await last(row('defines', 'negligence')), "The institution's own terms in force on 12 September 2025 use the term 'negligence'.")
  assert.equal(await last(undefined), "The institution's own terms in force on 12 September 2025 are not held for that date.")
})

test('the framework table cites only the documents the brief names for the conduct comparison', () => {
  for (const spec of Object.values(CONDUCT_FRAMEWORKS)) {
    for (const named of Object.values(spec.named)) {
      assert.ok([...CLAUSE_KEYS.customer_conduct_comparison, MAS_REPLY_3DS_CLAUSE_KEY].includes(named!.clauseKey as never), named!.clauseKey)
    }
  }
})

test('no verdict wording, and no line says the institution\'s label is right or wrong', async () => {
  const provider = createFakeClauseProvider(lane4Corpus())
  for (const c of FIDREC_UPDATE_CASES) {
    const r = await buildCustomerConduct({ ...c.data, provider })
    for (const t of texts(r)) {
      assert.ok(verdictFree(t), `${c.id}: ${t}`)
      assert.ok(!/\b(correct|incorrect|right|wrong|justified|unjustified)\b/i.test(t), `${c.id}: ${t}`)
    }
    for (const line of comparisons(r)) assert.ok(verdictFree(line.record), `${c.id}: ${line.record}`)
  }
})
