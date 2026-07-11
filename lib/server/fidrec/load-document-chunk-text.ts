import { createServiceClient } from "@/lib/supabase/service"

export async function loadDocumentChunkTextByDocumentId(
  caseId: string,
  documentIds: string[],
): Promise<Map<string, string>> {
  if (!documentIds.length) {
    return new Map()
  }

  const supabase = createServiceClient()
  const { data: documents, error: documentsError } = await supabase
    .from("case_documents")
    .select("id, content_latest_id")
    .eq("case_id", caseId)
    .in("id", documentIds)

  if (documentsError) {
    throw new Error(`Failed to load case_documents for chunk text: ${documentsError.message}`)
  }

  const contentIdByDocumentId = new Map<string, string>()
  const contentIds: string[] = []
  for (const row of documents ?? []) {
    const documentId = row.id as string
    const contentId = row.content_latest_id as string | null
    if (!contentId) continue
    contentIdByDocumentId.set(documentId, contentId)
    contentIds.push(contentId)
  }

  if (!contentIds.length) {
    return new Map()
  }

  const { data: chunks, error: chunksError } = await supabase
    .from("case_document_chunks")
    .select("content_id, chunk_index, chunk_text")
    .in("content_id", contentIds)
    .order("chunk_index", { ascending: true })

  if (chunksError) {
    throw new Error(`Failed to load case_document_chunks: ${chunksError.message}`)
  }

  const chunkTextByContentId = new Map<string, string[]>()
  for (const row of chunks ?? []) {
    const contentId = row.content_id as string
    const chunkText = typeof row.chunk_text === "string" ? row.chunk_text : ""
    if (!chunkText.trim()) continue
    const existing = chunkTextByContentId.get(contentId) ?? []
    existing.push(chunkText)
    chunkTextByContentId.set(contentId, existing)
  }

  const chunkTextByDocumentId = new Map<string, string>()
  for (const [documentId, contentId] of contentIdByDocumentId) {
    const parts = chunkTextByContentId.get(contentId)
    if (!parts?.length) continue
    chunkTextByDocumentId.set(documentId, parts.join("\n"))
  }

  return chunkTextByDocumentId
}
