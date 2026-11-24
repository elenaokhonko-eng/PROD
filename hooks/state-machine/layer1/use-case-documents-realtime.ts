'use client'

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import { CASE_DOCUMENT_SELECT, type CaseDocumentRow } from '@/lib/types/documents'

export interface UseCaseDocumentsRealtimeOptions {
  enabled?: boolean
}

// Realtime is best-effort (the staging publication carried no tables, D7); poll while a document is still processing.
export const DOCUMENT_POLL_MS = 5_000
const TERMINAL_DOCUMENT_STATUSES = new Set(['ready', 'failed'])

export function documentsStillProcessing(rows: Array<Pick<CaseDocumentRow, 'processing_status'>> | undefined): boolean {
  return (rows ?? []).some((row) => !TERMINAL_DOCUMENT_STATUSES.has(row.processing_status ?? 'pending'))
}

/** Each document and its processing status, in a stable order: changes when a document is added, removed or moves on. */
export function documentStatusKey(rows: Array<Pick<CaseDocumentRow, 'id' | 'processing_status'>> | undefined): string {
  return (rows ?? [])
    .map((row) => `${row.id}:${row.processing_status ?? 'pending'}`)
    .sort()
    .join('|')
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
        .select(CASE_DOCUMENT_SELECT)
        .eq('case_id', caseId as string)
        .order('upload_date', { ascending: false })

      if (error) throw error
      return (data ?? []) as CaseDocumentRow[]
    },
    refetchInterval: (query) => (documentsStillProcessing(query.state.data) ? DOCUMENT_POLL_MS : false),
  })

  // When a document starts, finishes or fails, the facts are read again with it: refresh them, whether the change came
  // by realtime or by the poll above, so a new question appears without the customer pressing anything. The first load
  // of the list is not a change, so it refreshes nothing.
  const statusKey = query.data ? documentStatusKey(query.data) : null
  const lastStatusKey = useRef<string | null>(null)
  useEffect(() => {
    if (!caseId || statusKey === null || lastStatusKey.current === statusKey) return
    const firstLoad = lastStatusKey.current === null
    lastStatusKey.current = statusKey
    if (firstLoad) return
    void queryClient.invalidateQueries({ queryKey: ['case', caseId, 'facts'] })
  }, [caseId, queryClient, statusKey])

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
