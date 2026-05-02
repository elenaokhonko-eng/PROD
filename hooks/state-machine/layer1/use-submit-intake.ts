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
      // #region agent log
      fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'extract-ui-debug',hypothesisId:'H11',location:'use-submit-intake.ts:22',message:'submit-intake fetch completed',data:{status:response.status,ok:response.ok,caseIdPresent:Boolean(caseId)},timestamp:Date.now()})}).catch(()=>{})
      // #endregion

      const json = (await response.json().catch(() => null)) as ExtractResponse | null
      // #region agent log
      fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'extract-ui-debug',hypothesisId:'H12',location:'use-submit-intake.ts:26',message:'submit-intake response parsed',data:{hasJson:Boolean(json),error:json && 'error' in json ? (json as { error?: unknown }).error ?? null : null,okField:json && 'ok' in json ? (json as { ok?: unknown }).ok ?? null : null},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
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
        queryClient.invalidateQueries({ queryKey: qk.case.eligibility(caseId) }),
        queryClient.invalidateQueries({ queryKey: qk.case.narratives(caseId) }),
      ])
    },
  })
}
