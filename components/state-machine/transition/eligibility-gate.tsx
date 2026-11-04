'use client'

/**
 * Transition node `T-EligibilityGate` (SM Diagram 2).
 *
 * Invisible / silent component. It evaluates a resolved
 * `CaseEligibilityResponse` and calls `onResult(...)` with the derived gate
 * outcome. Rendered by the state-machine driver, this component does not
 * paint pixels — the driver then routes to `<BuyReportCTA>` or
 * `<BlockedOnPrereq>` based on the callback result.
 *
 * Kept as a component (not a pure function) so it can live next to its
 * sibling transition components and so drivers can compose it declaratively.
 *
 * Reference: IS §6 + SM §4.
 */

import { useEffect } from 'react'
import type { ReportPurchaseReadiness } from '@/lib/billing/report-purchase-readiness'
import type { CaseEligibilityResponse } from '@/lib/types/eligibility'

export type EligibilityGateResult =
  | { eligible: true }
  | { eligible: false; blockedReason: string; missing: string[] }

export interface EligibilityGateProps {
  /** From the capabilities API (lib/billing/report-purchase-readiness.ts). */
  purchase: ReportPurchaseReadiness | null | undefined
  eligibility: CaseEligibilityResponse | null | undefined
  onResult: (result: EligibilityGateResult) => void
}

export function EligibilityGate({ purchase, eligibility, onResult }: EligibilityGateProps) {
  useEffect(() => {
    if (!purchase) return

    if (purchase.ready) {
      onResult({ eligible: true })
      return
    }

    const missing = deriveMissing(purchase, eligibility)
    onResult({
      eligible: false,
      blockedReason: describeBlocked(missing),
      missing,
    })
  }, [purchase, eligibility, onResult])

  return null
}

export function deriveMissing(
  purchase: ReportPurchaseReadiness,
  eligibility: CaseEligibilityResponse | null | undefined,
): string[] {
  const prerequisites = eligibility?.prerequisites
  const missing: string[] = []
  if (prerequisites && !prerequisites.has_extract_run) missing.push('extract')
  if (
    (prerequisites && !prerequisites.has_validation_run) ||
    purchase.blockedReason === 'validation_missing' ||
    purchase.blockedReason === 'validation_blocking'
  ) {
    missing.push('validation')
  }
  if (prerequisites && !prerequisites.has_processed_documents) missing.push('documents')
  return missing
}

function describeBlocked(missing: string[]): string {
  if (missing.length === 0) {
    return 'Your case is not yet eligible for the paid report.'
  }
  if (missing.includes('documents')) {
    return 'Add at least one supporting document before buying your FI Pack.'
  }
  if (missing.includes('extract') || missing.includes('validation')) {
    return 'Finish your free User Pack questions before buying your FI Pack.'
  }
  return 'Your case is not yet eligible for the paid report.'
}
