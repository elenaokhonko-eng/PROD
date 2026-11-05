import { NextResponse } from "next/server"

import { factsCaseAccess } from "@/lib/server/facts/case-access"
import { createSnapshot, parseStage } from "@/lib/server/facts/facts-service"
import { FactsInProgressError, FactsUnavailableError } from "@/lib/server/facts/run-reconcile"
import { createServiceClient } from "@/lib/supabase/service"

export const dynamic = "force-dynamic"
export const maxDuration = 120

// Freezes the confirmed facts for a stage. Refused while any finding the stage needs is open (facts_unconfirmed)
// or a document is still processing.
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  const body = (await request.json().catch(() => null)) as { stage?: unknown } | null
  const stage = parseStage(body?.stage)
  if (!stage) return NextResponse.json({ error: "stage must be free, bank or fidrec" }, { status: 400 })

  const access = await factsCaseAccess(caseId)
  if (access instanceof NextResponse) return access
  if (!access.isOwner) return NextResponse.json({ error: "Only the case owner can confirm facts" }, { status: 403 })

  try {
    const outcome = await createSnapshot(createServiceClient(), caseId, stage, access.profileId)
    if (!outcome.ok) {
      return NextResponse.json({ error: "Facts need confirming first", ...outcome }, { status: 409 })
    }
    return NextResponse.json(outcome)
  } catch (error) {
    if (error instanceof FactsInProgressError) {
      return NextResponse.json({ error: "Your facts are still being checked", reason: "facts_in_progress" }, { status: 409 })
    }
    if (error instanceof FactsUnavailableError) {
      return NextResponse.json({ error: "Facts are not available right now", reason: "facts_unavailable" }, { status: 503 })
    }
    throw error
  }
}
