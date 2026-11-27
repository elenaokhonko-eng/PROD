import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assembleBankPack,
  BANK_PACK_CHECKS,
  BANK_PACK_FALLBACK_TITLE,
  type BankPackProse,
  bankPackFallback,
  bankPackSystem,
  bankPackTexts,
  buildBankPackInput,
  mapBankPackProse,
  parseBankPackProse,
  produceChecked,
  ProviderFailure,
  type SnapshotFacts,
  validateOutput,
} from '../../lib/facts'

// The bank pack (S$18) reuses the free evaluation's ladder and validator, written as the person (design K1; Elena,
// 20 Nov 2026: "re-use as much of free evaluation code as you can"). All facts and texts are synthetic.

const sgd = (amount: number) => ({ amount, currency: 'SGD', amountSgd: amount })
const event = (value: 'yes' | 'no', date: string | null) => ({ value, date, reference: null, channel: null })
const facts: SnapshotFacts = {
  scam_type: { value: ['phishing'], label: 'confirmed' },
  phishing_channel: { value: 'sms', label: 'confirmed' },
  institution_names: { value: [{ name: 'Synthetic Bank', type: 'bank' }], label: 'confirmed' },
  total_loss: { value: { ...sgd(3000), account: null, portions: [] }, label: 'claimant_only' },
  transactions: {
    value: [
      { date: '2026-10-02', amount: sgd(1800), channel: 'FAST transfer', payee: 'Synthetic Payee', last4: null, instrument: 'bank_transfer' },
      { date: '2026-10-02', amount: sgd(1200), channel: null, payee: null, last4: null, instrument: 'bank_transfer' },
    ],
    label: 'confirmed',
  },
  credentials_or_otp_shared: { value: null, label: 'not_sure' },
  date_discovered: { value: '2026-10-03', label: 'confirmed' },
  reported_to_bank: { value: event('yes', '2026-10-03'), label: 'confirmed' },
  reported_to_police: { value: event('yes', '2026-10-04'), label: 'claimant_only' },
}

const words = (n: number) => Array.from({ length: n }, () => 'details').join(' ')
const GOOD: BankPackProse = {
  title: 'Complaint about two disputed payments',
  executive_summary: `On 2 Oct 2026 I received an SMS that appeared to come from a delivery company. Two payments totalling S$3,000 then left my Synthetic Bank account. I reported this to Synthetic Bank on 3 Oct 2026 and to the police on 4 Oct 2026. ${words(90)}.`,
  requested_resolution: 'I ask Synthetic Bank to review the disputed payments and restore my funds, and to share the findings of its investigation.',
}

