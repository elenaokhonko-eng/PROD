import assert from 'node:assert/strict'
import test from 'node:test'
import { useStateMachine, type StateMachineInput } from '../../hooks/state-machine/use-state-machine'
import type { Tier0DraftBundle } from '../../lib/types/narratives'

const base: StateMachineInput = {
  reportPurchase: null,
  validation: null,
  gapItems: [],
  narratives: null,
  entitlementPlan: 'free',
  documents: [],
  decision: null,
  report: null,
}

const tier0: Tier0DraftBundle = {
  tier0_summary: {
    id: 'n1',
    case_id: 'c1',
    narrative_type: 'tier0_summary',
    title: null,
    text_content: '',
    source_ref: null,
    created_at: '',
    version: 1,
    intake_id: null,
    extract_run_id: null,
    decision_run_id: null,
    language: null,
    audience: null,
  },
  tier0_evidence_checklist: null,
  tier0_srf_signal: null,
  other: [],
}

const purchasable = { ready: true }
const readyDocument = [{ id: 'd1', processing_status: 'ready' as const }]
const gapValidation = { status: 'error' } as never

const cases: Array<[string, Partial<StateMachineInput>, string]> = [
  ['Layer 1 intake', {}, 'S1-IntakeForm'],
  ['Layer 1 evidence', { isIntakeSubmitted: true }, 'S1-EvidenceUpload'],
  ['Layer 1 draft pending', { isIntakeSubmitted: true, documents: [{ id: 'd1', processing_status: 'ready' }] }, 'S1-Tier0DraftPending'],
  ['Layer 1 gap questions before the confirm step', { isIntakeSubmitted: true, documents: readyDocument, validation: gapValidation, gapItems: [] }, 'S1-GapLoop'],
  // G3b re-check, 11 Nov: a second upload's check found gaps and took the person off the confirm step mid-action.
  ['Layer 1 confirm step stays once shown', { isIntakeSubmitted: true, documents: readyDocument, validation: gapValidation, gapItems: [], confirmStepShown: true }, 'S1-Tier0DraftPending'],
  ['eligibility transition', { narratives: tier0 }, 'T-EligibilityGate'],
  ['blocked before purchase', { narratives: tier0, reportPurchase: { ready: false }, documents: readyDocument }, 'T-EligibilityGate'],
  ['buy transition', { narratives: tier0, reportPurchase: purchasable }, 'T-BuyReportCTA'],
  ['checkout transition', { narratives: tier0, reportPurchase: purchasable, isCheckoutRedirecting: true }, 'T-CheckoutRedirect'],
  // A free case, no paid entitlement anywhere: the free draft with the S$18 buy button.
  ['Layer 1 free draft', { narratives: tier0, reportPurchase: purchasable, documents: readyDocument }, 'S1-Tier0Draft'],
  // Stage 2 (Elena, 13 Nov 2026): pay first, then confirm the bank facts; the pack is generated from them, so no
  // decision run or report job is waited for.
  ['Layer 2 confirm bank facts after payment', { entitlementPlan: 'self_serve_report' }, 'L2-ConfirmBankFacts'],
  ['Layer 2 confirm bank facts, whatever an old job did', { entitlementPlan: 'self_serve_report', decision: { id: 'run1' } as never, jobStatus: { status: 'failed' } }, 'L2-ConfirmBankFacts'],
  ['Layer 2 bank pack bought on its own', { entitlementPlan: 'free', bankPackOwned: true }, 'L2-ConfirmBankFacts'],
  ['Layer 3 form', { entitlementPlan: 'self_serve_report', report: { status: 'COMPLETED' } as never }, 'L3-FormFilling'],
  // Stage 2: the FIDReC pack is generated after its facts are confirmed, and each pack is its own entitlement.
  ['Layer 3 confirm FIDReC facts after payment', { entitlementPlan: 'escalation_pack' }, 'L3-ConfirmFidrecFacts'],
  ['Layer 3 FIDReC pack ready', { entitlementPlan: 'escalation_pack', fidrecPackOwned: true, fidrecReport: { status: 'COMPLETED' } as never }, 'L3-Tier2Ready'],
  ['Layer 3 FIDReC bought on its own, no bank pack', { entitlementPlan: 'escalation_pack', fidrecPackOwned: true, bankPackOwned: false, fidrecReport: { status: 'COMPLETED' } as never }, 'L3-Tier2Ready'],
  ['both packs: the bank pack follows the FIDReC pack', { entitlementPlan: 'escalation_pack', fidrecPackOwned: true, bankPackOwned: true, fidrecReport: { status: 'COMPLETED' } as never }, 'L2-ConfirmBankFacts'],
  ['both packs generated', { entitlementPlan: 'escalation_pack', fidrecPackOwned: true, bankPackOwned: true, fidrecReport: { status: 'COMPLETED' } as never, report: { status: 'COMPLETED' } as never }, 'L3-Tier2Ready'],
  ['Layer 3 submitting', { isContactSubmitting: true }, 'L3-Submitting'],
  ['Layer 3 confirmed', { isContactSubmitted: true }, 'L3-Confirmed'],
]

for (const [name, input, expected] of cases) {
  test(name, () => assert.equal(useStateMachine({ ...base, ...input }), expected))
}

test('contact confirmation wins over all lower-priority states', () => {
  assert.equal(
    useStateMachine({
      ...base,
      entitlementPlan: 'escalation_pack',
      isContactSubmitting: true,
      isContactSubmitted: true,
    }),
    'L3-Confirmed',
  )
})
