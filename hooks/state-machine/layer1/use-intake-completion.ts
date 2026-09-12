'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import {
  hasCompletedIntakeResponses,
  REQUIRED_INTAKE_RESPONSE_KEYS,
  type IntakeResponseSnapshot,
} from '@/lib/intake-completion'

export function useIntakeCompletion(caseId: string | null | undefined) {
  const supabase = useSupabaseBrowser()

  return useQuery({
    queryKey: caseId ? qk.case.intakeCompletion(caseId) : ['case', 'intake-completion', 'missing-case-id'],
    enabled: Boolean(caseId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_responses')
        .select('question_key, response_value')
        .eq('case_id', caseId as string)
        .in('question_key', [...REQUIRED_INTAKE_RESPONSE_KEYS])

      if (error) throw error
      return hasCompletedIntakeResponses(data as IntakeResponseSnapshot[])
    },
  })
}
