import { NextResponse } from 'next/server'
import { TIER0_FN } from '@/lib/edge-functions'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'
import { factsCaseAccess } from '@/lib/server/facts/case-access'
import { loadCurrentSnapshot } from '@/lib/server/facts/facts-service'
import { FactsInProgressError, FactsUnavailableError } from '@/lib/server/facts/run-reconcile'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// The free evaluation is generated only from the latest confirmed "free" snapshot, and only while it still matches
// the current facts: no generation with open findings (design C3). The Edge Function checks the snapshot again.
export async function POST(request: Request) {
  const body = (await request.clone().json().catch(() => null)) as { case_id?: unknown; fact_snapshot_id?: unknown } | null
  const caseId = typeof body?.case_id === 'string' ? body.case_id : null
  const snapshotId = typeof body?.fact_snapshot_id === 'string' ? body.fact_snapshot_id : null
  if (!caseId) return NextResponse.json({ error: 'case_id is required' }, { status: 400 })

  const access = await factsCaseAccess(caseId)
  if (access instanceof NextResponse) return access
  if (!access.isOwner) return NextResponse.json({ error: 'Only the case owner can generate the evaluation' }, { status: 403 })

  if (!snapshotId) {
    return NextResponse.json({ error: 'Confirm your facts first', reason: 'facts_unconfirmed' }, { status: 409 })
  }
  try {
    const snapshot = await loadCurrentSnapshot(createServiceClient(), caseId, 'free', snapshotId)
    if (!snapshot) {
      return NextResponse.json({ error: 'Your facts changed; please confirm them again', reason: 'facts_unconfirmed' }, { status: 409 })
    }
  } catch (error) {
    if (error instanceof FactsInProgressError) {
      return NextResponse.json({ error: 'Your facts are still being checked', reason: 'facts_in_progress' }, { status: 409 })
    }
    if (error instanceof FactsUnavailableError) {
      return NextResponse.json({ error: 'Facts are not available right now', reason: 'facts_unavailable' }, { status: 503 })
    }
    throw error
  }

  return proxyEdgeFunction({
    fnName: TIER0_FN,
    request,
  })
}
