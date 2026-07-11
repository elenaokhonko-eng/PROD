'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import type { ReportRow } from '@/lib/types/report'

export interface UseLatestReportOptions {
  enabled?: boolean
}

export function useLatestReport(caseId: string | null | undefined, options?: UseLatestReportOptions) {
  const supabase = useSupabaseBrowser()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  return useQuery({
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
}
