'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import type { RecommendationView } from '@/lib/server/facts/recommendation'

export type { RecommendationView }

export function useRecommendation(caseId: string, enabled = true) {
  return useQuery({
    queryKey: qk.case.recommendation(caseId),
    enabled,
    queryFn: async (): Promise<RecommendationView> => {
      const response = await fetch(`/api/cases/${caseId}/recommendation`, { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as (RecommendationView & { error?: string }) | null
      if (!response.ok || !json) throw new Error(json?.error ?? 'Failed to load the recommendation')
      return json
    },
  })
}

export function useJoinWaitlist() {
  return useMutation({
    mutationFn: async (product: 'bank_pack' | 'fidrec_pack') => {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product }),
      })
      const json = (await response.json().catch(() => null)) as { ok?: boolean; email?: string; error?: string } | null
      if (!response.ok || !json?.ok) throw new Error(json?.error ?? 'Could not save your request')
      return { product, email: json.email ?? '' }
    },
  })
}
