'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import type { CaseDocumentRow } from '@/lib/types/documents'
import {
  areDocumentsSettled,
  classifyDocument,
  type DocStatusRow,
} from '@/lib/case-documents/document-readiness'

export interface UseAutoRefireExtractInput {
  caseId: string | null | undefined
  documents: Array<
    Pick<
      CaseDocumentRow,
      'id' | 'processing_status' | 'is_processed' | 'content_latest_id'
    >
  > | null | undefined
  /** Optional extraction presence by document id (preferred). */
  extractionDocIds?: Set<string> | string[] | null
  hasNarrative: boolean
  enabled?: boolean
}

function toStatusRows(
  documents: UseAutoRefireExtractInput['documents'],
  extractionDocIds?: UseAutoRefireExtractInput['extractionDocIds'],
): DocStatusRow[] {
  const extrSet =
    extractionDocIds instanceof Set
      ? extractionDocIds
      : new Set(extractionDocIds ?? [])

  return (documents ?? []).map((doc) => ({
    id: String(doc.id),
    processing_status: doc.processing_status,
    is_processed: doc.is_processed,
    has_extraction_content:
      extrSet.has(String(doc.id)) || Boolean(doc.content_latest_id),
  }))
}

function settlementKey(docs: DocStatusRow[]): string {
  return docs
    .map((d) => `${d.id}:${classifyDocument(d)}`)
    .sort()
    .join('|')
}

export function useAutoRefireExtract({
  caseId,
  documents,
  extractionDocIds,
  hasNarrative,
  enabled = true,
}: UseAutoRefireExtractInput) {
  const queryClient = useQueryClient()
  const lastFiredKeyRef = useRef<string | null>(null)

  const statusRows = useMemo(
    () => toStatusRows(documents, extractionDocIds),
    [documents, extractionDocIds],
  )

  const settled = useMemo(() => areDocumentsSettled(statusRows), [statusRows])
  const key = useMemo(() => settlementKey(statusRows), [statusRows])

  const fireExtract = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch('/api/edge/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: id }),
      })
      const json = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      // Expected while other docs finish settling — not fatal.
      if (response.status === 409 && json?.error === 'documents_not_ready') {
        return { pending: true as const }
      }

      if (!response.ok) {
        throw new Error(json?.error ?? 'Failed to re-fire extract')
      }
      return { pending: false as const }
    },
    onSuccess: async (result, id) => {
      if (result?.pending) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.case.extract(id) }),
        queryClient.invalidateQueries({ queryKey: qk.case.validation(id) }),
        queryClient.invalidateQueries({ queryKey: qk.case.eligibility(id) }),
      ])
    },
  })

  useEffect(() => {
    if (!enabled || !caseId) return
    if (!hasNarrative) return
    if (!settled) return
    if (statusRows.length === 0) return
    if (fireExtract.isPending) return
    if (lastFiredKeyRef.current === key) return

    lastFiredKeyRef.current = key
    fireExtract.mutate(caseId)
  }, [caseId, enabled, fireExtract, hasNarrative, key, settled, statusRows.length])

  return {
    refireExtract: fireExtract.mutate,
    isRefiring: fireExtract.isPending,
    // Surface only non-pending failures
    error: fireExtract.error,
  }
}
