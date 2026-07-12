import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { assertCaseAccess, CaseAccessDeniedError, CaseNotFoundError } from "@/lib/server/fidrec/assert-case-access"
import { assertTier2Eligible, Tier2NotEnabledError } from "@/lib/server/fidrec/assert-tier2-eligible"
import { buildCasePackMarkdown } from "@/lib/server/fidrec/build-case-pack-markdown"
import { buildCasePackPdf } from "@/lib/server/fidrec/build-case-pack-pdf"
import { generateCasePackJson } from "@/lib/server/fidrec/generate-case-pack-json"

export const runtime = "nodejs"

const querySchema = z.object({
  caseId: z.string().uuid("caseId must be a valid UUID"),
  format: z.enum(["pdf", "md"]),
})

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const caseIdRaw = url.searchParams.get("caseId")
  const formatRaw = url.searchParams.get("format")

  let parsedQuery: z.infer<typeof querySchema>
  try {
    parsedQuery = querySchema.parse({ caseId: caseIdRaw, format: formatRaw })
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
    return NextResponse.json({ error: "Failed to verify case access" }, { status: 500 })
  }

  try {
    await assertTier2Eligible(parsedQuery.caseId)
  } catch (error) {
    if (error instanceof Tier2NotEnabledError) {
      return NextResponse.json({ error: "Tier 2 pack not enabled for this case" }, { status: 403 })
    }
    return NextResponse.json({ error: "Failed to verify Tier 2 eligibility" }, { status: 500 })
  }

  try {
    const casePack = await generateCasePackJson({ caseId: parsedQuery.caseId })
    const pack = casePack.submission_pack
    const filenameBase = `fidrec-case-pack-${parsedQuery.caseId}`

    if (parsedQuery.format === "md") {
      const markdown = buildCasePackMarkdown(pack)
      return new NextResponse(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filenameBase}.md"`,
        },
      })
    }

    const pdfBytes = await buildCasePackPdf(pack)
    return new NextResponse(Buffer.from(pdfBytes) as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filenameBase}.pdf"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate case pack export"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
