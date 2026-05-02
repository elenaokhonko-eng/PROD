import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"

import { createUserClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const STORAGE_BUCKETS = ["case_evidence", "evidence"] as const
const DEBUG_ENDPOINT = "http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807"
const DEBUG_SESSION_ID = "5b59f2"

function debugLog(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch(DEBUG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION_ID },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: "upload-route-debug",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion
}

function parseJwtSupabaseUuid(token: string | null): string | null {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length < 2) return null
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))
    const payload = JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8")) as Record<string, unknown>
    return typeof payload.supabase_uuid === "string" ? payload.supabase_uuid : null
  } catch {
    return null
  }
}

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
    debugLog("H19", "evidence/upload/route.ts:43", "route entry validated", {
      hasFile: true,
      caseIdPresent: Boolean(caseId),
      fileType: (file as File).type || "unknown",
      fileSize: (file as File).size,
    })
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
    let projectRef: string | null = null
    try {
      projectRef = new URL(url).hostname.split(".")[0] ?? null
    } catch {
      projectRef = null
    }
    debugLog("H24", "evidence/upload/route.ts:62", "supabase project ref in route env", {
      projectRef,
    })
    const { getToken } = await auth()
    const clerkSupabaseToken = await getToken({ template: "supabase" })
    const jwtSupabaseUuid = parseJwtSupabaseUuid(clerkSupabaseToken)
    debugLog("H25", "evidence/upload/route.ts:69", "clerk supabase jwt claim presence", {
      hasToken: Boolean(clerkSupabaseToken),
      hasSupabaseUuidClaim: Boolean(jwtSupabaseUuid),
    })

    let supabase
    try {
      supabase = await createUserClient()
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { data: authUserData, error: authUserError } = await supabase.auth.getUser()
    debugLog("H27", "evidence/upload/route.ts:82", "supabase auth.getUser before storage upload", {
      hasAuthUser: Boolean(authUserData?.user?.id),
      authUserIdPrefix: authUserData?.user?.id ? authUserData.user.id.slice(0, 8) : null,
      authUserErrorMessage: authUserError?.message ?? null,
    })

    // Ownership check before storage write.
    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id,user_id")
      .eq("id", caseId)
      .maybeSingle()
    if (caseErr) {
      console.error("[evidence/upload] Case ownership lookup failed:", caseErr)
      return NextResponse.json({ error: "Failed to verify case ownership" }, { status: 500 })
    }
    if (!caseRow) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 })
    }
    debugLog("H19", "evidence/upload/route.ts:64", "ownership check passed", {
      hasCaseRow: Boolean(caseRow),
      caseId,
    })
    debugLog("H26", "evidence/upload/route.ts:95", "case ownership claim comparison", {
      hasCaseOwnerId: Boolean(caseRow?.user_id),
      hasSupabaseUuidClaim: Boolean(jwtSupabaseUuid),
      claimMatchesCaseOwner:
        typeof caseRow?.user_id === "string" && typeof jwtSupabaseUuid === "string"
          ? caseRow.user_id === jwtSupabaseUuid
          : false,
    })

    // Build storage path expected by the storage sync trigger.
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
      debugLog("H20", "evidence/upload/route.ts:79", "bucket upload attempted", {
        bucket,
        filePath,
        ok: !error,
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? null,
        errorStatusCode:
          error && typeof error === "object" && "statusCode" in error ? (error as { statusCode?: unknown }).statusCode ?? null : null,
        errorCode: error && typeof error === "object" && "error" in error ? (error as { error?: unknown }).error ?? null : null,
      })
      if (!error) {
        uploadedBucket = bucket
        break
      }
      lastStorageError = error
    }
    if (!uploadedBucket) {
      console.error("[evidence/upload] Storage upload failed:", lastStorageError)
      debugLog("H21", "evidence/upload/route.ts:93", "all bucket uploads failed", {
        filePath,
        errorMessage:
          lastStorageError && typeof lastStorageError === "object" && "message" in lastStorageError
            ? String((lastStorageError as { message?: unknown }).message)
            : null,
      })
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
    debugLog("H21", "evidence/upload/route.ts:102", "bucket upload succeeded", {
      uploadedBucket,
      filePath,
    })

    // TEMPORARY DEVIATION FROM Front-to-Back-End-Integration-Summary.md §4.2:
    // the contract says the server route owns the `case_documents` INSERT.
    // The DB currently has trigger `public.sync_case_document_from_storage()`
    // which auto-inserts a row when an object lands in `case_evidence` and
    // collides with our INSERT via `case_documents_storage_unique`. Until
    // Masha removes that trigger, we read-after-trigger: select the row by
    // (storage_bucket, storage_path) and patch the metadata fields the
    // trigger leaves blank. Revert to the §4.2 INSERT once the trigger is
    // dropped. See "Temporary deviation" note in §4.2 of the integration doc.
    const { data: caseDoc, error: caseDocError } = await supabase
      .from("case_documents")
      .select("id")
      .eq("storage_bucket", uploadedBucket)
      .eq("storage_path", filePath)
      .maybeSingle()

    debugLog("H29", "evidence/upload/route.ts:lookup", "case_documents row after storage", {
      hasRow: Boolean(caseDoc?.id),
      uploadedBucket,
      runId: "slice5-verify",
    })

    if (caseDocError) {
      console.error("[evidence/upload] case_documents lookup failed:", caseDocError)
      debugLog("H28", "evidence/upload/route.ts:200", "case_documents lookup failed", {
        message: caseDocError.message,
        code: (caseDocError as { code?: unknown }).code ?? null,
      })
      return NextResponse.json({ error: "Failed to locate case document record" }, { status: 500 })
    }
    if (!caseDoc?.id) {
      // Trigger disabled or path/bucket mismatch — fall back to the §4.2 INSERT.
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
          processing_status: "uploaded",
          is_processed: false,
        })
        .select("id")
        .single()
      if (insertErr || !insertedDoc?.id) {
        console.error("[evidence/upload] case_documents fallback insert failed:", insertErr)
        debugLog("H28", "evidence/upload/route.ts:230", "case_documents fallback insert failed", {
          message: insertErr?.message ?? null,
          code: (insertErr as { code?: unknown } | null)?.code ?? null,
        })
        return NextResponse.json({ error: "Failed to create case document record" }, { status: 500 })
      }
      debugLog("H22", "evidence/upload/route.ts:240", "case_documents created via fallback insert", {
        hasCaseDocumentId: true,
        caseId,
        uploadedBucket,
      })
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
    }

    // Patch trigger-created row with metadata only the app knows.
    const { error: patchErr } = await supabase
      .from("case_documents")
      .update({
        filename: originalName,
        original_filename: originalName,
        file_size: (file as File).size,
        mime_type: (file as File).type,
        processing_status: "uploaded",
        is_processed: false,
      })
      .eq("id", caseDoc.id)
    if (patchErr) {
      // Non-fatal: pipeline can still proceed with the trigger-set defaults.
      console.warn("[evidence/upload] case_documents metadata patch failed:", patchErr)
      debugLog("H28", "evidence/upload/route.ts:265", "case_documents metadata patch failed", {
        message: patchErr.message,
        code: (patchErr as { code?: unknown }).code ?? null,
      })
    }
    debugLog("H22", "evidence/upload/route.ts:270", "case_documents read-after-trigger succeeded", {
      hasCaseDocumentId: Boolean(caseDoc.id),
      caseId,
      uploadedBucket,
    })

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
      caseDocumentId: caseDoc?.id ?? null,
    })
  } catch (err) {
    console.error("[evidence/upload] Unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
