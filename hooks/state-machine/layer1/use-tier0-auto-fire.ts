'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import { useValidationRun } from '@/hooks/state-machine/layer1/use-validation-run'
import type { CaseDocumentRow } from '@/lib/types/documents'

export interface UseTier0AutoFireInput {
  caseId: string | null | undefined
  documents: Array<Pick<CaseDocumentRow, 'id' | 'processing_status' | 'updated_at'>> | null | undefined
  enabled?: boolean
}

function getLatestReadyDocumentTimestamp(
  documents: Array<Pick<CaseDocumentRow, 'processing_status' | 'updated_at'>>,
): number | null {
  let latest: number | null = null
  for (const doc of documents) {
    if (doc.processing_status !== 'ready') continue
    const timestamp = doc.updated_at ? Date.parse(doc.updated_at) : NaN
    if (Number.isNaN(timestamp)) continue
    if (latest == null || timestamp > latest) latest = timestamp
  }
  return latest
}

export function useTier0AutoFire({ caseId, documents, enabled = true }: UseTier0AutoFireInput) {
  const supabase = useSupabaseBrowser()
  const queryClient = useQueryClient()
  const hasFiredRef = useRef(false)
  const canRun = Boolean(caseId) && enabled

  const validationQuery = useValidationRun(caseId, { enabled: canRun })

  const latestExtractQuery = useQuery({
    queryKey: caseId ? qk.case.extract(caseId) : ['case', 'extract', 'missing-case-id'],
    enabled: canRun,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_extract_runs')
        .select('created_at')
        .eq('case_id', caseId as string)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return data?.created_at ?? null
    },
  })

  const hasNarrativesQuery = useQuery({
    queryKey: caseId ? [...qk.case.narratives(caseId), 'exists'] : ['case', 'narratives', 'exists'],
    enabled: canRun,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_narratives')
        .select('id')
        .eq('case_id', caseId as string)
        .limit(1)

      if (error) throw error
      return (data ?? []).length > 0
    },
  })

  const fireTier0 = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch('/api/edge/tier0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: id }),
      })
      const json = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(json?.error ?? 'Failed to run tier0 generation')
    },
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: qk.case.narratives(id) })
    },
  })

  const latestReadyDocumentTs = useMemo(
    () => getLatestReadyDocumentTimestamp((documents ?? []) as Array<Pick<CaseDocumentRow, 'processing_status' | 'updated_at'>>),
    [documents],
  )

  useEffect(() => {
    if (!canRun || !caseId) return
    if (hasFiredRef.current || fireTier0.isPending) return

    const validation = validationQuery.data
    if (!validation) {
      // #region agent log
      if (latestReadyDocumentTs != null) {
        fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',hypothesisId:'TF1',location:'use-tier0-auto-fire.ts:gate',message:'tier0 blocked',data:{reason:'no-validation',caseId,latestReadyDocumentTs,extractCreatedAt:latestExtractQuery.data ?? null,hasNarratives:hasNarrativesQuery.data ?? null},timestamp:Date.now()})}).catch(()=>{})
      }
      // #endregion
      return
    }

    const missingFields = validation.missing_fields ?? []
    if (Array.isArray(missingFields) && missingFields.length > 0) {
      // #region agent log
      if (latestReadyDocumentTs != null) {
        fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',hypothesisId:'TF2',location:'use-tier0-auto-fire.ts:gate',message:'tier0 blocked',data:{reason:'missing-fields',missingCount:missingFields.length,caseId,latestReadyDocumentTs},timestamp:Date.now()})}).catch(()=>{})
      }
      // #endregion
      return
    }

    if (latestReadyDocumentTs == null) return

    const latestExtractTs = latestExtractQuery.data ? Date.parse(latestExtractQuery.data) : NaN
    if (Number.isNaN(latestExtractTs) || latestExtractTs <= latestReadyDocumentTs) {
      // #region agent log
      fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',hypothesisId:'TF3',location:'use-tier0-auto-fire.ts:gate',message:'tier0 blocked',data:{reason:'extract-not-fresh-after-ready',caseId,latestExtractRaw:latestExtractQuery.data ?? null,latestExtractTs:Number.isNaN(latestExtractTs)?null:latestExtractTs,latestReadyDocumentTs,strictFresh:Number.isFinite(latestExtractTs)&&latestExtractTs>latestReadyDocumentTs},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      return
    }

    if (hasNarrativesQuery.data) {
      // #region agent log
      fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',hypothesisId:'TF4',location:'use-tier0-auto-fire.ts:gate',message:'tier0 skip',data:{reason:'narratives-exist',caseId},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      return
    }

    // #region agent log
    fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',hypothesisId:'TF5',location:'use-tier0-auto-fire.ts:fire',message:'tier0 auto-fire mutate',data:{caseId,latestExtractTs,latestReadyDocumentTs},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    hasFiredRef.current = true
    fireTier0.mutate(caseId, {
      onError: () => {
        hasFiredRef.current = false
      },
    })
  }, [
    canRun,
    caseId,
    fireTier0,
    hasNarrativesQuery.data,
    latestExtractQuery.data,
    latestReadyDocumentTs,
    validationQuery.data,
  ])

  return {
    autoFireTier0: fireTier0.mutate,
    isAutoFiring: fireTier0.isPending,
    error: fireTier0.error,
    validationQuery,
    latestExtractQuery,
    hasNarrativesQuery,
  }
}
