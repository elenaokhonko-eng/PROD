import { NextResponse } from "next/server"

import { factsCaseAccess } from "@/lib/server/facts/case-access"
import { ResolutionRejectedError, resolveFinding, type ResolutionInput } from "@/lib/server/facts/facts-service"
import { FactsUnavailableError } from "@/lib/server/facts/run-reconcile"
import { createServiceClient } from "@/lib/supabase/service"

export const dynamic = "force-dynamic"

const KINDS = new Set(["choice", "value", "not_sure", "not_known", "acknowledged"])

// The owner resolves one finding: choose a value, enter the correct value, "not sure", "not known", or keep an
// unsupported claim. Every resolution is audited.
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; findingId: string }> }) {
  const { caseId, findingId } = await params
  const access = await factsCaseAccess(caseId)
  if (access instanceof NextResponse) return access
  if (!access.isOwner) return NextResponse.json({ error: "Only the case owner can confirm facts" }, { status: 403 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.kind !== "string" || !KINDS.has(body.kind)) {
    return NextResponse.json({ error: "Invalid resolution" }, { status: 400 })
  }

  try {
    await resolveFinding(createServiceClient(), caseId, findingId, body as unknown as ResolutionInput, access.profileId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ResolutionRejectedError) {
      const status = error.reason === "finding_not_found" ? 404 : error.reason === "finding_outdated" ? 409 : 400
      return NextResponse.json({ error: "Resolution not accepted", reason: error.reason }, { status })
    }
    if (error instanceof FactsUnavailableError) {
      return NextResponse.json({ error: "Facts are not available right now", reason: "facts_unavailable" }, { status: 503 })
    }
    throw error
  }
}
