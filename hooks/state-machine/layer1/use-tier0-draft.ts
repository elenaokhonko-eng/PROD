'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import type { CaseNarrativeRow, Tier0DraftBundle } from '@/lib/types/narratives'

function toDraftBundle(rows: CaseNarrativeRow[]): Tier0DraftBundle {
  return {
    tier0_summary: rows.find((row) => row.narrative_type === 'tier0_summary') ?? null,
    tier0_evidence_checklist:
      rows.find((row) => row.narrative_type === 'tier0_evidence_checklist') ?? null,
    tier0_srf_signal: rows.find((row) => row.narrative_type === 'tier0_srf_signal') ?? null,
    other: rows.filter(
      (row) =>
        row.narrative_type !== 'tier0_summary' &&
        row.narrative_type !== 'tier0_evidence_checklist' &&
        row.narrative_type !== 'tier0_srf_signal',
    ),
  }
}

export interface UseTier0DraftOptions {
  enabled?: boolean
}

export function useTier0Draft(caseId: string | null | undefined, options?: UseTier0DraftOptions) {
  const supabase = useSupabaseBrowser()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  return useQuery({
    queryKey: caseId ? qk.case.narratives(caseId) : ['case', 'narratives', 'missing-case-id'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_narratives')
        .select(
          'id, case_id, narrative_type, title, text_content, source_ref, created_at, version, intake_id, extract_run_id, decision_run_id, language, audience',
        )
        .eq('case_id', caseId as string)
        .order('created_at', { ascending: false })

      if (error) throw error
      return toDraftBundle((data ?? []) as CaseNarrativeRow[])
    },
  })
}
