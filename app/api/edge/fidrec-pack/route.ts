import { NextResponse } from 'next/server'
import { FIDREC_PACK_FN } from '@/lib/edge-functions'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'
import { evidenceMissingResponse, loadPackEvidence, PackEvidenceUnavailableError } from '@/lib/server/billing/pack-evidence'
import { factsCaseAccess } from '@/lib/server/facts/case-access'
import { loadCurrentSnapshot } from '@/lib/server/facts/facts-service'
import { FactsInProgressError, FactsUnavailableError } from '@/lib/server/facts/run-reconcile'
import { createServiceClient } from '@/lib/supabase/service'
import { HOURLY_LIMIT_MESSAGE, limitResponse, overIpModelLimit } from '@/lib/server/usage-limits'

export const dynamic = 'force-dynamic'
export const maxDuration = 150

// The FIDReC pack (S$188) is generated once it is paid for, and only from the latest confirmed "fidrec" snapshot while
// it still matches the current facts (stage2-plan §3a: pay first, then confirm). The Edge Function checks the payment,
// the snapshot and the route to FIDReC (decision 7) again, and returns the stored pack on a repeat request. Paid packs
// are exempt from the daily evaluation limit (Elena, 13 Nov); the per-IP hourly limit still applies.
export async function POST(request: Request) {
  const body = (await request.clone().json().catch(() => null)) as { case_id?: unknown; fact_snapshot_id?: unknown } | null
  const caseId = typeof body?.case_id === 'string' ? body.case_id : null
  const snapshotId = typeof body?.fact_snapshot_id === 'string' ? body.fact_snapshot_id : null
  if (!caseId) return NextResponse.json({ error: 'case_id is required' }, { status: 400 })

  const access = await factsCaseAccess(caseId)
  if (access instanceof NextResponse) return access
  if (!access.isOwner) return NextResponse.json({ error: 'Only the case owner can generate the FIDReC pack' }, { status: 403 })

  const service = createServiceClient()
  const { data: entitlement, error: entitlementError } = await service.rpc('get_effective_entitlement', { p_case_id: caseId })
  if (entitlementError) return NextResponse.json({ error: 'Purchase status is not available right now' }, { status: 503 })
  if ((entitlement as { features?: Record<string, unknown> } | null)?.features?.allow_escalation_pack !== true) {
    return NextResponse.json({ error: 'The FIDReC pack has not been bought for this case', reason: 'not_purchased' }, { status: 403 })
  }

  if (!snapshotId) {
    return NextResponse.json({ error: 'Confirm your facts first', reason: 'facts_unconfirmed' }, { status: 409 })
  }
  try {
    const snapshot = await loadCurrentSnapshot(service, caseId, 'fidrec', snapshotId)
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

  // Evidence minimums (Elena, 23 Nov 2026): paid for, but generated only once the documents it needs are in.
  try {
    const missing = evidenceMissingResponse(await loadPackEvidence(service, caseId, 'fidrec'))
    if (missing) return missing
  } catch (error) {
    if (error instanceof PackEvidenceUnavailableError) {
      return NextResponse.json({ error: error.message, reason: 'documents_unavailable' }, { status: 503 })
    }
    throw error
  }

  if (overIpModelLimit(request)) return limitResponse(HOURLY_LIMIT_MESSAGE)

  return proxyEdgeFunction({
    fnName: FIDREC_PACK_FN,
    request,
  })
}
