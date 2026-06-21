import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { assertCaseAccess, CaseAccessDeniedError, CaseNotFoundError } from "@/lib/server/fidrec/assert-case-access"
import { createServiceClient } from "@/lib/supabase/service"

export const runtime = "nodejs"

const querySchema = z.object({
  caseId: z.string().uuid("caseId must be a valid UUID"),
})

type AssertionRow = {
  id: string
  case_id: string
  source_document_id: string | null
  assertion_text: string
  assertion_type: string
  bank_conclusion_supported: string | null
  particulars_needed: unknown[]
  evidence_needed: unknown[]
  raw_model_output: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type FindingRow = {
  id: string
  case_id: string
  finding_text: string
  finding_type: string
  supporting_evidence: unknown[]
  confidence: string
  missing_information: unknown[]
  human_review_required: boolean
  raw_model_output: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type LinkRow = {
  id: string
  case_id: string
  bank_assertion_id: string
  finding_id: string
  relationship: string
  explanation: string | null
  confidence: string
  next_question: string | null
  created_at: string
  updated_at: string
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
    return NextResponse.json({ error: "Failed to fetch assertion-finding matrix" }, { status: 500 })
  }

  const service = createServiceClient()

  const { data: assertionsData, error: assertionsError } = await service
    .from("case_bank_assertions")
    .select(
      "id, case_id, source_document_id, assertion_text, assertion_type, bank_conclusion_supported, particulars_needed, evidence_needed, raw_model_output, created_at, updated_at",
    )
    .eq("case_id", parsedQuery.caseId)
    .order("created_at", { ascending: true })

  if (assertionsError) {
    return NextResponse.json({ error: "Failed to fetch assertion-finding matrix" }, { status: 500 })
  }

  const { data: findingsData, error: findingsError } = await service
    .from("case_findings")
    .select(
      "id, case_id, finding_text, finding_type, supporting_evidence, confidence, missing_information, human_review_required, raw_model_output, created_at, updated_at",
    )
    .eq("case_id", parsedQuery.caseId)
    .order("created_at", { ascending: true })

  if (findingsError) {
    return NextResponse.json({ error: "Failed to fetch assertion-finding matrix" }, { status: 500 })
  }

  const { data: linksData, error: linksError } = await service
    .from("case_assertion_finding_links")
    .select(
      "id, case_id, bank_assertion_id, finding_id, relationship, explanation, confidence, next_question, created_at, updated_at",
    )
    .eq("case_id", parsedQuery.caseId)
    .order("created_at", { ascending: true })

  if (linksError) {
    return NextResponse.json({ error: "Failed to fetch assertion-finding matrix" }, { status: 500 })
  }

  const assertions = (assertionsData ?? []) as AssertionRow[]
  const findings = (findingsData ?? []) as FindingRow[]
  const links = (linksData ?? []) as LinkRow[]

  const findingById = new Map(findings.map((f) => [f.id, f]))
  const linkedFindingIds = new Set<string>()

  const linksByAssertionId = new Map<string, Array<LinkRow & { finding: FindingRow }>>()
  for (const link of links) {
    const finding = findingById.get(link.finding_id)
    if (!finding) continue
    linkedFindingIds.add(link.finding_id)
    const arr = linksByAssertionId.get(link.bank_assertion_id) ?? []
    arr.push({ ...link, finding })
    linksByAssertionId.set(link.bank_assertion_id, arr)
  }

  const bank_assertions = assertions.map((assertion) => ({
    ...assertion,
    links: linksByAssertionId.get(assertion.id) ?? [],
  }))

  const unlinked_findings = findings.filter((finding) => !linkedFindingIds.has(finding.id))

  return NextResponse.json({
    bank_assertions,
    unlinked_findings,
  })
}
