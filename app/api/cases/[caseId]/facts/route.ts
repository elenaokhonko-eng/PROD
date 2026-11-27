import { NextResponse } from "next/server"

import { factsCaseAccess } from "@/lib/server/facts/case-access"
import { loadFactsView, parseStage } from "@/lib/server/facts/facts-service"
import { FactsInProgressError, FactsPausedError, FactsTimedOutError, FactsUnavailableError } from "@/lib/server/facts/run-reconcile"
import { recordFault } from "@/lib/server/fault-log"
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
    if (error instanceof FactsPausedError) {
      await recordFault(createServiceClient(), "cap", caseId)
      return NextResponse.json({ error: "Checking is paused until tomorrow", reason: "daily_limit" }, { status: 503 })
    }
    if (error instanceof FactsTimedOutError) {
      await recordFault(createServiceClient(), "timed_out", caseId)
      return NextResponse.json({ error: "Reading did not finish in time", reason: "reading_timed_out" }, { status: 503 })
    }
    if (error instanceof FactsUnavailableError) {
      await recordFault(createServiceClient(), "service_failed", caseId)
      return NextResponse.json({ error: "Facts are not available right now", reason: "facts_unavailable" }, { status: 503 })
    }
    throw error
  }
}
