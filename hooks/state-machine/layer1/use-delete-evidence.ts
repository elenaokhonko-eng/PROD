'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'

// Removes an uploaded document (walkthrough, 9 Nov). The facts are read again without it, so an evaluation made from
// it shows as out of date.
export function useDeleteEvidence(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: string) => {
      const response = await fetch(`/api/evidence/${encodeURIComponent(documentId)}?by=document`, { method: 'DELETE' })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'The document could not be removed')
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.case.documents(caseId) }),
        queryClient.invalidateQueries({ queryKey: ['case', caseId, 'facts'] }),
      ])
    },
  })
}
