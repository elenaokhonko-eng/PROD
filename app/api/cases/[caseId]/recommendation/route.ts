import { NextResponse } from "next/server"

import { factsCaseAccess } from "@/lib/server/facts/case-access"
import { loadRecommendation } from "@/lib/server/facts/recommendation"
import { FactsUnavailableError } from "@/lib/server/facts/run-reconcile"
import { createServiceClient } from "@/lib/supabase/service"

export const dynamic = "force-dynamic"

// The recommended next step after the free evaluation, from the confirmed facts.
export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  const access = await factsCaseAccess(caseId)
  if (access instanceof NextResponse) return access

  try {
    const view = await loadRecommendation(createServiceClient(), caseId)
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof FactsUnavailableError) {
      return NextResponse.json({ error: "Not available right now", reason: "facts_unavailable" }, { status: 503 })
    }
    throw error
  }
}
