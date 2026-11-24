import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCustomerConduct,
  conductMarkers,
  CONDUCT_FRAMEWORKS,
  createCustomerConductBuilder,
  NOT_SHOWN,
  termFamily,
  WHO_APPROVED_NOT_SHOWN,
} from '../../supabase/functions/_shared/facts/rules/customer-conduct.ts'
import { createStaticTermRequestSource, parseTermRequestRows } from '../../supabase/functions/_shared/facts/rules/institution-terms.ts'
import {
  CLAUSE_KEYS,
  CONDUCT_TOPICS,
  type ConductLine,
  createFakeClauseProvider,
  NAMED_CLAUSE_KEYS,
  type SectionInput,
  type SectionLine,
  type SectionResult,
} from '../../supabase/functions/_shared/facts/update/contract.ts'
import { afterTheEventsLine, GENDERED_PRONOUNS } from '../../supabase/functions/_shared/facts/update/section-writer.ts'
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

// Brief v5 4g as changed by the review of 24 Nov 2026, Decision 1: for each kind of conduct, what the record shows,
// and separately whether each document refers to that kind of conduct. No `matches`, no `differs`, no ComparisonLine,
// never the comparison endings.

const fake = createFakeClauseProvider(syntheticCorpus)
const held = createFakeClauseProvider(lane4Corpus())
const input = (c: FidrecUpdateCase, patch: Partial<SectionInput> = {}): SectionInput => ({ ...c.data, provider: fake, ...patch })
const texts = (r: SectionResult) => r.lines.filter((l): l is Extract<SectionLine, { kind: 'text' }> => l.kind === 'text').map((l) => l.text)
const conduct = (r: SectionResult) =>
  r.lines.filter((l): l is Extract<SectionLine, { kind: 'conduct' }> => l.kind === 'conduct').map((l) => l.conduct)
const withFacts = (c: FidrecUpdateCase, facts: object, provider = fake): SectionInput =>
  ({ ...c.data, facts: { ...c.data.facts, ...facts } as SectionInput['facts'], provider })
const recognised = (c: FidrecUpdateCase) => ({
  device_recognition: { value: c.data.facts.device_recognition!.value!.map((d) => ({ ...d, answer: 'mine' as const })), label: 'confirmed' as const },
})

// A rendering of the conduct lines in the contract's documented forms (contract.ts, CONDUCT_LINE_KINDS), for these
// tests only. Lane 6's renderer prints the real lines with the R# reference.
const NAMES = Object.fromEntries(Object.values(CONDUCT_FRAMEWORKS).map((s) => [s.documentKey, [s.name, s.plural] as const]))
function clauseReference(key: string): string {
  const ref = key.split('/')[1]
  if (/^fn\d+$/.test(ref)) return `footnote ${ref.slice(2)}`
  return `paragraph ${ref.split('.')[0].replace(/\)\..*$/, ')')}`
}
function render(line: ConductLine): string {
  if (line.kind === 'records_do_not_show') return `The records provided do not show ${line.notShown}.`
  const [name, plural] = NAMES[line.documentKey]
  if (line.kind === 'no_conduct_test') return `${name} ${plural ? 'have' : 'has'} no test of the account user's conduct.`
  const topic = CONDUCT_TOPICS[line.marker]
  if (line.kind === 'refers_to') return `${name} ${plural ? 'refer' : 'refers'} to ${topic} in ${clauseReference(line.clauseKey)} (R1).`
  return `${name} ${plural ? 'do' : 'does'} not refer to ${topic}.`
}
/** Every line of the section, in order, as printed. */
const printed = (r: SectionResult) =>
  r.lines.flatMap((l) => (l.kind === 'text' ? [l.text] : l.kind === 'conduct' ? [render(l.conduct)] : []))

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

