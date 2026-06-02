/**
 * Return shape of `get_case_eligibility(p_case_id uuid)` Postgres RPC.
 * Contract source: IS §6. Used as the single gating point for Layer 1 → Layer 2.
 */

import type { CaseEntitlementPlan } from '@/lib/types/case'

export interface CaseEligibilityPrerequisites {
  has_extract: boolean
  has_validation: boolean
  has_decision: boolean
  has_documents: boolean
  [extra: string]: boolean | undefined
}

export interface CaseEligibilityResolvedIds {
  /** RPC `get_case_eligibility` returns `latest_*` keys (see migration). */
  latest_extract_run_id?: string | null
  latest_validation_run_id?: string | null
  latest_decision_run_id?: string | null
  /** Legacy / alternate client naming — prefer `latest_*` via `getLatestValidationRunId`. */
  extract_run_id?: string | null
  validation_run_id?: string | null
  decision_run_id?: string | null
  [extra: string]: string | null | undefined
}

export interface CaseEligibilityActions {
  run_decision: boolean
  run_report_selfserve: boolean
  run_escalation_pack: boolean
  [extra: string]: boolean | undefined
}

export interface CaseEligibilityResponse {
  case_id: string
  user_id: string
  plan: CaseEntitlementPlan
  features: Record<string, unknown>
  prerequisites: CaseEligibilityPrerequisites
  resolved_ids: CaseEligibilityResolvedIds
  eligible_actions: CaseEligibilityActions
}