function scripted(...outputs: Array<BankPackProse | ProviderFailure>) {
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

const ladder = (generate: (previous: string | null) => Promise<BankPackProse>) =>
  produceChecked({ facts, options: BANK_PACK_CHECKS, generate, mapText: mapBankPackProse, texts: bankPackTexts, fallback: bankPackFallback })

test('a faithful complaint is delivered as written, in the first person', async () => {
  const model = scripted(GOOD)
  const result = await ladder(model.generate)
  assert.equal(result.source, 'model')
  assert.deepEqual(model.calls, [null])
  assert.match(result.output.executive_summary, /^On 2 Oct 2026 I received/)
})

test('the person\'s own account needs no "you told us"; a fact they are not sure of still does', () => {
  assert.deepEqual(validateOutput(bankPackTexts(GOOD), facts, BANK_PACK_CHECKS), [])
  const policeUnsure: SnapshotFacts = { ...facts, reported_to_police: { value: null, label: 'not_sure' } }
  assert.ok(validateOutput(bankPackTexts(GOOD), policeUnsure, BANK_PACK_CHECKS).some((f) => f.check === 'unqualified'))
  const third = { ...GOOD, title: 'The claimant was deceived by a scam' }
  assert.ok(validateOutput(bankPackTexts(third), facts, BANK_PACK_CHECKS).some((f) => f.check === 'person'))
})

test('a wrong amount, an SRF verdict or another bank is regenerated once with the problems fed back, then replaced by fixed wording', async () => {
  const wrong = { ...GOOD, executive_summary: GOOD.executive_summary.replace('S$3,000', 'S$3,500') }
  const srf = { ...GOOD, requested_resolution: 'Under the SRF the bank must refund me in full.' }
  const model = scripted(wrong, srf)
  const result = await ladder(model.generate)
  assert.equal(result.source, 'fallback')
  assert.equal(result.fallbackReason, 'checks')
  assert.equal(model.calls.length, 2)
  assert.match(model.calls[1] ?? '', /amount/)
  assert.ok(result.hardChecks.includes('forbidden'))
  assert.equal(result.output.title, BANK_PACK_FALLBACK_TITLE)
})

test('a provider failure ends in fixed wording, never in "failed"', async () => {
  const result = await ladder(scripted(new ProviderFailure('rate_limited', 429)).generate)
  assert.equal(result.source, 'fallback')
  assert.equal(result.fallbackReason, 'rate_limited')
})

test('the fixed wording states only the confirmed facts and passes the same checks', () => {
  const fallback = bankPackFallback(facts)
  assert.match(fallback.executive_summary, /^I am writing to complain/)
  assert.match(fallback.executive_summary, /Whether I shared a password or one-time code: not confirmed/)
  assert.doesNotMatch(fallback.executive_summary, /\byou\b/i)
  const failures = validateOutput(bankPackTexts(fallback), facts, { ...BANK_PACK_CHECKS, userFacing: undefined })
  assert.deepEqual(failures.filter((f) => f.check !== 'internal'), [])
})

test('every other section is built from the confirmed facts, not by the model', () => {
  const report = assembleBankPack({ prose: GOOD, source: 'model', facts, findings: [] })
  assert.equal(report.report_version, 'bank_pack_v1')
  // PB-10 and PB-11 (Part B walk-through, 25 Nov): words and "2 Oct 2026", not system values and ISO dates.
  assert.deepEqual(report.disputed_transactions.map((t) => t.Amount), ['S$1,800', 'S$1,200'])
  assert.deepEqual(report.disputed_transactions.map((t) => t.Date), ['2 Oct 2026', '2 Oct 2026'])
  assert.equal(report.disputed_transactions[1]['Paid to'], 'Not known')
  assert.deepEqual(Object.keys(report.disputed_transactions[0]), ['Date', 'Amount', 'Paid to', 'Method'])
  assert.ok(report.disputed_transactions.every((t) => !/_/.test(t.Method)), 'no system value such as account_transfer')
  assert.deepEqual(report.timeline.map((t) => t.date ?? null), [null, '3 Oct 2026', '3 Oct 2026', '4 Oct 2026'])
  assert.equal(report.timeline[0].event, '2 payments, S$3,000 in total, 2 Oct 2026')
  assert.ok(report.evidence_checklist.every((item) => item.present === false), 'no document was uploaded')
  assert.match(report.rules_assessment, /It is not a decision/)
  assert.equal(report.prose_source, 'model')
})

test('the model sees the confirmed facts and the story, never the FIDReC signal; the prompt is first person', () => {
  const input = buildBankPackInput({ facts, findings: [], storyText: 'A synthetic story.' })
  assert.ok(!('fidrec_check' in input))
  assert.equal(input.primary_narrative, 'A synthetic story.')
  assert.ok(input.facts_not_confirmed.includes('credentials_or_otp_shared'))
  const system = bankPackSystem(null)
  assert.match(system, /first person \("I", "my"\)/)
  assert.match(bankPackSystem('- amount: S$3,500'), /PREVIOUS ANSWER WAS REJECTED[\s\S]*S\$3,500/)
})

test('an unusable answer is treated as empty', () => {
  assert.equal(parseBankPackProse({ title: 'x', executive_summary: ' ', requested_resolution: 'y' }), null)
  assert.equal(parseBankPackProse('nope'), null)
  assert.deepEqual(parseBankPackProse({ ...GOOD, extra: 1 }), GOOD)
})

test('the Edge Function is paid-only, once per case, exempt from the daily cap but metered', () => {
  const fn = readFileSync('supabase/functions/run_bank_pack_v1/index.ts', 'utf8')
  assert.ok(fn.indexOf('allow_self_serve_report') < fn.indexOf('chatJson('), 'payment is checked before any model call')
  assert.ok(fn.indexOf('report_type", "bank_pack_v1"') < fn.indexOf('chatJson('), 'a stored pack is returned first')
  assert.doesNotMatch(fn, /dailyBreaker/)
  assert.match(fn, /purpose: "bank_pack"/)
  assert.match(fn, /rpc\("commit_bank_pack_v1"/)
  const route = readFileSync('app/api/edge/bank-pack/route.ts', 'utf8')
  assert.match(route, /loadCurrentSnapshot\(service, caseId, 'bank', snapshotId\)/)
  assert.doesNotMatch(route, /overEvaluationLimit/)
  const migration = readFileSync('supabase/migrations/20261120120000_product_readiness.sql', 'utf8')
  assert.match(migration, /p_audience NOT IN \('run_case_extract_v4', 'bright-function', 'run_bank_pack_v1'\)/)
})

// PB-11 (Part B walk-through, 25 Nov): "method: sg_card" and "method: account_transfer" in both packs.
test('the payments table names how each payment was made in words', () => {
  const withMethods = {
    ...facts,
    transactions: {
      value: [
        { date: '2026-10-12', amount: sgd(1200), channel: null, payee: 'ONLINE MERCHANT ONE', last4: null, instrument: 'sg_card' },
        { date: '2026-10-12', amount: sgd(850), channel: null, payee: null, last4: null, instrument: 'account_transfer' },
        { date: null, amount: sgd(499), channel: 'FAST transfer', payee: null, last4: null, instrument: 'ewallet' },
      ],
      label: 'confirmed',
    },
  } as typeof facts
  const rows = assembleBankPack({ prose: GOOD, source: 'model', facts: withMethods, findings: [] }).disputed_transactions
  assert.deepEqual(rows.map((r) => r.Method), ['Card payment', 'Bank account payment', 'FAST transfer'])
  assert.deepEqual(rows.map((r) => r.Date), ['12 Oct 2026', '12 Oct 2026', 'Not known'])
  assert.equal(rows[0]['Paid to'], 'ONLINE MERCHANT ONE')
})

// Elena, 27 Nov 2026: the bank pack is the written complaint, so it never says one has not been sent.
test('the fixed wording never says that a written complaint has not been sent', () => {
  const facts = { written_complaint_sent: { value: { value: 'no', date: null, reference: null, channel: null }, label: 'confirmed' } } as never
  assert.doesNotMatch(bankPackFallback(facts).executive_summary, /Written complaint/)
})
