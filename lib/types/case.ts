/**
 * `public.cases` row shape. Mirrors `supabase/migrations/20260314055326_remote_schema.sql`
 * lines 1082–1114 (the live schema at the time of writing).
 *
 * Keep in sync with IS §5 column list. If the schema changes, update this file
 * AND the column list in the Integration Summary.
 */

export type CaseClaimType = 'phishing_scam' | 'mis_sold_product' | 'denied_insurance'

export type CaseStatus =
  | 'draft'
  | 'triage'
  | 'intake'
  | 'evidence'
  | 'generation'
  | 'filed'
  | 'tracking'
  | 'completed'

export type CaseEligibilityStatus = 'eligible' | 'out_of_scope' | 'pending'
export type CaseStrengthScore = 'low' | 'medium' | 'high'

export interface CaseRow {
  id: string
  /** FK → auth.users.id (Pattern C). Nullable only for legacy rows. */
  user_id: string | null
  claim_type: CaseClaimType
  status: CaseStatus | null
  claim_amount: string | number | null
  institution_name: string | null
  incident_date: string | null
  case_summary: string | null
  eligibility_status: CaseEligibilityStatus | null
  strength_score: CaseStrengthScore | null
  created_at: string | null
  updated_at: string | null
  /** FK → profiles.id. Usually equal to user_id once Pattern C migration lands. */
  owner_user_id: string | null
  creator_user_id: string | null
  dispute_category: string | null
  router_session_id: string | null
  is_anonymous: boolean | null
  data_retention_policy: string | null
  anonymization_requested: boolean | null
  anonymization_completed_at: string | null
  case_status: string | null
  primary_narrative: string | null
  case_key: string | null
  claim_currency: string | null
  jurisdiction: string | null
  strength_score_value: number | null
  incident_datetime: string | null
}

/** `public.case_intake` row shape (lines 967–982). */
export interface CaseIntakeRow {
  id: string
  case_id: string
  narrative_text: string | null
  source: string | null
  created_at: string
  intake_type: 'initial' | 'gap_response' | string | null
  version: number | null
  answers_json: Record<string, unknown> | null
  language: string | null
  timezone: string | null
  is_user_confirmed: boolean | null
}

/** `public.case_entitlements` row shape (lines 906–917). */
export type CaseEntitlementPlan = 'free' | 'self_serve_report' | 'escalation_pack'

export interface CaseEntitlementRow {
  case_id: string
  plan: CaseEntitlementPlan
  features: Record<string, unknown>
  purchased_at: string | null
  expires_at: string | null
  source: string | null
  purchase_ref: string | null
  created_at: string
  updated_at: string
}
