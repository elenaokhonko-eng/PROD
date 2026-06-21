import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { assertCaseAccess, CaseAccessDeniedError, CaseNotFoundError } from "@/lib/server/fidrec/assert-case-access"
import { createServiceClient } from "@/lib/supabase/service"
import type { CaseThemeLinkRow, CaseThemeRow, ThemePriority } from "@/lib/types/fidrec"

export const runtime = "nodejs"

const querySchema = z.object({
  caseId: z.string().uuid("caseId must be a valid UUID"),
})

const PRIORITY_ORDER: Record<ThemePriority, number> = {
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
    return NextResponse.json({ error: "Failed to fetch case themes" }, { status: 500 })
  }

  const service = createServiceClient()

  const [themesResult, linksResult] = await Promise.all([
    service
      .from("case_themes")
      .select(
        "id, case_id, theme_type, theme_title, theme_summary, priority, status, raw_model_output, created_at, updated_at",
      )
      .eq("case_id", parsedQuery.caseId)
      .order("created_at", { ascending: true }),
    service
      .from("case_theme_links")
      .select(
        "id, case_id, theme_id, bank_assertion_id, finding_id, assertion_finding_link_id, investigation_question_id, evidence_request_id, link_reason, created_at",
      )
      .eq("case_id", parsedQuery.caseId)
      .order("created_at", { ascending: true }),
  ])

  if (themesResult.error) {
    return NextResponse.json({ error: "Failed to fetch case themes" }, { status: 500 })
  }
  if (linksResult.error) {
    return NextResponse.json({ error: "Failed to fetch case theme links" }, { status: 500 })
  }

  const themes = (themesResult.data ?? []) as CaseThemeRow[]
  const themeLinks = (linksResult.data ?? []) as CaseThemeLinkRow[]

  themes.sort((left, right) => {
    const leftPriority = PRIORITY_ORDER[left.priority] ?? 99
    const rightPriority = PRIORITY_ORDER[right.priority] ?? 99
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    return left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1 : 0
  })

  const linksByThemeId = new Map<string, CaseThemeLinkRow[]>()
  for (const link of themeLinks) {
    const list = linksByThemeId.get(link.theme_id) ?? []
    list.push(link)
    linksByThemeId.set(link.theme_id, list)
  }

  return NextResponse.json({
    themes: themes.map((theme) => ({
      ...theme,
      links: linksByThemeId.get(theme.id) ?? [],
    })),
  })
}
