import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { assertCaseAccess, CaseAccessDeniedError, CaseNotFoundError } from "@/lib/server/fidrec/assert-case-access"
import { createServiceClient } from "@/lib/supabase/service"

export const runtime = "nodejs"

const paramsSchema = z.object({
  requestId: z.string().uuid("requestId must be a valid UUID"),
})

const bodySchema = z.object({
  status: z.enum(["open", "provided", "unavailable", "dismissed"]),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let requestId: string
  try {
    const resolved = await params
    requestId = paramsSchema.parse(resolved).requestId
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid path params", details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid path params" }, { status: 400 })
  }

  let parsedBody: z.infer<typeof bodySchema>
  try {
    parsedBody = bodySchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const service = createServiceClient()

  const { data: requestRow, error: requestError } = await service
    .from("case_evidence_requests")
    .select("id, case_id")
    .eq("id", requestId)
    .single()

  if (requestError || !requestRow) {
    return NextResponse.json({ error: "Evidence request not found" }, { status: 404 })
  }

  try {
    await assertCaseAccess({ caseId: requestRow.case_id, userSupabaseUuid: user.supabaseUuid })
  } catch (error) {
    if (error instanceof CaseNotFoundError) {
      return NextResponse.json({ error: "Evidence request not found" }, { status: 404 })
    }
    if (error instanceof CaseAccessDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.json({ error: "Failed to update evidence request" }, { status: 500 })
  }

  const { data, error } = await service
    .from("case_evidence_requests")
    .update({ status: parsedBody.status })
    .eq("id", requestId)
    .select(
      "id, case_id, source_question_id, source_assertion_id, source_finding_id, source_link_id, request_text, request_reason, evidence_category, requested_from, priority, status, suggested_file_types, example_documents, raw_model_output, created_at, updated_at",
    )
    .single()

  if (error || !data) {
    return NextResponse.json({ error: "Failed to update evidence request" }, { status: 500 })
  }

  return NextResponse.json({ evidence_request: data })
}
