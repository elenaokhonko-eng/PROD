import { createHash, randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import { getProfileCaseEditAccess } from "@/lib/case-documents/register-from-evidence-v1"
import { createServiceClient } from "@/lib/supabase/service"
import { isAllowedMime } from "@/lib/types/documents"
import { documentLimit, MAX_PDF_PAGES, MAX_UPLOAD_BYTES, pdfPageCount, tooManyDocumentsMessage, UPLOAD_TOO_LARGE_MESSAGE, UPLOAD_TOO_MANY_PAGES_MESSAGE } from "@/lib/upload-limits"
import { recordFault } from "@/lib/server/fault-log"
import { safeErrorText } from "@/lib/server/safe-error"
import { HOURLY_LIMIT_MESSAGE, limitResponse, overIpModelLimit, overUploadLimit } from "@/lib/server/usage-limits"

export const runtime = "nodejs"

const STORAGE_BUCKET = "evidence"
const MAX_FILE_BYTES = MAX_UPLOAD_BYTES
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

// Part B walk-through (25 Nov, PB-20): the same file uploaded twice was kept twice, read twice and offered twice. A file
// is a repeat when a document already in the case has the same bytes. Only same-size files are compared, so the stored
// copy is fetched only in that rare case; renamed copies and documents uploaded before this check are caught too.
// Wording chosen by Elena (25 Nov); the upload screen puts the file's name before it.
const DUPLICATE_UPLOAD_MESSAGE = "You have already added this file to your case."

const sha256Of = (bytes: ArrayBuffer) => createHash("sha256").update(new Uint8Array(bytes)).digest("hex")

async function duplicateOf(
  service: ReturnType<typeof createServiceClient>,
  caseId: string,
  file: Blob,
): Promise<string | null> {
  const { data, error } = await service
    .from("evidence")
    .select("filename, file_path")
    .eq("case_id", caseId)
    .eq("file_size", file.size)
    .limit(20)
  if (error || !data?.length) return null
  const hash = sha256Of(await file.arrayBuffer())
  for (const row of data) {
    const { data: stored } = await service.storage.from(STORAGE_BUCKET).download(row.file_path as string)
    if (stored && sha256Of(await stored.arrayBuffer()) === hash) return row.filename as string
  }
  return null
}

// The documents the case holds: its uploads, less those that could not be read. 0 when the count cannot be taken
// (the check before saving has already passed).
async function documentsHeld(service: ReturnType<typeof createServiceClient>, caseId: string): Promise<number> {
  const [uploads, failed] = await Promise.all([
    service.from("evidence").select("id", { count: "exact", head: true }).eq("case_id", caseId),
    service.from("case_documents").select("id", { count: "exact", head: true }).eq("case_id", caseId).eq("processing_status", "failed"),
  ])
  if (uploads.error || failed.error) return 0
  return (uploads.count ?? 0) - (failed.count ?? 0)
}

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
    console.error("[evidence/upload] Failed to queue Storage reconciliation:", safeErrorText(error))
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
      return NextResponse.json({ error: UPLOAD_TOO_LARGE_MESSAGE }, { status: 413 })
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
      return NextResponse.json({ error: UPLOAD_TOO_LARGE_MESSAGE }, { status: 413 })
    }
    if (!(await hasValidFileSignature(file))) {
      return NextResponse.json({ error: "File contents do not match the declared type" }, { status: 415 })
    }
    if (file.type === "application/pdf") {
      const pages = await pdfPageCount(new Uint8Array(await file.arrayBuffer()))
      if (pages !== null && pages > MAX_PDF_PAGES) {
        await recordFault(createServiceClient(), "too_long", caseId)
        return NextResponse.json({ error: UPLOAD_TOO_MANY_PAGES_MESSAGE }, { status: 413 })
      }
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
    // Requirements 8.2: how many documents the case may hold, before anything is stored or read.
    const [{ data: entitlement, error: entitlementError }, { count, error: countError }] = await Promise.all([
      supabaseService.rpc("get_effective_entitlement", { p_case_id: caseId }),
      // A file that could not be read is not part of the case, so it does not count.
      supabaseService.from("case_documents").select("id", { count: "exact", head: true }).eq("case_id", caseId).neq("processing_status", "failed"),
    ])
    if (entitlementError || countError) {
      console.error("[evidence/upload] Document limit not checked:", safeErrorText(entitlementError ?? countError))
      return NextResponse.json({ error: "Failed to upload file" }, { status: 503 })
    }
    const limit = documentLimit((entitlement as { features?: Record<string, unknown> } | null)?.features ?? {})
    if ((count ?? 0) >= limit.max) {
      await recordFault(supabaseService, "too_many", caseId)
      return NextResponse.json({ error: tooManyDocumentsMessage(limit) }, { status: 409 })
    }

    // Before the usage limits: a refused repeat is not read by a model, so it does not count.
    const existing = await duplicateOf(supabaseService, caseId, file)
    if (existing) return NextResponse.json({ error: DUPLICATE_UPLOAD_MESSAGE }, { status: 409 })
    // Every upload is read by a model: limited per account per day and per IP per hour (cost-controls §5 B1).
    if (await overUploadLimit(user.supabaseUuid)) return limitResponse()
    if (overIpModelLimit(request)) return limitResponse(HOURLY_LIMIT_MESSAGE)

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
      console.error("[evidence/upload] Storage upload failed:", safeErrorText(storageError))
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
      console.error("[evidence/upload] Insert failed:", safeErrorText(insertError))
      const { error: cleanupError } = await supabaseService.storage.from(STORAGE_BUCKET).remove([filePath])
      if (cleanupError) {
        console.error("[evidence/upload] Storage rollback failed:", safeErrorText(cleanupError))
        await queueFailedStorageCleanup(supabaseService, filePath, cleanupError.message)
      }
      const quotaExceeded = insertError?.message.includes("case storage quota exceeded")
      return NextResponse.json(
        { error: quotaExceeded ? "Case evidence storage quota exceeded" : "Failed to save evidence metadata" },
        { status: quotaExceeded ? 413 : 500 },
      )
    }

    // Two uploads at once can both pass the count above, so it is taken again once this one is saved. The one that
    // finds too many is removed again: the case never holds more than the limit.
    const heldAfterSaving = await documentsHeld(supabaseService, caseId)
    if (heldAfterSaving > limit.max) {
      const { error: undoError } = await supabaseService.from("evidence").delete().eq("id", (evidence as { id: string }).id)
      if (undoError) console.error("[evidence/upload] Over-limit upload not removed:", safeErrorText(undoError))
      else await supabaseService.storage.from(STORAGE_BUCKET).remove([filePath])
      await recordFault(supabaseService, "too_many", caseId)
      return NextResponse.json({ error: tooManyDocumentsMessage(limit) }, { status: 409 })
    }

    return NextResponse.json({ evidence })
  } catch (err) {
    console.error("[evidence/upload] Unexpected error:", safeErrorText(err))
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
