/**
 * `public.case_validation_runs` row shape. Mirrors schema lines 1049–1067.
 * IS §4.2 + §9.4 two-step read pattern.
 *
 * SM R5: resolve the run id via `get_case_eligibility().resolved_ids.latest_validation_run_id`
 * (see `getLatestValidationRunId`) then SELECT by PK. Never query this table on `case_id` alone.
 */

export type ValidationSource = 'model' | 'rules' | 'hybrid'

export type ValidationAnswerType =
  | 'text'
  | 'date'
  | 'datetime'
  | 'money'
  | 'number'
  | 'boolean'
  | 'single_choice'
  | 'multi_choice'
  | 'file_upload'
  | 'textarea'
  | 'long_text'

export type ValidationAnswerValue = string | boolean | string[]

export type MissingFieldEntry =
  | string
  | {
      field?: string
      reason?: string
      severity?: 'required' | 'recommended' | 'optional' | string
      suggested_question?: string
      [extra: string]: unknown
    }

export interface ValidationQuestion {
  /** Stable key the UI uses to map answers back to intake. */
  key: string
  question: string
  /** UI hint. Not all runs populate this. */
  field_type?: ValidationAnswerType | string
  required?: boolean
  options?: unknown[]
  severity?: string
  help_text?: string | null
  [extra: string]: unknown
}

export interface ValidationGapItemRow {
  id: string
  validation_run_id: string
  case_id: string
  extract_run_id: string | null
  field_key: string
  field_label: string | null
  gap_type: string
  severity: 'required' | 'recommended' | 'optional' | string
  question_text: string
  help_text: string | null
  expected_answer_type: ValidationAnswerType | string | null
  answer_options: unknown[]
  source: string
  sort_order: number
  created_at: string
}

export interface CaseValidationRunRow {
  id: string
  case_id: string
  extract_run_id: string
  intake_id: string | null
  /** Dynamic missing-field records. Older rows may still contain strings. */
  missing_fields: MissingFieldEntry[]
  /** Array of ambiguous-field records. Shape is dynamic. */
  ambiguities: unknown[]
  /** The dynamic gap-question list the UI renders. */
  questions_to_user: ValidationQuestion[]
  validation_summary: string | null
  status: string
  source: ValidationSource
  model_name: string | null
  prompt_version: string | null
  schema_version: string
  is_valid: boolean
  raw_output: Record<string, unknown> | null
  error_message: string | null
  created_at: string
}
