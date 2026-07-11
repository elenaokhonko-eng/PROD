/**
 * `public.case_narratives` row shape — produced by `bright-function` (Tier-0).
 * Mirrors schema lines 992–1005. IS §4.6 + §9.5.
 *
 * SM R6: render whichever rows exist. `tier0_summary` and `tier0_evidence_checklist`
 * are expected; `tier0_srf_signal` is conditional.
 */

export type NarrativeType =
  | 'tier0_summary'
  | 'tier0_evidence_checklist'
  | 'tier0_srf_signal'
  | string

export interface CaseNarrativeRow {
  id: string
  case_id: string
  narrative_type: NarrativeType
  title: string | null
  text_content: string
  source_ref: string | null
  created_at: string
  version: number | null
  intake_id: string | null
  extract_run_id: string | null
  decision_run_id: string | null
  language: string | null
  audience: string | null
}

/** Convenience view used by tier0-draft-view.tsx — three slots, each optional. */
export interface Tier0DraftBundle {
  tier0_summary: CaseNarrativeRow | null
  tier0_evidence_checklist: CaseNarrativeRow | null
  tier0_srf_signal: CaseNarrativeRow | null
  /** Other narrative rows the UI can render opportunistically. */
  other: CaseNarrativeRow[]
}

/** Payload + response for `POST /api/edge/tier0`. */
export interface Tier0Payload {
  case_id: string
}

export interface Tier0Response {
  ok: boolean
  narratives_written?: number
  error?: string
}
