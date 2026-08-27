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
import type { CaseEligibilityResponse } from '@/lib/types/eligibility'

export type EligibilityGateResult =
  | { eligible: true }
  | { eligible: false; blockedReason: string; missing: string[] }

export interface EligibilityGateProps {
  eligibility: CaseEligibilityResponse | null | undefined
  onResult: (result: EligibilityGateResult) => void
}

export function EligibilityGate({ eligibility, onResult }: EligibilityGateProps) {
  useEffect(() => {
    if (!eligibility) return

    if (eligibility.eligible_actions.run_report_selfserve) {
      onResult({ eligible: true })
      return
    }

    const missing = deriveMissing(eligibility)
    onResult({
      eligible: false,
      blockedReason: describeBlocked(missing),
      missing,
    })
  }, [eligibility, onResult])

  return null
}

function deriveMissing(eligibility: CaseEligibilityResponse): string[] {
  const { prerequisites } = eligibility
  const missing: string[] = []
  if (!prerequisites.has_extract) missing.push('extract')
  if (!prerequisites.has_validation) missing.push('validation')
  if (!prerequisites.has_documents) missing.push('documents')
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
