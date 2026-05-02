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
        // #region agent log
        fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'upload-debug',hypothesisId:'H15',location:'use-upload-evidence.ts:36',message:'upload-evidence file start',data:{caseIdPresent:Boolean(caseId),fileName:file.name,fileType:file.type || 'unknown',fileSize:file.size},timestamp:Date.now()})}).catch(()=>{})
        // #endregion
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

        // #region agent log
        fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'upload-debug',hypothesisId:'H16',location:'use-upload-evidence.ts:58',message:'upload-evidence server upload result',data:{status:uploadResponse.status,ok:uploadResponse.ok,errorMessage:uploadJson?.error ?? null,hasCaseDocumentId:Boolean(uploadJson?.caseDocumentId)},timestamp:Date.now()})}).catch(()=>{})
        // #endregion

        if (!uploadResponse.ok) {
          throw new Error(uploadJson?.error ?? 'Failed to upload evidence')
        }

        const documentId = uploadJson?.caseDocumentId
        // #region agent log
        fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'upload-debug',hypothesisId:'H17',location:'use-upload-evidence.ts:70',message:'upload-evidence case_documents id availability',data:{hasDocumentId:Boolean(documentId)},timestamp:Date.now()})}).catch(()=>{})
        // #endregion

        if (!documentId) {
          throw new Error(`Failed to create case document for ${file.name}`)
        }

        const evidenceResponse = await fetch('/api/edge/evidence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document_id: documentId }),
        })

        const evidenceJson = (await evidenceResponse.json().catch(() => null)) as EvidenceResponse | null
        // #region agent log
        fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'upload-debug',hypothesisId:'H18',location:'use-upload-evidence.ts:84',message:'upload-evidence edge evidence response',data:{status:evidenceResponse.status,ok:evidenceResponse.ok,error:evidenceJson?.error ?? null,processingStatus:evidenceJson?.processing_status ?? null},timestamp:Date.now()})}).catch(()=>{})
        // #endregion
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
