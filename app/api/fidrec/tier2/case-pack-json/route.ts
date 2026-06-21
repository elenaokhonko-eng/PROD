import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { assertCaseAccess, CaseAccessDeniedError, CaseNotFoundError } from "@/lib/server/fidrec/assert-case-access"
import { generateCasePackJson } from "@/lib/server/fidrec/generate-case-pack-json"

export const runtime = "nodejs"

const querySchema = z.object({
  caseId: z.string().uuid("caseId must be a valid UUID"),
})

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
    return NextResponse.json({ error: "Failed to fetch case pack JSON" }, { status: 500 })
  }

  try {
    const casePack = await generateCasePackJson({ caseId: parsedQuery.caseId })
    return NextResponse.json({ submission_pack: casePack.submission_pack })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate case pack JSON"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
