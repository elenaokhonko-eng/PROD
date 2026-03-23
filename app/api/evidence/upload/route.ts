import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/service"

export const runtime = "nodejs"

const STORAGE_BUCKET = "evidence"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")
    const caseId = formData.get("caseId") as string | null
    const category = (formData.get("category") as string | null) ?? "evidence"
    const description = (formData.get("description") as string | null) ?? undefined

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "File is required" }, { status: 400 })
    }
    if (!caseId) {
      return NextResponse.json({ error: "caseId is required" }, { status: 400 })
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabaseService = createServiceClient()

    // Build storage path
    const originalName = (file as File).name ?? "upload"
    const fileExt = originalName.includes(".") ? originalName.split(".").pop() : undefined
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${fileExt ? `.${fileExt}` : ""}`
    const filePath = `${caseId}/${category}/${fileName}`

    // Upload to storage using service role (bypasses bucket RLS)
    const { error: storageError } = await supabaseService.storage.from(STORAGE_BUCKET).upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    })
    if (storageError) {
      console.error("[evidence/upload] Storage upload failed:", storageError)
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
    }

    // Insert DB record using service role (bypasses table RLS)
    const { data: evidence, error: insertError } = await supabaseService
      .from("evidence")
      .insert({
        case_id: caseId,
        user_id: user.profileId,
        filename: originalName,
        file_path: filePath,
        file_type: (file as File).type,
        file_size: (file as File).size,
        description: description || originalName,
        category,
      })
      .select()
      .single()

    if (insertError) {
      console.error("[evidence/upload] Insert failed:", insertError)
      return NextResponse.json({ error: "Failed to save evidence metadata" }, { status: 500 })
    }

    const { error: caseDocError } = await supabaseService
      .from("case_documents")
      .insert({
        case_id: caseId,
        filename: originalName,
        original_filename: originalName,
        file_size: (file as File).size,
        mime_type: (file as File).type,
        document_type: null,
        storage_bucket: STORAGE_BUCKET,
        storage_path: filePath,
        processing_status: "uploaded",
        is_processed: false,
      })

    if (caseDocError) {
      console.error("[evidence/upload] case_documents insert failed:", caseDocError)
      return NextResponse.json({ error: "Failed to create case document record" }, { status: 500 })
    }

    return NextResponse.json({ evidence })
  } catch (err) {
    console.error("[evidence/upload] Unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
