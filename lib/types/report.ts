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
  /** Bank pack (bank_pack_v1): built from the confirmed facts, never by the model. */
  total_loss?: string | null
  rules_assessment?: string
  [extra: string]: unknown
}

/** FIDReC pack (fidrec_pack_v1, run_fidrec_pack_v1). Mirrors FidrecPackReport in _shared/facts/fidrec-pack.ts. */
export interface FidrecPackJson {
  report_version?: string
  title?: string
  executive_summary?: string
  claimant_position?: string
  institution_position?: string
  arguments_for_claimant?: Array<{ text: string; evidence_ids: string[] }>
  arguments_for_institution?: Array<{ text: string; evidence_ids: string[] }>
  institution_duties?: Array<{ text: string; clause_ids: string[]; evidence_ids: string[] }>
  regulatory_sources?: Array<{ id: string; source: string; clause_ref: string | null; title: string | null }>
  timeline?: Array<{ date?: string; event: string }>
  disputed_transactions?: Array<Record<string, string>>
  total_loss?: string | null
  evidence_index?: Array<{ id: string; document: string }>
  evidence_checklist?: Array<{ label: string; present: boolean }>
  route?: string
  rules_assessment?: string
  final_reply_used?: boolean
  prose_source?: 'model' | 'fallback'
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
 *  server-side and must NEVER be sent from the browser.
 *  Do not send `user_id` — ownership is resolved from `cases.user_id`
 *  (Pattern C) inside `run_report_selfserve_v1`. */
export interface ReportPayload {
  case_id: string
  force?: boolean
}

export interface ReportResponse {
  ok: boolean
  report_id?: string
  report?: ReportJson
  error?: string
}