test('facts labelled not_sure are not read for record lines (same rule as Lane 3; open for Elena)', () => {
  const m = conductMarkers(withFacts(accountSrfCase, {
    credentials_or_otp_shared: { value: 'entered_on_fake_site_or_app', label: 'not_sure' },
    reported_to_police: { value: { value: 'yes', date: '2025-07-04', reference: null, channel: 'online' }, label: 'not_sure' },
  }))
  assert.equal(m.find((x) => x.marker === 'credentials_entered')!.record, null)
  assert.equal(m.find((x) => x.marker === 'police_report')!.record, null)
  const claimant = conductMarkers(withFacts(accountSrfCase, { credentials_or_otp_shared: { value: 'given_directly', label: 'claimant_only' } }))
  assert.match(claimant.find((x) => x.marker === 'credentials_given')!.record!, /^The complainant states that they told their credentials/)
})

test('the first alert on the same day as the report reads "the same calendar day"', () => {
  const facts = { reported_to_bank: { value: { value: 'yes', date: '2025-07-03', reference: null, channel: 'hotline' }, label: 'confirmed' } }
  const m = conductMarkers(withFacts(accountSrfCase, facts))
  assert.match(m.find((x) => x.marker === 'alerts_and_report')!.record!, /on 3 July 2025, the same calendar day as the first alert\.$/)
})

test('Decision 1, synthetic line 1: the alerts record line, then the EUPG "refers to" line, nothing joining them', async () => {
  const r = await buildCustomerConduct(input(accountSrfCase, { provider: held }))
  const lines = printed(r)
  const i = lines.indexOf(
    'The record shows 3 alerts, the first sent at 21:06 on 3 July 2025 to registered mobile number. The complainant reported to the institution on 4 July 2025, 1 calendar day after the first alert.',
  )
  assert.ok(i >= 0)
  assert.equal(
    lines[i + 1],
    'The E-Payments User Protection Guidelines refer to notifications and alerts from the institution in footnote 20 (R1).',
  )
  const line = conduct(r).find((c) => c.kind === 'refers_to' && c.marker === 'alerts_and_report')!
  assert.deepEqual(line, { kind: 'refers_to', marker: 'alerts_and_report', documentKey: 'mas.eupg', clauseKey: 'mas.eupg/fn20', onDate: '2025-07-03' })
  // Before: a `matches` ComparisonLine against footnote 20.
  assert.ok(!r.lines.some((l) => l.kind === 'comparison'))
})

test('Decision 1, synthetic line 2: card payments approved on a device that is not theirs: "do not show who approved", no document line', async () => {
  const r = await buildCustomerConduct(input(cardOnlyCase, { provider: held }))
  const lines = printed(r)
  const record =
    "The record shows 3 card payments authenticated by 3-D Secure with the digital token on the device labelled 'Phone model EX-300'. The complainant states that the device labelled 'Phone model EX-300' is not theirs."
  const i = lines.indexOf(record)
  assert.ok(i >= 0, lines.join('\n'))
  assert.equal(lines[i + 1], WHO_APPROVED_NOT_SHOWN)
  assert.equal(WHO_APPROVED_NOT_SHOWN, 'The records do not show who approved these payments.')
  // No document line for that marker, and the MAS reply of 7 January 2025 is not in this section at all (it stays in 4d).
  assert.ok(!conduct(r).some((c) => c.marker === 'card_payment_approved'))
  assert.ok(!conduct(r).some((c) => c.documentKey === CONDUCT_FRAMEWORKS.mas_reply.documentKey))
  assert.ok(!lines.some((t) => t.includes("MAS's written reply")))
  assert.ok(!r.citations.some((c) => c.clauseKey === NAMED_CLAUSE_KEYS.masReply3ds))
})

