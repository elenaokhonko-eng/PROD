'use client'

import type { ReportPurchaseReadiness } from '@/lib/billing/report-purchase-readiness'
import type { CaseValidationRunRow, ValidationGapItemRow } from '@/lib/types/validation'
import { deriveInGapPhase } from '@/lib/validation/gap-flow'
import type { Tier0DraftBundle } from '@/lib/types/narratives'
import type { CaseEntitlementPlan } from '@/lib/types/case'
import type { ReportRow } from '@/lib/types/report'
import type { CaseDecisionRunRow } from '@/lib/types/decision'
import type { CaseDocumentRow } from '@/lib/types/documents'

export type StateMachineNode =
  | 'S1-Journey'
  | 'S1-IntakeForm'
  | 'S1-GapLoop'
  | 'S1-EvidenceUpload'
  | 'S1-Tier0DraftPending'
  | 'S1-Tier0Draft'
  | 'T-EligibilityGate'
  | 'T-BuyReportCTA'
  | 'T-CheckoutRedirect'
  | 'T-PaymentSuccessLanding'
  | 'L2-DecisionRunning'
  | 'L2-ReportDrafting'
  | 'L2-ReportReady'
  | 'L2-ReportFailed'
  | 'L3-FormFilling'
  | 'L3-Tier2Ready'
  | 'L3-Submitting'
  | 'L3-Confirmed'

export interface StateMachineInput {
  /** From the capabilities API; `null` while loading. Whether the free case may buy the S$18 report. */
  reportPurchase: Pick<ReportPurchaseReadiness, 'ready'> | null
  validation: CaseValidationRunRow | null
  /** `undefined` = gap-items query still loading for the resolved validation run. */
  gapItems: ValidationGapItemRow[] | undefined
  narratives: Tier0DraftBundle | null
  entitlementPlan: CaseEntitlementPlan | null
  documents: Array<Pick<CaseDocumentRow, 'id' | 'processing_status'>> | null
  decision: CaseDecisionRunRow | null
  report: ReportRow | null
  jobStatus?: { status?: string | null; error?: string | null } | null
  isCheckoutRedirecting?: boolean
  isIntakeSubmitted?: boolean
  hasSubmittedIntake?: boolean
  isContactSubmitting?: boolean
  isContactSubmitted?: boolean
  /** Whether the journey questions were answered; `null` while loading or unknown (treated as answered). */
  journeyAnswered?: boolean | null
  /** The person chose "Continue without documents" on the upload step. */
  evidenceSkipped?: boolean
}

/**
 * Deterministic node resolver used by dashboard wiring.
 * This is intentionally conservative for Slice 5 wiring:
 * - Layer 1 until Tier-0 narratives exist
 * - Transition once Tier-0 exists and plan is still free
 * - Layer 2 once plan upgrades
 * - Layer 3 once a completed report exists
 */
export function useStateMachine(input: StateMachineInput): StateMachineNode {
  const {
    reportPurchase,
    validation,
    gapItems,
    narratives,
    entitlementPlan,
    documents,
    decision,
    report,
    jobStatus,
    isCheckoutRedirecting = false,
    isIntakeSubmitted = false,
    hasSubmittedIntake = false,
    isContactSubmitting = false,
    isContactSubmitted = false,
    journeyAnswered = null,
    evidenceSkipped = false,
  } = input

  if (isContactSubmitted) return 'L3-Confirmed'
  if (isContactSubmitting) return 'L3-Submitting'

  if (entitlementPlan === 'escalation_pack') {
    return 'L3-Tier2Ready'
  }

  if (entitlementPlan === 'self_serve_report') {
    if (report?.status === 'COMPLETED') return 'L3-FormFilling'
    if (jobStatus?.status === 'failed') return 'L2-ReportFailed'
    if (!decision) return 'L2-DecisionRunning'
    return 'L2-ReportDrafting'
  }

  if (!narratives?.tier0_summary && !narratives?.tier0_evidence_checklist && !narratives?.tier0_srf_signal) {
    // Journey questions come first after sign-in (spec 4.1): where the user is with their bank.
    if (journeyAnswered === false) return 'S1-Journey'
    if (deriveInGapPhase(validation, gapItems)) return 'S1-GapLoop'
    if (!isIntakeSubmitted && !hasSubmittedIntake) return 'S1-IntakeForm'
    const hasReadyDoc = documents?.some((d) => d.processing_status === 'ready') ?? false
    if (!hasReadyDoc && !evidenceSkipped) return 'S1-EvidenceUpload'
    return 'S1-Tier0DraftPending'
  }

  if (isCheckoutRedirecting) return 'T-CheckoutRedirect'

  // "Can buy", not get_case_eligibility's run_report_selfserve, which is only true once the report is paid for.
  if (!reportPurchase || !reportPurchase.ready) return 'T-EligibilityGate'

  // The free draft with the buy button underneath; the button alone while no document is ready.
  if (documents?.some((d) => d.processing_status === 'ready')) return 'S1-Tier0Draft'

  return 'T-BuyReportCTA'
}
