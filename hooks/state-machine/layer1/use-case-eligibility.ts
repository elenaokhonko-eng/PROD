'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import type { CaseEligibilityResponse } from '@/lib/types/eligibility'

export interface UseCaseEligibilityOptions {
  enabled?: boolean
}

export function useCaseEligibility(caseId: string | null | undefined, options?: UseCaseEligibilityOptions) {
  const supabase = useSupabaseBrowser()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  return useQuery({
    queryKey: caseId ? qk.case.eligibility(caseId) : ['case', 'eligibility', 'missing-case-id'],
    enabled,
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_case_eligibility', { p_case_id: caseId as string })
      if (error) throw error
      if (!data) throw new Error('Eligibility not found')
      return data as CaseEligibilityResponse
    },
  })
}
