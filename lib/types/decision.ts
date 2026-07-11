/**
 * `public.case_decision_runs` row shape — produced by `run_case_decision_v1`.
 * Mirrors schema lines 732–744. IS §4.4.
 *
 * SM R4: re-runs with force:true overwrite; never expose force in the MVP UI.
 * Render the latest by `created_at DESC` for display.
 */

export type EligibilityStatus = 'eligible' | 'not_eligible' | 'insufficient' | string

export interface DecisionEligibility {
  score: number
  status: EligibilityStatus
  [extra: string]: unknown
}

export interface DecisionReference {
  regulation: string
  snippet?: string
  url?: string
  [extra: string]: unknown
}

export interface DecisionJson {
  decision_version: 'case_decision_v1'
  eligibility: DecisionEligibility
  references: DecisionReference[]
  rationale?: string
  [extra: string]: unknown
}

export interface CaseDecisionRunRow {
  id: string
  case_id: string
  decision_json: DecisionJson
  eligibility_status: string
  strength_score_value: number | null
  model_name: string
  prompt_version: string
  created_at: string
  extract_run_id: string | null
  validation_run_id: string | null
}

/** Payload for `POST /api/edge/decision`. */
export interface DecisionPayload {
  case_id: string
}

export interface DecisionResponse {
  ok: boolean
  decision_run_id?: string
  decision?: DecisionJson
  error?: string
}
