'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import { useCaseEligibility } from '@/hooks/state-machine/layer1/use-case-eligibility'
import type { CaseValidationRunRow } from '@/lib/types/validation'

export interface UseValidationRunOptions {
  enabled?: boolean
}

export function useValidationRun(caseId: string | null | undefined, options?: UseValidationRunOptions) {
  const supabase = useSupabaseBrowser()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  const eligibilityQuery = useCaseEligibility(caseId, { enabled })
  const validationRunId = eligibilityQuery.data?.resolved_ids?.validation_run_id ?? null

  const validationQuery = useQuery({
    queryKey: caseId ? qk.case.validation(caseId) : ['case', 'validation', 'missing-case-id'],
    enabled: enabled && Boolean(validationRunId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_validation_runs')
        .select(
          'id, case_id, extract_run_id, intake_id, missing_fields, ambiguities, questions_to_user, validation_summary, status, source, model_name, prompt_version, schema_version, is_valid, raw_output, error_message, created_at',
        )
        .eq('id', validationRunId as string)
        .maybeSingle()

      if (error) throw error
      if (!data) throw new Error('Validation run not found')
      return data as CaseValidationRunRow
    },
  })

  return {
    ...validationQuery,
    validationRunId,
    eligibility: eligibilityQuery.data ?? null,
    eligibilityQuery,
  }
}
