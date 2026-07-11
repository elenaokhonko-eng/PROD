'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import type { CaseDecisionRunRow } from '@/lib/types/decision'

export interface UseDecisionRunRealtimeOptions {
  enabled?: boolean
}

function compareCreatedAtDesc(a: CaseDecisionRunRow, b: CaseDecisionRunRow): number {
  const aTs = Date.parse(a.created_at)
  const bTs = Date.parse(b.created_at)
  return (Number.isNaN(bTs) ? 0 : bTs) - (Number.isNaN(aTs) ? 0 : aTs)
}

export function useDecisionRunRealtime(
  caseId: string | null | undefined,
  options?: UseDecisionRunRealtimeOptions,
) {
  const supabase = useSupabaseBrowser()
  const queryClient = useQueryClient()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  const query = useQuery({
    queryKey: caseId ? qk.case.decision(caseId) : ['case', 'decision', 'missing-case-id'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_decision_runs')
        .select(
          'id, case_id, decision_json, eligibility_status, strength_score_value, model_name, prompt_version, created_at, extract_run_id, validation_run_id',
        )
        .eq('case_id', caseId as string)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return (data ?? null) as CaseDecisionRunRow | null
    },
  })

  useEffect(() => {
    if (!enabled || !caseId) return

    const channel = supabase
      .channel(`case-decision-runs:${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'case_decision_runs', filter: `case_id=eq.${caseId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            void queryClient.invalidateQueries({ queryKey: qk.case.decision(caseId) })
            return
          }

          const incoming = payload.new as CaseDecisionRunRow | null
          if (!incoming?.id) return

          queryClient.setQueryData<CaseDecisionRunRow | null>(qk.case.decision(caseId), (current) => {
            if (!current) return incoming
            return compareCreatedAtDesc(incoming, current) <= 0 ? incoming : current
          })
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void queryClient.invalidateQueries({ queryKey: qk.case.decision(caseId) })
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [caseId, enabled, queryClient, supabase])

  return query
}
