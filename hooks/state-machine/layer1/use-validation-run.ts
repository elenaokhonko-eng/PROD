'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import { useCaseEligibility } from '@/hooks/state-machine/layer1/use-case-eligibility'
import { getPreferredValidationQuestions } from '@/lib/validation-gaps'
import type { CaseValidationRunRow, ValidationGapItemRow } from '@/lib/types/validation'

export interface UseValidationRunOptions {
  enabled?: boolean
  includeGapItems?: boolean
}

export function useValidationRun(caseId: string | null | undefined, options?: UseValidationRunOptions) {
  const supabase = useSupabaseBrowser()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)
  const includeGapItems = options?.includeGapItems ?? true

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

  const gapItemsQuery = useQuery({
    queryKey:
      caseId && validationRunId
        ? qk.case.validationGapItems(caseId, validationRunId)
        : ['case', 'validation', 'gap-items', 'missing-validation-run-id'],
    enabled: enabled && includeGapItems && Boolean(caseId) && Boolean(validationRunId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_case_validation_gap_items')
        .select(
          'id, validation_run_id, case_id, extract_run_id, field_key, field_label, gap_type, severity, question_text, help_text, expected_answer_type, answer_options, source, sort_order, created_at',
        )
        .eq('validation_run_id', validationRunId as string)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (error) {
        console.warn('[validation-gaps] falling back to questions_to_user', error.message)
        return []
      }

      return (data ?? []) as ValidationGapItemRow[]
    },
  })

  const questions = useMemo(
    () =>
      getPreferredValidationQuestions(
        gapItemsQuery.data ?? [],
        validationQuery.data?.questions_to_user ?? [],
      ),
    [gapItemsQuery.data, validationQuery.data?.questions_to_user],
  )

  return {
    ...validationQuery,
    validationRunId,
    eligibility: eligibilityQuery.data ?? null,
    eligibilityQuery,
    gapItemsQuery,
    questions,
  }
}
