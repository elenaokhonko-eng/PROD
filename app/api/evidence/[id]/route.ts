import { NextResponse, type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { safeErrorText } from "@/lib/server/safe-error"
import { createUserClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

const STORAGE_BUCKET = "evidence"

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: requestedId } = await params
  const supabase = await createUserClient()

  // The upload list knows documents, not evidence rows: `?by=document` names the case_documents row, and its
  // evidence row is found through the stored file, both read as the user (walkthrough, 9 Nov).
  let id = requestedId
  if (request.nextUrl.searchParams.get("by") === "document") {
    const { data: document } = await supabase
      .from("case_documents")
      .select("case_id, storage_path")
      .eq("id", requestedId)
      .eq("storage_bucket", STORAGE_BUCKET)
      .maybeSingle()
    const { data: evidence } = document
      ? await supabase.from("evidence").select("id").eq("case_id", document.case_id).eq("file_path", document.storage_path).maybeSingle()
      : { data: null }
    if (!evidence) return NextResponse.json({ error: "Evidence not found" }, { status: 404 })
    id = evidence.id as string
  }

  // The owner's own client decides whether this evidence may be deleted (RLS).
  const { data: deletedEvidence, error } = await supabase
    .from("evidence")
    .delete()
    .eq("id", id)
    .select("id, case_id, file_path")
    .maybeSingle()

  if (error) {
    console.error("[evidence/delete] Delete failed:", safeErrorText(error))
    return NextResponse.json({ error: "Evidence could not be deleted" }, { status: 400 })
  }
  if (!deletedEvidence) return NextResponse.json({ error: "Evidence not found" }, { status: 404 })

  // The processed document and what was read from it go too, so the facts are checked again without it and an
  // evaluation made from it is shown as out of date (edge cases, 8 Nov). Its text, extractions and verifications
  // cascade with the case_documents row.
  const service = createServiceClient()
  const { error: documentError } = await service
    .from("case_documents")
    .delete()
    .eq("case_id", deletedEvidence.case_id)
    .eq("storage_bucket", STORAGE_BUCKET)
    .eq("storage_path", deletedEvidence.file_path)
  if (documentError) console.error("[evidence/delete] Document cleanup failed:", safeErrorText(documentError))
  const { error: storageError } = await service.storage.from(STORAGE_BUCKET).remove([deletedEvidence.file_path])
  if (storageError) console.error("[evidence/delete] Storage cleanup failed:", safeErrorText(storageError))

  return NextResponse.json({ success: true })
}