test('not_sure, no answer, a not_sure-labelled recognition fact, or no device named: the same "who approved" line', async () => {
  const variants: object[] = [
    { device_recognition: { value: [{ ...cardOnlyCase.data.facts.device_recognition!.value![0], answer: 'not_sure' }], label: 'confirmed' } },
    { device_recognition: undefined },
    { device_recognition: { value: recognised(cardOnlyCase).device_recognition.value, label: 'not_sure' } },
    {
      ...recognised(cardOnlyCase),
      card_auth_events: { value: cardOnlyCase.data.facts.card_auth_events.value.map((e) => ({ ...e, deviceRef: null, deviceLabel: null })), label: 'confirmed' },
    },
  ]
  for (const facts of variants) {
    const r = await buildCustomerConduct(withFacts(cardOnlyCase, facts, held))
    assert.ok(texts(r).includes(WHO_APPROVED_NOT_SHOWN), JSON.stringify(facts).slice(0, 80))
    assert.ok(!conduct(r).some((c) => c.marker === 'card_payment_approved'))
  }
  const notSure = await buildCustomerConduct(withFacts(cardOnlyCase, variants[0], held))
  assert.ok(texts(notSure).some((t) => t.endsWith("The complainant states that they are not sure whether the device labelled 'Phone model EX-300' is theirs.")))
})

test('where the complainant recognises the approving device, the "refers to" line prints as usual', async () => {
  const r = await buildCustomerConduct(withFacts(cardOnlyCase, recognised(cardOnlyCase), held))
  assert.ok(!texts(r).includes(WHO_APPROVED_NOT_SHOWN))
  const line = conduct(r).find((c) => c.marker === 'card_payment_approved' && c.documentKey === 'mas.reply.20250107')!
  assert.equal(line.kind, 'refers_to')
  assert.equal(line.clauseKey, 'mas.reply.20250107/3(a).3ds')
  assert.ok(printed(r).includes("MAS's written reply of 7 January 2025 refers to authenticating a card payment in paragraph 3(a) (R1)."))
  // The card code does not refer to it.
  assert.ok(conduct(r).some((c) => c.kind === 'does_not_refer_to' && c.marker === 'card_payment_approved' && c.documentKey === 'abs.card_code'))
})

test('account payments: the EUPG per marker and the SRF "no test" line once; no card document', async () => {
  const r = await buildCustomerConduct(input(accountSrfCase, { provider: held }))
  const lines = conduct(r).filter((c) => c.kind !== 'records_do_not_show')
  assert.deepEqual([...new Set(lines.map((c) => c.documentKey))].sort(), ['mas.eupg', 'mas.srf'])
  const srf = lines.filter((c) => c.documentKey === 'mas.srf')
  assert.deepEqual(srf, [{ kind: 'no_conduct_test', marker: null, documentKey: 'mas.srf', clauseKey: null, onDate: '2025-07-03' }])
  assert.ok(printed(r).includes("The Shared Responsibility Framework Guidelines have no test of the account user's conduct."))
  const eupg = Object.fromEntries(lines.filter((c) => c.documentKey === 'mas.eupg').map((c) => [c.marker, c]))
  assert.equal(eupg.alerts_and_report.kind, 'refers_to')
  assert.equal(eupg.credentials_entered.kind, 'does_not_refer_to')
  assert.equal(eupg.police_report.kind, 'does_not_refer_to')
  assert.ok(!lines.some((c) => c.marker === 'card_payment_approved'))
})

test('a "refers to" line prints only when its clause is held for the date; otherwise nothing, and a flag', async () => {
  const r = await buildCustomerConduct(input(accountSrfCase))
  assert.ok(!conduct(r).some((c) => c.kind === 'refers_to' || c.kind === 'does_not_refer_to' || c.kind === 'no_conduct_test'))
  assert.ok(r.flags.some((f) => f.code === 'clause_not_held' && f.key === 'mas.eupg/fn20' && f.onDate === '2025-07-03'))
  assert.ok(r.flags.some((f) => f.code === 'clause_not_held' && f.key === 'mas.srf/3.1'))
  // The record lines still print.
  assert.ok(texts(r).some((t) => t.startsWith('The record shows 3 alerts')))
  // Held: the citation is pinned.
  const h = await buildCustomerConduct(input(accountSrfCase, { provider: held }))
  assert.ok(h.citations.some((c) => c.clauseKey === 'mas.eupg/fn20' && c.onDate === '2025-07-03'))
})

