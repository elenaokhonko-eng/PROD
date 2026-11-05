'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { FactsRequestError } from '@/hooks/state-machine/facts/use-case-facts'

// Generates the free evaluation from a confirmed "free" snapshot. Replaces the old automatic free draft: nothing is
// generated until the user has confirmed their facts (design C3).
export function useGenerateFreeEvaluation(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (snapshotId: string) => {
      const response = await fetch('/api/edge/tier0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId, fact_snapshot_id: snapshotId }),
      })
      const json = (await response.json().catch(() => null)) as { error?: string; reason?: string } | null
      if (!response.ok) {
        throw new FactsRequestError(json?.error ?? 'Failed to generate the free evaluation', json?.reason ?? null, response.status)
      }
    },
    onSuccess: async () => {
      // The free evaluation makes the case ready to buy (report.purchaseReady in the capabilities response).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.case.narratives(caseId) }),
        queryClient.invalidateQueries({ queryKey: qk.entitlement(caseId) }),
      ])
    },
  })
}
