'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'

// "Continue without documents" on the upload step is kept as a case answer, so a reload does not bring the step back
// (walkthrough, 9 Nov). Documents can still be added on the confirm screen.
export const EVIDENCE_SKIPPED_KEY = 'evidence_skipped'

export function useEvidenceSkipped(caseId: string) {
  const supabase = useSupabaseBrowser()
  return useQuery({
    queryKey: qk.case.evidenceSkipped(caseId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_responses')
        .select('question_key')
        .eq('case_id', caseId)
        .eq('question_key', EVIDENCE_SKIPPED_KEY)
        .limit(1)
      if (error) throw error
      return (data ?? []).length > 0
    },
  })
}
