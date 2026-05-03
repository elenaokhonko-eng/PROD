'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import type { EvidenceResponse } from '@/lib/types/documents'

export interface UploadEvidenceInput {
  caseId: string
  files: File[]
}

export interface UploadEvidenceResultItem {
  documentId: string
  fileName: string
  evidence: EvidenceResponse
}

export function useUploadEvidence() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ caseId, files }: UploadEvidenceInput): Promise<UploadEvidenceResultItem[]> => {
      const results: UploadEvidenceResultItem[] = []

      for (const file of files) {
        const formData = new FormData()
        formData.append('caseId', caseId)
        formData.append('category', 'evidence')
        formData.append('description', file.name)
        formData.append('file', file)

        const uploadResponse = await fetch('/api/evidence/upload', {
          method: 'POST',
          body: formData,
        })

        const uploadJson = (await uploadResponse.json().catch(() => null)) as
          | { error?: string; caseDocumentId?: string | null }
          | null

        if (!uploadResponse.ok) {
          throw new Error(uploadJson?.error ?? 'Failed to upload evidence')
        }

        const documentId = uploadJson?.caseDocumentId

        if (!documentId) {
          throw new Error(`Failed to create case document for ${file.name}`)
        }

        const evidenceResponse = await fetch('/api/edge/evidence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document_id: documentId }),
        })

        const evidenceJson = (await evidenceResponse.json().catch(() => null)) as EvidenceResponse | null
        if (!evidenceResponse.ok) {
          throw new Error(evidenceJson?.error ?? 'Failed to process evidence')
        }

        results.push({
          documentId,
          fileName: file.name,
          evidence: evidenceJson ?? { ok: true },
        })
      }

      return results
    },
    onSuccess: async (_data, variables) => {
      const caseId = variables.caseId
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.case.documents(caseId) }),
        queryClient.invalidateQueries({ queryKey: qk.case.extract(caseId) }),
        queryClient.invalidateQueries({ queryKey: qk.case.validation(caseId) }),
        queryClient.invalidateQueries({ queryKey: qk.case.eligibility(caseId) }),
        queryClient.invalidateQueries({ queryKey: qk.case.narratives(caseId) }),
      ])
    },
  })
}
