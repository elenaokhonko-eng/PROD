'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import type { SavedFidrecRoute } from '@/components/state-machine/transition/fidrec-offer'

const ROUTE_KEYS = ['fidrec_route', 'fidrec_final_reply_date', 'fidrec_complaint_date'] as const

// The saved answer to the FIDReC route question (Part B walk-through, 25 Nov, PB-17): the offer shows it, and lets it
// be changed, whatever the readiness reason.
export function useFidrecRoute(caseId: string) {
  const supabase = useSupabaseBrowser()
  return useQuery({
    queryKey: qk.case.fidrecRoute(caseId),
    queryFn: async (): Promise<SavedFidrecRoute | null> => {
      const { data, error } = await supabase
        .from('case_responses')
        .select('question_key, response_value')
        .eq('case_id', caseId)
        .in('question_key', [...ROUTE_KEYS])
      if (error) throw error
      const value = (key: string) => {
        const row = (data ?? []).find((r) => r.question_key === key)
        return typeof row?.response_value === 'string' && row.response_value ? row.response_value : null
      }
      const route = value('fidrec_route')
      if (route !== 'final_reply' && route !== 'no_reply' && route !== 'not_complained') return null
      const date =
        route === 'final_reply' ? value('fidrec_final_reply_date') : route === 'no_reply' ? value('fidrec_complaint_date') : null
      return { route, date }
    },
  })
}
