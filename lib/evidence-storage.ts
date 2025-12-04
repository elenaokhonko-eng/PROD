import { createClient } from "@/lib/supabase/client"
import { trackClientEvent } from "@/lib/analytics/client"

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

export async function uploadEvidence(
  caseId: string,
  userId: string,
  file: File,
  category: string,
  description: string,
): Promise<EvidenceFile> {
  const formData = new FormData()
  formData.append("caseId", caseId)
  formData.append("category", category)
  formData.append("description", description || file.name)
  formData.append("file", file)

  const res = await fetch("/api/evidence/upload", {
    method: "POST",
    body: formData,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || "Failed to upload evidence")
  }

  const { evidence } = (await res.json()) as { evidence: EvidenceFile }

  await trackClientEvent({
    eventName: "evidence_uploaded",
    userId: userId,
    eventData: {
      case_id: caseId,
      filename: file.name,
      category: category,
      file_size: file.size,
    },
    pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  })

  return evidence
}

export async function getEvidenceList(caseId: string): Promise<EvidenceFile[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("evidence")
    .select("*")
    .eq("case_id", caseId)
    .order("uploaded_at", { ascending: false })

  if (error) throw error

  return data || []
}

export async function getEvidenceUrl(filePath: string): Promise<string> {
  const supabase = createClient()

  const { data } = await supabase.storage.from("evidence").createSignedUrl(filePath, 3600) // 1 hour expiry

  return data?.signedUrl || ""
}

export async function deleteEvidence(evidenceId: string, userId: string): Promise<void> {
  const supabase = createClient()

  // Get evidence details
  const { data: evidence } = await supabase.from("evidence").select("*").eq("id", evidenceId).single()

  if (!evidence) throw new Error("Evidence not found")

  // Delete from storage
  await supabase.storage.from("evidence").remove([evidence.file_path])

  // Delete record
  await supabase.from("evidence").delete().eq("id", evidenceId)

  // Track deletion
  await trackClientEvent({
    eventName: "evidence_deleted",
    userId: userId,
    eventData: { case_id: evidence.case_id, evidence_id: evidenceId },
    pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  })
}
