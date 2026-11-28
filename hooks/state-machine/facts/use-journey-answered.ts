'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import { JOURNEY_KEYS } from '@/lib/facts'

// Whether the journey questions (spec 4.1) were answered. The police question is required and asked nowhere else (the
// FIDReC timeline writes the bank answers), so its answer is enough.
export function useJourneyAnswered(caseId: string) {
  const supabase = useSupabaseBrowser()
  return useQuery({
    queryKey: qk.case.journey(caseId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_responses')
        .select('question_key')
        .eq('case_id', caseId)
        .eq('question_key', JOURNEY_KEYS.policeReport)
        .limit(1)
      if (error) throw error
      return (data ?? []).length > 0
    },
  })
}
