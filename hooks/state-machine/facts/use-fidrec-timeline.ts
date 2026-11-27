'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import { readFidrecTimeline, type FidrecTimeline } from '@/lib/journey/fidrec-timeline'

// The saved timeline questionnaire (CR-2): null until it has been answered.
export function useFidrecTimeline(caseId: string) {
  const supabase = useSupabaseBrowser()
  return useQuery({
    queryKey: qk.case.fidrecTimeline(caseId),
    queryFn: async (): Promise<FidrecTimeline | null> => {
      const { data, error } = await supabase.from('case_responses').select('question_key, response_value').eq('case_id', caseId)
      if (error) throw error
      return readFidrecTimeline(data ?? [])
    },
  })
}
