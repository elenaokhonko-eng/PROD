'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import type { ReportRow } from '@/lib/types/report'

export interface UseReportRealtimeOptions {
  enabled?: boolean
  /** Poll while the paid pipeline is still producing it; Realtime is best-effort (D7). */
  poll?: boolean
  /** Which pack: the bank pack (and older self-serve reports), or the FIDReC pack. Default bank. */
  kind?: ReportKind
}

export type ReportKind = 'bank' | 'fidrec'

export const FIDREC_REPORT_TYPE = 'fidrec_pack_v1'

const isKind = (row: Pick<ReportRow, 'report_type'>, kind: ReportKind) =>
  kind === 'fidrec' ? row.report_type === FIDREC_REPORT_TYPE : row.report_type !== FIDREC_REPORT_TYPE

const PIPELINE_POLL_MS = 10_000

function compareCreatedAtDesc(a: ReportRow, b: ReportRow): number {
  const aTs = Date.parse(a.created_at)
  const bTs = Date.parse(b.created_at)
  return (Number.isNaN(bTs) ? 0 : bTs) - (Number.isNaN(aTs) ? 0 : aTs)
}

export function useReportRealtime(caseId: string | null | undefined, options?: UseReportRealtimeOptions) {
  const supabase = useSupabaseBrowser()
  const queryClient = useQueryClient()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)
  const kind = options?.kind ?? 'bank'
  const keyFor = (id: string) => (kind === 'fidrec' ? qk.case.fidrecReport(id) : qk.case.report(id))

  const query = useQuery({
    queryKey: caseId ? keyFor(caseId) : ['case', 'report', kind, 'missing-case-id'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reports')
        .select(
          'id, user_id, case_id, status, report_json, created_at, updated_at, report_type, source_decision_run_id, inputs_hash',
        )
        .eq('case_id', caseId as string)
        [kind === 'fidrec' ? 'eq' : 'neq']('report_type', FIDREC_REPORT_TYPE)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return (data ?? null) as ReportRow | null
    },
    refetchInterval: (query) => (options?.poll && query.state.data?.status !== 'COMPLETED' ? PIPELINE_POLL_MS : false),
  })

  useEffect(() => {
    if (!enabled || !caseId) return

    const channel = supabase
      .channel(`reports:${kind}:${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports', filter: `case_id=eq.${caseId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            void queryClient.invalidateQueries({ queryKey: keyFor(caseId) })
            return
          }

          const incoming = payload.new as ReportRow | null
          if (!incoming?.id || !isKind(incoming, kind)) return

          queryClient.setQueryData<ReportRow | null>(keyFor(caseId), (current) => {
            if (!current) return incoming
            return compareCreatedAtDesc(incoming, current) <= 0 ? incoming : current
          })
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void queryClient.invalidateQueries({ queryKey: keyFor(caseId) })
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
    // keyFor depends only on kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, enabled, kind, queryClient, supabase])

  return query
}
