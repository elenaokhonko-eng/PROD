import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { assertCaseAccess, CaseAccessDeniedError, CaseNotFoundError } from "@/lib/server/fidrec/assert-case-access"
import { assertTier2Eligible, Tier2NotEnabledError } from "@/lib/server/fidrec/assert-tier2-eligible"
import { linkAssertionsAndFindings } from "@/lib/server/fidrec/link-assertions-findings"

export const runtime = "nodejs"

const requestSchema = z.object({
  caseId: z.string().uuid("caseId must be a valid UUID"),
})

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let parsedBody: z.infer<typeof requestSchema>
  try {
    parsedBody = requestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  try {
    await assertCaseAccess({ caseId: parsedBody.caseId, userSupabaseUuid: user.supabaseUuid })
  } catch (error) {
    if (error instanceof CaseNotFoundError) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 })
    }
    if (error instanceof CaseAccessDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.json({ error: "Failed to link assertions and findings" }, { status: 500 })
  }

  try {
    await assertTier2Eligible(parsedBody.caseId)
  } catch (error) {
    if (error instanceof Tier2NotEnabledError) {
      return NextResponse.json({ error: "Tier 2 is not enabled for this case." }, { status: 403 })
    }
    return NextResponse.json({ error: "Failed to link assertions and findings" }, { status: 500 })
  }

  try {
    const result = await linkAssertionsAndFindings({ caseId: parsedBody.caseId })
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: "Failed to link assertions and findings" }, { status: 500 })
  }
}
