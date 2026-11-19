'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { FactsRequestError } from '@/hooks/state-machine/facts/use-case-facts'

export type GeneratedStage = 'free' | 'bank'

const ROUTES: Record<GeneratedStage, { path: string; failure: string }> = {
  free: { path: '/api/edge/tier0', failure: 'Failed to generate the free evaluation' },
  bank: { path: '/api/edge/bank-pack', failure: 'Failed to generate the bank pack' },
}

// Generates a stage's output from its confirmed snapshot: the free evaluation, or the bank pack once it is paid for.
// Nothing is generated until the person has confirmed their facts (design C3; stage2-plan §3a).
export function useGenerateStage(caseId: string, stage: GeneratedStage) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (snapshotId: string) => {
      const response = await fetch(ROUTES[stage].path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId, fact_snapshot_id: snapshotId }),
      })
      const json = (await response.json().catch(() => null)) as { error?: string; reason?: string; checks?: Array<{ check?: string }> } | null
      if (!response.ok) {
        const checks = [...new Set((json?.checks ?? []).map((c) => c.check).filter((c): c is string => typeof c === 'string'))]
        throw new FactsRequestError(json?.error ?? ROUTES[stage].failure, json?.reason ?? null, response.status, checks)
      }
    },
    onSuccess: async () => {
      // The free evaluation makes the case ready to buy (report.purchaseReady in the capabilities response); the bank
      // pack is read as the case's latest report.
      await Promise.all(
        stage === 'free'
          ? [
              queryClient.invalidateQueries({ queryKey: qk.case.narratives(caseId) }),
              queryClient.invalidateQueries({ queryKey: qk.entitlement(caseId) }),
            ]
          : [queryClient.invalidateQueries({ queryKey: qk.case.report(caseId) })],
      )
    },
  })
}

export function useGenerateFreeEvaluation(caseId: string) {
  return useGenerateStage(caseId, 'free')
}
