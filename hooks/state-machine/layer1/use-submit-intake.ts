'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import type { ExtractResponse } from '@/lib/types/extract'

export interface SubmitIntakeInput {
  caseId: string
  runExtract?: boolean
}

export function useSubmitIntake() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ caseId, runExtract = true }: SubmitIntakeInput): Promise<ExtractResponse> => {
      if (!runExtract) {
        return { ok: true }
      }

      const response = await fetch('/api/edge/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId }),
      })

      const json = (await response.json().catch(() => null)) as ExtractResponse | null
      if (!response.ok) {
        throw new Error(json?.error ?? 'Failed to run extract')
      }
      return json ?? { ok: true }
    },
    onSuccess: async (_data, variables) => {
      const { caseId } = variables
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.case.extract(caseId) }),
        queryClient.invalidateQueries({ queryKey: qk.case.validation(caseId) }),
        queryClient.invalidateQueries({ queryKey: qk.case.validationGapItems(caseId) }),
        queryClient.invalidateQueries({ queryKey: qk.case.eligibility(caseId) }),
        queryClient.invalidateQueries({ queryKey: qk.case.narratives(caseId) }),
      ])
    },
  })
}
