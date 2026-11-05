import { NextResponse } from "next/server"

import { factsCaseAccess } from "@/lib/server/facts/case-access"
import { loadFactsView, parseStage } from "@/lib/server/facts/facts-service"
import { FactsInProgressError, FactsUnavailableError } from "@/lib/server/facts/run-reconcile"
import { createServiceClient } from "@/lib/supabase/service"

export const dynamic = "force-dynamic"
export const maxDuration = 120

// Findings for the confirm-your-facts screen. Reconciles first if the story, answers or documents changed.
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  const stage = parseStage(new URL(request.url).searchParams.get("stage"))
  if (!stage) return NextResponse.json({ error: "stage must be free, bank or fidrec" }, { status: 400 })

  const access = await factsCaseAccess(caseId)
  if (access instanceof NextResponse) return access

  try {
    const view = await loadFactsView(createServiceClient(), caseId, stage)
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof FactsInProgressError) {
      return NextResponse.json({ reason: "facts_in_progress" }, { status: 202, headers: { "Cache-Control": "no-store" } })
    }
    if (error instanceof FactsUnavailableError) {
      return NextResponse.json({ error: "Facts are not available right now", reason: "facts_unavailable" }, { status: 503 })
    }
    throw error
  }
}
