'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@clerk/nextjs'
import { qk } from '@/hooks/state-machine/query-keys'

export interface JobStatusResponse {
  status: string
  error?: string | null
}

export interface UseJobStatusOptions {
  enabled?: boolean
}

export function useJobStatus(caseId: string | null | undefined, options?: UseJobStatusOptions) {
  const { getToken } = useAuth()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  return useQuery({
    queryKey: caseId ? qk.case.job(caseId) : ['case', 'job', 'missing-case-id'],
    enabled,
    queryFn: async () => {
      const token = await getToken({ template: 'supabase' })
      if (!token) {
        throw new Error('Missing Supabase token')
      }

      const response = await fetch(`/api/cases/${caseId}/job-status`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const json = (await response.json().catch(() => null)) as JobStatusResponse | null

      if (!response.ok) {
        throw new Error(json?.error ?? `Failed to fetch job status (${response.status})`)
      }
      if (!json?.status) {
        throw new Error('Job status endpoint returned invalid payload')
      }

      return json
    },
    refetchInterval: 2_000,
  })
}
