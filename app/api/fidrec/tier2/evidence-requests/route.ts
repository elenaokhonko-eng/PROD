import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { assertCaseAccess, CaseAccessDeniedError, CaseNotFoundError } from "@/lib/server/fidrec/assert-case-access"
import { createServiceClient } from "@/lib/supabase/service"
import type { EvidenceRequestPriority } from "@/lib/types/fidrec"

export const runtime = "nodejs"

const querySchema = z.object({
  caseId: z.string().uuid("caseId must be a valid UUID"),
})

const PRIORITY_ORDER: Record<EvidenceRequestPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const caseIdRaw = url.searchParams.get("caseId")

  let parsedQuery: z.infer<typeof querySchema>
  try {
    parsedQuery = querySchema.parse({ caseId: caseIdRaw })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid query params", details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid query params" }, { status: 400 })
  }

  try {
    await assertCaseAccess({ caseId: parsedQuery.caseId, userSupabaseUuid: user.supabaseUuid })
  } catch (error) {
    if (error instanceof CaseNotFoundError) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 })
    }
    if (error instanceof CaseAccessDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.json({ error: "Failed to fetch evidence requests" }, { status: 500 })
  }

  const service = createServiceClient()

  const { data, error } = await service
    .from("case_evidence_requests")
    .select(
      "id, case_id, source_question_id, source_assertion_id, source_finding_id, source_link_id, request_text, request_reason, evidence_category, requested_from, priority, status, suggested_file_types, example_documents, raw_model_output, created_at, updated_at",
    )
    .eq("case_id", parsedQuery.caseId)
    .order("created_at", { ascending: true })

  if (error) {
    return NextResponse.json({ error: "Failed to fetch evidence requests" }, { status: 500 })
  }

  const rows = data ?? []
  rows.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority as EvidenceRequestPriority] ?? 99
    const pb = PRIORITY_ORDER[b.priority as EvidenceRequestPriority] ?? 99
    if (pa !== pb) return pa - pb
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  })

  return NextResponse.json({ evidence_requests: rows })
}
