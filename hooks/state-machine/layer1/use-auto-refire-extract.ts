'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import type { CaseDocumentRow } from '@/lib/types/documents'

export interface UseAutoRefireExtractInput {
  caseId: string | null | undefined
  documents: Array<Pick<CaseDocumentRow, 'id' | 'processing_status'>> | null | undefined
  hasNarrative: boolean
  enabled?: boolean
}

export function useAutoRefireExtract({
  caseId,
  documents,
  hasNarrative,
  enabled = true,
}: UseAutoRefireExtractInput) {
  const queryClient = useQueryClient()
  const seenReadyIdsRef = useRef<Set<string>>(new Set())

  const readyIds = useMemo(
    () =>
      (documents ?? [])
        .filter((doc) => doc.processing_status === 'ready')
        .map((doc) => doc.id)
        .filter(Boolean),
    [documents],
  )

  const fireExtract = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch('/api/edge/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: id }),
      })
      const json = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        throw new Error(json?.error ?? 'Failed to re-fire extract')
      }
    },
    onSuccess: async (_data, id) => {
      // #region agent log
      fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',hypothesisId:'RF1',location:'use-auto-refire-extract.ts:onSuccess',message:'auto-refire extract OK',data:{caseId:id},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.case.extract(id) }),
        queryClient.invalidateQueries({ queryKey: qk.case.validation(id) }),
        queryClient.invalidateQueries({ queryKey: qk.case.eligibility(id) }),
      ])
    },
  })

  useEffect(() => {
    if (!enabled || !caseId || readyIds.length === 0) return
    if (!hasNarrative) return
    if (fireExtract.isPending) return

    const hasNewReady = readyIds.some((id) => !seenReadyIdsRef.current.has(id))
    if (!hasNewReady) return

    for (const id of readyIds) {
      seenReadyIdsRef.current.add(id)
    }

    fireExtract.mutate(caseId)
  }, [caseId, enabled, fireExtract, readyIds])

  return {
    refireExtract: fireExtract.mutate,
    isRefiring: fireExtract.isPending,
    error: fireExtract.error,
  }
}
