import { NextResponse } from "next/server"

import { createUserClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const STORAGE_BUCKETS = ["case_evidence", "evidence"] as const

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

    let supabase
    try {
      supabase = await createUserClient()
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // RLS limits this lookup to cases owned by the authenticated user.
    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id")
      .eq("id", caseId)
      .maybeSingle()

    if (caseErr) {
      console.error("[evidence/upload] Case ownership lookup failed:", caseErr)
      return NextResponse.json({ error: "Failed to verify case ownership" }, { status: 500 })
    }
    if (!caseRow) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 })
    }

    const originalName = (file as File).name ?? "upload"
    const fileExt = originalName.includes(".") ? originalName.split(".").pop() : undefined
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${fileExt ? `.${fileExt}` : ""}`
    const filePath = `cases/${caseId}/documents/${fileName}`

    let uploadedBucket: (typeof STORAGE_BUCKETS)[number] | null = null
    let lastStorageError: unknown = null
    for (const bucket of STORAGE_BUCKETS) {
      const { error } = await supabase.storage.from(bucket).upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      })
      if (!error) {
        uploadedBucket = bucket
        break
      }
      lastStorageError = error
    }

    if (!uploadedBucket) {
      console.error("[evidence/upload] Storage upload failed:", lastStorageError)
      const errorMessage =
        lastStorageError && typeof lastStorageError === "object" && "message" in lastStorageError
          ? String((lastStorageError as { message?: unknown }).message ?? "")
          : ""
      if (errorMessage.toLowerCase().includes("row-level security policy")) {
        return NextResponse.json(
          {
            error:
              "Storage upload blocked by Supabase Storage RLS policy. Update storage.objects INSERT policy for your evidence bucket/path.",
          },
          { status: 403 },
        )
      }
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
    }

    // IS 4.2: this route owns the `case_documents` row after Storage write.
    // Supabase storage auto-insert (`sync_case_document_from_storage`) is off in prod.
    const { data: insertedDoc, error: insertErr } = await supabase
      .from("case_documents")
      .insert({
        case_id: caseId,
        filename: originalName,
        original_filename: originalName,
        file_size: (file as File).size,
        mime_type: (file as File).type,
        document_type: null,
        storage_bucket: uploadedBucket,
        storage_path: filePath,
        processing_status: "pending",
        is_processed: false,
      })
      .select("id")
      .single()

    if (insertErr || !insertedDoc?.id) {
      console.error("[evidence/upload] case_documents insert failed:", insertErr)
      return NextResponse.json({ error: "Failed to create case document record" }, { status: 500 })
    }

    return NextResponse.json({
      evidence: {
        case_id: caseId,
        filename: originalName,
        file_path: filePath,
        file_type: (file as File).type,
        file_size: (file as File).size,
        description: description || originalName,
        category,
      },
      caseDocumentId: insertedDoc.id,
    })
  } catch (err) {
    console.error("[evidence/upload] Unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
