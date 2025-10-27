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
  const supabase = createClient()

  // Generate unique file path
  const fileExt = file.name.split(".").pop()
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
  const filePath = `${caseId}/${category}/${fileName}`

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage.from("evidence").upload(filePath, file, {
    cacheControl: "3600",
    upsert: false,
  })

  if (uploadError) throw uploadError

  // Create evidence record
  const { data: evidenceData, error: evidenceError } = await supabase
    .from("evidence")
    .insert({
      case_id: caseId,
      user_id: userId,
      filename: file.name,
      file_path: filePath,
      file_type: file.type,
      file_size: file.size,
      description: description || file.name,
      category: category,
    })
    .select()
    .single()

  if (evidenceError) throw evidenceError

  // Track upload
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

  return evidenceData
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