test('mixed case: both groups, each dated by its own payments', async () => {
  const r = await buildCustomerConduct(input(mixedCase, { provider: held }))
  const lines = conduct(r)
  assert.ok(lines.some((c) => c.documentKey === 'mas.eupg' && c.onDate === '2025-05-20'))
  assert.ok(lines.some((c) => c.documentKey === 'abs.card_code' && c.onDate === '2025-05-20'))
  const flagged = await buildCustomerConduct(input(mixedCase))
  assert.ok(flagged.flags.some((f) => f.key === 'abs.card_code/5' && f.onDate === '2025-05-20'))
})

test('a case with no technical record: the record-based markers print "The records provided do not show"', async () => {
  const r = await buildCustomerConduct(input(noTechnicalRecordsCase, { provider: held }))
  for (const marker of ['alerts_and_report', 'block_used'] as const) {
    const line = conduct(r).find((c) => c.kind === 'records_do_not_show' && c.marker === marker)!
    assert.ok(line, marker)
    assert.equal(line.kind === 'records_do_not_show' && line.notShown, NOT_SHOWN[marker])
    assert.match(render(line), /^The records provided do not show /)
  }
  const block = r.lines.find((l) => l.kind === 'conduct' && l.conduct.kind === 'records_do_not_show' && l.conduct.marker === 'block_used')!
  assert.ok(block.kind === 'conduct' && block.evidenceIds.length === 0)
})

test('Decision 1: no comparison lines; no conduct line says "matches", "as the document expects" or "differs"', async () => {
  for (const provider of [fake, held]) {
    for (const c of FIDREC_UPDATE_CASES) {
      for (const variant of [input(c, { provider }), ...(c.data.facts.device_recognition?.value ? [withFacts(c, recognised(c), provider)] : [])]) {
        const r = await buildCustomerConduct(variant)
        assert.ok(!r.lines.some((l) => l.kind === 'comparison'), c.id)
        for (const t of printed(r)) assert.ok(!/\bmatches\b|as the document expects|\bdiffers\b|The document expects/i.test(t), `${c.id}: ${t}`)
      }
    }
  }
})

test('conduct lines cite only the contract\'s clause keys for this section, and the topics are the contract\'s', async () => {
  const allowed = new Set<string>(CLAUSE_KEYS.customer_conduct_comparison)
  for (const c of FIDREC_UPDATE_CASES) {
    for (const line of conduct(await buildCustomerConduct(input(c, { provider: held })))) {
      if (line.clauseKey !== null) assert.ok(allowed.has(line.clauseKey), line.clauseKey)
      if (line.marker !== null) assert.ok(line.marker in CONDUCT_TOPICS)
    }
  }
})

test('the framework table: every line names the clause it rests on, from the contract\'s keys', () => {
  const allowed = new Set<string>(CLAUSE_KEYS.customer_conduct_comparison)
  for (const spec of Object.values(CONDUCT_FRAMEWORKS)) {
    for (const key of Object.values(spec.refersTo)) assert.ok(allowed.has(key!), key)
    if (spec.doesNotReferClauseKey) assert.ok(allowed.has(spec.doesNotReferClauseKey), spec.doesNotReferClauseKey)
    if (spec.noConductTestClauseKey) assert.ok(allowed.has(spec.noConductTestClauseKey), spec.noConductTestClauseKey)
    assert.ok(allowed.has(spec.termClauseKey), spec.termClauseKey)
    assert.ok(spec.noConductTestClauseKey || spec.doesNotReferClauseKey, spec.name)
  }
  assert.equal(CONDUCT_FRAMEWORKS.mas_reply.refersTo.card_payment_approved, 'mas.reply.20250107/3(a).3ds')
})

