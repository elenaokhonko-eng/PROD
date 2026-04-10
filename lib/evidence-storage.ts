import { trackClientEvent } from '@/lib/analytics/client'

export interface EvidenceFile {
  id: string
  case_id: string
  user_id: string
  filename: string
  file_path: string
  file_type: string
  file_size: number
  description: string
  category: string
  uploaded_at: string
}

export type EvidenceProcessResponse = {
  ok: boolean
  queued: number
  skipped: number
  results: Array<{
    evidence_id: string
    document_id?: string | null
    ok: boolean
    queued?: boolean
    skipped?: boolean
    error?: string | null
  }>
}

export async function uploadEvidence(
  caseId: string,
  userId: string,
  file: File,
  category: string,
  description: string
): Promise<EvidenceFile> {
  const formData = new FormData()
  formData.append('caseId', caseId)
  formData.append('category', category)
  formData.append('description', description || file.name)
  formData.append('file', file)

  const res = await fetch('/api/evidence/upload', {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to upload evidence')
  }

  const { evidence } = (await res.json()) as { evidence: EvidenceFile }

  await trackClientEvent({
    eventName: 'evidence_uploaded',
    userId: userId,
    eventData: {
      case_id: caseId,
      filename: file.name,
      category: category,
      file_size: file.size,
    },
    pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  })

  return evidence
}

export async function processEvidence(
  caseId: string,
  evidenceIds?: string[]
): Promise<EvidenceProcessResponse> {
  const res = await fetch(`/api/cases/${caseId}/evidence/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ evidenceIds }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to queue evidence processing')
  }

  return res.json() as Promise<EvidenceProcessResponse>
}

export async function getEvidenceList(
  caseId: string
): Promise<EvidenceFile[]> {
  const res = await fetch(`/api/cases/${caseId}/evidence`)

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to fetch evidence')
  }

  const { evidence } = (await res.json()) as { evidence: EvidenceFile[] }
  return evidence || []
}

export async function deleteEvidence(
  evidenceId: string,
  userId: string
): Promise<void> {
  const res = await fetch(`/api/evidence/${evidenceId}`, {
    method: 'DELETE',
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to delete evidence')
  }

  await trackClientEvent({
    eventName: 'evidence_deleted',
    userId: userId,
    eventData: { evidence_id: evidenceId },
    pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  })
}
