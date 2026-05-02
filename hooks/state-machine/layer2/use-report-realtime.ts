'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import type { ReportRow } from '@/lib/types/report'

export interface UseReportRealtimeOptions {
  enabled?: boolean
}

function compareCreatedAtDesc(a: ReportRow, b: ReportRow): number {
  const aTs = Date.parse(a.created_at)
  const bTs = Date.parse(b.created_at)
  return (Number.isNaN(bTs) ? 0 : bTs) - (Number.isNaN(aTs) ? 0 : aTs)
}

export function useReportRealtime(caseId: string | null | undefined, options?: UseReportRealtimeOptions) {
  const supabase = useSupabaseBrowser()
  const queryClient = useQueryClient()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  const query = useQuery({
    queryKey: caseId ? qk.case.report(caseId) : ['case', 'report', 'missing-case-id'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reports')
        .select(
          'id, user_id, case_id, status, report_json, created_at, updated_at, report_type, source_decision_run_id, inputs_hash',
        )
        .eq('case_id', caseId as string)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return (data ?? null) as ReportRow | null
    },
  })

  useEffect(() => {
    if (!enabled || !caseId) return

    const channel = supabase
      .channel(`reports:${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports', filter: `case_id=eq.${caseId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            void queryClient.invalidateQueries({ queryKey: qk.case.report(caseId) })
            return
          }

          const incoming = payload.new as ReportRow | null
          if (!incoming?.id) return

          queryClient.setQueryData<ReportRow | null>(qk.case.report(caseId), (current) => {
            if (!current) return incoming
            return compareCreatedAtDesc(incoming, current) <= 0 ? incoming : current
          })
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void queryClient.invalidateQueries({ queryKey: qk.case.report(caseId) })
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [caseId, enabled, queryClient, supabase])

  return query
}
