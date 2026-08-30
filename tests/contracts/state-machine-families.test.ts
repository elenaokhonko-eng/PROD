import assert from 'node:assert/strict'
import test from 'node:test'
import { useStateMachine, type StateMachineInput } from '../../hooks/state-machine/use-state-machine'
import type { CaseEligibilityResponse } from '../../lib/types/eligibility'
import type { Tier0DraftBundle } from '../../lib/types/narratives'

const base: StateMachineInput = {
  eligibility: null,
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

const eligible: CaseEligibilityResponse = {
  case_id: 'c1',
  user_id: 'u1',
  plan: 'free',
  features: {},
  prerequisites: { has_extract: true, has_validation: true, has_decision: false, has_documents: true },
  resolved_ids: {},
  eligible_actions: { run_decision: true, run_report_selfserve: true, run_escalation_pack: false },
}

const cases: Array<[string, Partial<StateMachineInput>, string]> = [
  ['Layer 1 intake', {}, 'S1-IntakeForm'],
  ['Layer 1 evidence', { isIntakeSubmitted: true }, 'S1-EvidenceUpload'],
  ['Layer 1 draft pending', { isIntakeSubmitted: true, documents: [{ id: 'd1', processing_status: 'ready' }] }, 'S1-Tier0DraftPending'],
  ['eligibility transition', { narratives: tier0 }, 'T-EligibilityGate'],
  ['buy transition', { narratives: tier0, eligibility: eligible }, 'T-BuyReportCTA'],
  ['checkout transition', { narratives: tier0, eligibility: eligible, isCheckoutRedirecting: true }, 'T-CheckoutRedirect'],
  ['Layer 1 free draft', { narratives: tier0, eligibility: { ...eligible, plan: 'self_serve_report' }, documents: [{ id: 'd1', processing_status: 'ready' }] }, 'S1-Tier0Draft'],
  ['Layer 2 decision', { entitlementPlan: 'self_serve_report' }, 'L2-DecisionRunning'],
  ['Layer 2 report drafting', { entitlementPlan: 'self_serve_report', decision: { id: 'run1' } as never }, 'L2-ReportDrafting'],
  ['Layer 2 failure', { entitlementPlan: 'self_serve_report', jobStatus: { status: 'failed' } }, 'L2-ReportFailed'],
  ['Layer 3 form', { entitlementPlan: 'self_serve_report', report: { status: 'COMPLETED' } as never }, 'L3-FormFilling'],
  ['Layer 3 Tier 2', { entitlementPlan: 'escalation_pack' }, 'L3-Tier2Ready'],
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
