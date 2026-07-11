/**
 * `public.reports` row shape — produced by `run_report_selfserve_v1`.
 * Mirrors schema lines 1306–1317. IS §4.5 + §9.7.
 *
 * SM R4: UI always renders `ORDER BY created_at DESC LIMIT 1`.
 */

export type ReportStatus = 'DRAFT' | 'COMPLETED' | 'EXPORTED' | 'RESOLVED'

/** Report payload is agreed with Masha's service; structure is dynamic
 *  but carries these common blocks. */
export interface ReportJson {
  title?: string
  executive_summary?: string
  timeline?: Array<{ date?: string; event: string }>
  disputed_transactions?: Array<Record<string, unknown>>
  requested_resolution?: string
  evidence_checklist?: Array<{ label: string; present: boolean }>
  disclaimers?: string[]
  [extra: string]: unknown
}

export interface ReportRow {
  id: string
  user_id: string | null
  case_id: string | null
  status: ReportStatus
  report_json: ReportJson | null
  created_at: string
  updated_at: string
  report_type: string
  source_decision_run_id: string | null
  inputs_hash: string | null
}

/** Payload for `POST /api/edge/report`. The `simulation_key` is injected
 *  server-side and must NEVER be sent from the browser. */
export interface ReportPayload {
  case_id: string
}

export interface ReportResponse {
  ok: boolean
  report_id?: string
  report?: ReportJson
  error?: string
}
