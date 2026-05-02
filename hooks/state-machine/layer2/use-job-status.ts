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
      // #region agent log
      fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H1',location:'use-job-status.ts:25',message:'job-status getToken resolved',data:{hasToken:Boolean(token),caseIdPresent:Boolean(caseId)},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
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
      // #region agent log
      fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H3',location:'use-job-status.ts:37',message:'job-status fetch completed',data:{status:response.status,ok:response.ok},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      const json = (await response.json().catch(() => null)) as JobStatusResponse | null

      if (!response.ok) {
        // #region agent log
        fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H3',location:'use-job-status.ts:42',message:'job-status non-OK body',data:{status:response.status,error:json?.error ?? null},timestamp:Date.now()})}).catch(()=>{})
        // #endregion
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