test('Decision 6: the MAS reply line is read as of the generation day, with the after-the-events line where it is later', async () => {
  const early = (c: FidrecUpdateCase) => ({
    ...withFacts(c, {
      ...recognised(c),
      reported_to_bank: undefined,
    }, held),
    payments: c.data.payments.map((p) => ({ ...p, date: '2024-11-02' })),
  })
  const r = await createCustomerConductBuilder({ generatedOn: '2026-11-24' })(early(cardOnlyCase))
  const reply = conduct(r).find((c) => c.kind === 'refers_to' && c.documentKey === 'mas.reply.20250107')!
  assert.equal(reply.onDate, '2026-11-24')
  const lines = printed(r)
  // The line follows the reply's first line in the section, once.
  const first = r.lines.findIndex((l) => l.kind === 'conduct' && l.conduct.documentKey === 'mas.reply.20250107')
  const next = r.lines[first + 1]
  assert.ok(next.kind === 'text' && next.text === afterTheEventsLine('2025-01-07'))
  assert.equal(lines.filter((t) => t.includes('after the events')).length, 1)
  assert.equal(afterTheEventsLine('2025-01-07'), 'This reply is dated 7 January 2025, after the events in this case.')
  // Events after the reply: no such line.
  const later = await createCustomerConductBuilder({ generatedOn: '2026-11-24' })(withFacts(cardOnlyCase, recognised(cardOnlyCase), held))
  assert.ok(!texts(later).some((t) => t.includes('after the events')))
})

test('the institution\'s words, and each document\'s term beside them', async () => {
  // Decision 1: the device is not theirs, so the MAS reply's term line is not in this section (it stays in 4d).
  const card = texts(await buildCustomerConduct(input(cardOnlyCase)))
  const from = card.findIndex((t) => t.startsWith("The institution's letter describes"))
  assert.deepEqual(card.slice(from, from + 2), [
    "The institution's letter describes the complainant's conduct as 'grossly negligent'. The conduct it cites is entered card details and a one-time code on a website reached from a message.",
    "The ABS Code of Practice for Banks – Credit Cards uses the term 'gross negligence'.",
  ])
  assert.ok(!card.some((t) => t.startsWith("MAS's written reply")))
  const recognisedCard = texts(await buildCustomerConduct(withFacts(cardOnlyCase, recognised(cardOnlyCase))))
  assert.ok(recognisedCard.includes("MAS's written reply of 7 January 2025 uses the term 'negligent'."))
  const account = texts(await buildCustomerConduct(input(accountSrfCase)))
  assert.ok(account.includes("The E-Payments User Protection Guidelines use the term 'recklessness'."))
  // The EUPG uses "negligence" (about the institution), so no "does not use" line for "negligent".
  assert.ok(!account.some((t) => t.includes('do not use the term')))
  const reckless = texts(await buildCustomerConduct(withFacts(cardOnlyCase, {
    ...recognised(cardOnlyCase),
    institution_fault_label: { value: { label: 'reckless', labelEvidenceId: 'E2', conduct: null, conductEvidenceId: null }, label: 'confirmed' },
  })))
  assert.ok(reckless.includes("The ABS Code of Practice for Banks – Credit Cards does not use the term 'reckless'."))
  assert.ok(reckless.includes("MAS's written reply of 7 January 2025 does not use the term 'reckless'."))
  assert.ok(reckless.includes("The institution's letter describes the complainant's conduct as 'reckless'."))
  const none = texts(await buildCustomerConduct(input(mixedCase)))
  assert.ok(none.includes("The records provided do not show a word the institution's letters use for the complainant's conduct."))
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

test('no verdict wording, no gendered pronoun, and no line says the institution\'s label is right or wrong', async () => {
  for (const c of FIDREC_UPDATE_CASES) {
    for (const variant of [input(c, { provider: held }), ...(c.data.facts.device_recognition?.value ? [withFacts(c, recognised(c), held)] : [])]) {
      const r = await buildCustomerConduct(variant)
      for (const t of printed(r)) {
        assert.ok(verdictFree(t), `${c.id}: ${t}`)
        assert.ok(!GENDERED_PRONOUNS.test(t), `${c.id}: ${t}`)
        assert.ok(!/\b(correct|incorrect|right|wrong|justified|unjustified)\b/i.test(t), `${c.id}: ${t}`)
      }
    }
  }
})
