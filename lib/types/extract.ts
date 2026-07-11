/**
 * `public.case_extract_runs` row shape — the output of `run_case_extract_v4`.
 * Mirrors schema lines 948–957. IS §4.1.
 *
 * SM R4 + IS §8.1 gotcha 7: re-runs always APPEND. UI always reads the latest.
 */

export interface CaseExtractRunRow {
  id: string
  case_id: string
  /** The LLM-extracted JSON. Shape is dynamic; typed as Record for now. */
  extract_json: Record<string, unknown>
  /** `null` on legacy rows; `string[]` or structured JSON post-v3. */
  missing_fields: unknown | null
  model_name: string
  prompt_version: string
  created_at: string
  intake_id: string | null
}

/** Payload shape for `POST /api/edge/extract`. Matches the edge function body. */
export interface ExtractPayload {
  case_id: string
}

/** Common wrapper shape returned by the edge function via the server route. */
export interface ExtractResponse {
  ok: boolean
  extract_run_id?: string
  extract_json?: Record<string, unknown>
  missing_fields?: unknown
  error?: string
}
