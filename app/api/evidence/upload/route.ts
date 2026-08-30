import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import { getProfileCaseEditAccess } from "@/lib/case-documents/register-from-evidence-v1"
import { createServiceClient } from "@/lib/supabase/service"
import { isAllowedMime } from "@/lib/types/documents"

export const runtime = "nodejs"

const STORAGE_BUCKET = "evidence"
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024
const MAX_MULTIPART_BODY_BYTES = MAX_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
const MAX_FILENAME_LENGTH = 255
const MAX_DESCRIPTION_LENGTH = 2000
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/i
const MIME_EXTENSION = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
} as const

function getContentLength(request: Request): number | null {
  const value = request.headers.get("content-length")?.trim()
  if (!value || !/^\d+$/.test(value)) return null

  const contentLength = Number(value)
  return Number.isSafeInteger(contentLength) ? contentLength : null
}

async function hasValidFileSignature(file: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  switch (file.type) {
    case "application/pdf":
      return (
        bytes.length >= 5 &&
        bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46 &&
        bytes[4] === 0x2d
      )
    case "image/png":
      return (
        bytes.length >= 8 &&
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
          (value, index) => bytes[index] === value,
        )
      )
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    default:
      return false
  }
}

async function queueFailedStorageCleanup(
  supabaseService: ReturnType<typeof createServiceClient>,
  filePath: string,
  cleanupError: string,
): Promise<void> {
  const { error } = await supabaseService.from("storage_cleanup_queue").upsert(
    {
      storage_bucket: STORAGE_BUCKET,
      storage_path: filePath,
      reason: "evidence_metadata_registration_failed",
      last_error: cleanupError,
      updated_at: new Date().toISOString(),
      resolved_at: null,
    },
    { onConflict: "storage_bucket,storage_path" },
  )
  if (error) {
    console.error("[evidence/upload] Failed to queue Storage reconciliation:", error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const contentLength = getContentLength(request)
    if (contentLength === null) {
      return NextResponse.json({ error: "A valid Content-Length header is required for uploads" }, { status: 411 })
    }
    if (contentLength > MAX_MULTIPART_BODY_BYTES) {
      return NextResponse.json({ error: "Upload request is too large" }, { status: 413 })
    }

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json({ error: "Invalid multipart upload" }, { status: 400 })
    }

    const file = formData.get("file")
    const caseId = formData.get("caseId") as string | null
    const category = ((formData.get("category") as string | null) ?? "evidence").trim().toLowerCase()
    const description = ((formData.get("description") as string | null) ?? "").trim()

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "File is required" }, { status: 400 })
    }
    if (!caseId) {
      return NextResponse.json({ error: "caseId is required" }, { status: 400 })
    }
    if (!isAllowedMime(file.type)) {
      return NextResponse.json({ error: "Only PDF, PNG, and JPEG files are supported" }, { status: 415 })
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File must be between 1 byte and 50 MiB" }, { status: 413 })
    }
    if (!(await hasValidFileSignature(file))) {
      return NextResponse.json({ error: "File contents do not match the declared type" }, { status: 415 })
    }
    if (!CATEGORY_PATTERN.test(category)) {
      return NextResponse.json({ error: "Invalid evidence category" }, { status: 400 })
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json({ error: "Description is too long" }, { status: 400 })
    }

    const supabaseService = createServiceClient()
    const caseAccess = await getProfileCaseEditAccess(supabaseService, caseId, user.supabaseUuid)
    if (caseAccess === "not_found") {
      return NextResponse.json({ error: "Case not found" }, { status: 404 })
    }
    if (caseAccess === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const originalName = ((file as File).name || "upload").trim()
    if (!originalName || originalName.length > MAX_FILENAME_LENGTH) {
      return NextResponse.json({ error: "Filename is invalid or too long" }, { status: 400 })
    }
    const fileName = `${randomUUID()}.${MIME_EXTENSION[file.type]}`
    const filePath = `${caseId}/${category}/${fileName}`

    const { error: storageError } = await supabaseService.storage.from(STORAGE_BUCKET).upload(filePath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    })
    if (storageError) {
      console.error("[evidence/upload] Storage upload failed:", storageError)
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 })
    }

    const { data: evidence, error: insertError } = await supabaseService.rpc(
      "register_evidence_upload_v1",
      {
        p_case_id: caseId,
        p_actor_profile_id: user.supabaseUuid,
        p_filename: originalName,
        p_file_path: filePath,
        p_file_type: file.type,
        p_file_size: file.size,
        p_description: description || originalName,
        p_category: category,
      },
    )

    if (insertError || !evidence) {
      console.error("[evidence/upload] Insert failed:", insertError)
      const { error: cleanupError } = await supabaseService.storage.from(STORAGE_BUCKET).remove([filePath])
      if (cleanupError) {
        console.error("[evidence/upload] Storage rollback failed:", cleanupError)
        await queueFailedStorageCleanup(supabaseService, filePath, cleanupError.message)
      }
      const quotaExceeded = insertError?.message.includes("case storage quota exceeded")
      return NextResponse.json(
        { error: quotaExceeded ? "Case evidence storage quota exceeded" : "Failed to save evidence metadata" },
        { status: quotaExceeded ? 413 : 500 },
      )
    }

    return NextResponse.json({ evidence })
  } catch (err) {
    console.error("[evidence/upload] Unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
