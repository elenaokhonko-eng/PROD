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

type UploadEvidenceResponse =
  | {
      error?: string
      evidence?: {
        id?: string | null
      } | null
    }
  | null

type ProcessEvidenceResult = {
  evidence_id: string
  document_id?: string | null
  ok: boolean
  queued?: boolean
  skipped?: boolean
  error?: string | null
}

type ProcessEvidenceResponse =
  | {
      ok?: boolean
      error?: string
      results?: ProcessEvidenceResult[]
    }
  | null

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

        const uploadJson = (await uploadResponse.json().catch(() => null)) as UploadEvidenceResponse

        if (!uploadResponse.ok) {
          throw new Error(uploadJson?.error ?? 'Failed to upload evidence')
        }

        const evidenceId = uploadJson?.evidence?.id

        if (!evidenceId) {
          throw new Error(`Failed to create evidence record for ${file.name}`)
        }

        const processResponse = await fetch(`/api/cases/${caseId}/evidence/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ evidenceIds: [evidenceId] }),
        })

        const processJson = (await processResponse.json().catch(() => null)) as ProcessEvidenceResponse
        if (!processResponse.ok || processJson?.ok === false) {
          throw new Error(processJson?.error ?? 'Failed to queue evidence processing')
        }

        const processed = processJson?.results?.find((result) => result.evidence_id === evidenceId)

        if (!processed?.ok) {
          throw new Error(processed?.error ?? `Failed to queue evidence processing for ${file.name}`)
        }

        const documentId = processed.document_id

        if (!documentId) {
          throw new Error(`Failed to register case document for ${file.name}`)
        }

        results.push({
          documentId,
          fileName: file.name,
          evidence: { ok: true },
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
