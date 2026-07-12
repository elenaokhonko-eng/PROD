'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useAuth } from '@clerk/nextjs'
import type { FidrecSubmissionPack } from '@/lib/types/fidrec-case-pack'

export interface Tier2PackResponse {
  submission_pack: FidrecSubmissionPack
}

export interface UseTier2PackOptions {
  enabled?: boolean
}

export function useTier2Pack(caseId: string | null | undefined, options?: UseTier2PackOptions) {
  const { getToken } = useAuth()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  return useQuery({
    queryKey: caseId ? qk.case.tier2Pack(caseId) : ['case', 'tier2-pack', 'missing-case-id'],
    enabled,
    queryFn: async () => {
      const token = await getToken({ template: 'supabase' })
      if (!token) {
        throw new Error('Missing Supabase token')
      }

      const response = await fetch(`/api/fidrec/tier2/case-pack-json?caseId=${caseId}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      const json = (await response.json().catch(() => null)) as Tier2PackResponse | { error?: string } | null
      if (!response.ok) {
        const message = json && 'error' in json && typeof json.error === 'string' ? json.error : `Failed to fetch Tier 2 pack (${response.status})`
        throw new Error(message)
      }

      if (!json || !('submission_pack' in json)) {
        throw new Error('Tier 2 pack endpoint returned invalid payload')
      }

      return json as Tier2PackResponse
    },
  })
}
