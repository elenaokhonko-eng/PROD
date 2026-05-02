'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import type { CaseDocumentRow } from '@/lib/types/documents'

export interface UseCaseDocumentsRealtimeOptions {
  enabled?: boolean
}

export function useCaseDocumentsRealtime(
  caseId: string | null | undefined,
  options?: UseCaseDocumentsRealtimeOptions,
) {
  const supabase = useSupabaseBrowser()
  const queryClient = useQueryClient()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  const query = useQuery({
    queryKey: caseId ? qk.case.documents(caseId) : ['case', 'documents', 'missing-case-id'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_documents')
        .select(
          'id, case_id, created_at, updated_at, filename, original_filename, file_size, mime_type, document_type, exhibit_label, upload_date, file_url, is_processed, sha256, processing_status, processing_error, verified_document_type, verification_status, verification_confidence, content_latest_id, storage_provider, storage_bucket, storage_path',
        )
        .eq('case_id', caseId as string)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data ?? []) as CaseDocumentRow[]
    },
  })

  useEffect(() => {
    if (!enabled || !caseId) return

    const channel = supabase
      .channel(`case-documents:${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'case_documents', filter: `case_id=eq.${caseId}` },
        (payload) => {
          queryClient.setQueryData<CaseDocumentRow[]>(qk.case.documents(caseId), (current) => {
            const existing = current ?? []

            if (payload.eventType === 'DELETE') {
              const oldId = (payload.old as { id?: string } | null)?.id
              if (!oldId) return existing
              return existing.filter((row) => row.id !== oldId)
            }

            const nextRow = payload.new as CaseDocumentRow | null
            if (!nextRow?.id) return existing

            const idx = existing.findIndex((row) => row.id === nextRow.id)
            if (idx === -1) {
              return [nextRow, ...existing]
            }

            const copy = [...existing]
            copy[idx] = { ...copy[idx], ...nextRow }
            return copy
          })
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void queryClient.invalidateQueries({ queryKey: qk.case.documents(caseId) })
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [caseId, enabled, queryClient, supabase])

  return query
}
