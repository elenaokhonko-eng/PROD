/**
 * Server-side edge-function proxy — single implementation of the blanket auth
 * boundary described in `docs/Front-to-Back-End-Integration-Summary.md §9.2`.
 *
 * Every `/api/edge/*` route delegates to `proxyEdgeFunction(...)`. This keeps
 * auth (Clerk JWT → Pattern C), edit-permission probe, service-role fanout,
 * and response forwarding in one place.
 *
 * Reference implementation — do NOT duplicate this logic per route.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createUserClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  DECISION_FN,
  EVIDENCE_FN,
  EXTRACT_FN,
  REPORT_FN,
  TIER0_FN,
} from '@/lib/edge-functions'
import {
  signEdgeRequest,
  type EdgeRequestContext,
} from '@/lib/server/edge-request-signing'

export interface ProxyOptions {
  /** Supabase edge-function folder name (see `lib/edge-functions.ts`). */
  fnName: string
  /** The Next.js `Request`. We parse JSON from it; the raw body is not used. */
  request: Request
  /**
   * Which field in the body carries the `case_id` used for the ownership
   * probe. Defaults to `case_id`. For evidence routes where only
   * `document_id` is sent, set this to `null` to opt out and rely on the
   * custom probe below.
   */
  caseIdField?: string | null
  /**
   * Custom authorization probe, used when `case_id` is not directly in the
   * body. It must require edit permission for these mutating edge functions.
   *
   * Must return `{ ok: true }` if the user may proceed, `{ ok: false, status }`
   * otherwise. Runs with the user-scoped client.
   */
  probe?: (
    userClient: Awaited<ReturnType<typeof createUserClient>>,
    body: Record<string, unknown>,
  ) => Promise<{ ok: boolean; status?: number }>
}

type WorkerAuthorization =
  | { ok: true; context: EdgeRequestContext; jobType: string }
  | { ok: false; response: Response }

type WorkerLeaseRow = {
  user_id: string
  job_type: string
  document_id: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function verifyWorkerJob(body: Record<string, unknown>): Promise<WorkerAuthorization> {
  const jobId = body.job_id
  const caseId = body.case_id
  const lockToken = body.job_lock_token
  const documentId = body.document_id
  if (
    typeof jobId !== 'string' ||
    !UUID_PATTERN.test(jobId) ||
    typeof caseId !== 'string' ||
    !UUID_PATTERN.test(caseId) ||
    typeof lockToken !== 'string' ||
    !Number.isFinite(Date.parse(lockToken)) ||
    (documentId !== undefined && (typeof documentId !== 'string' || !UUID_PATTERN.test(documentId)))
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'A valid job, case, document, and lease binding is required' },
        { status: 400 },
      ),
    }
  }

  const canonicalDocumentId = typeof documentId === 'string' ? documentId : null
  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient.rpc('assert_active_worker_lease_v1', {
    p_job_id: jobId,
    p_case_id: caseId,
    p_job_locked_at: lockToken,
    p_document_id: canonicalDocumentId,
    p_allowed_job_types: ['post_payment_report_generation', 'evidence_document_processing'],
  })
  if (error) {
    if (error.code === '42501' || error.message.includes('worker_lease_lost')) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Worker job is not eligible' }, { status: 409 }),
      }
    }
    console.error('[edge-proxy] worker lease assertion failed', { jobId, code: error.code })
    return {
      ok: false,
      response: NextResponse.json({ error: 'Worker authorization unavailable' }, { status: 503 }),
    }
  }

  const job = (Array.isArray(data) ? data[0] : data) as WorkerLeaseRow | null
  if (!job?.user_id || !job.job_type) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Worker job is not eligible' }, { status: 409 }),
    }
  }

  return {
    ok: true,
    jobType: job.job_type,
    context: {
      actorKind: 'worker',
      actorId: job.user_id,
      caseId,
      documentId: canonicalDocumentId ?? undefined,
      jobId,
      jobLockedAt: lockToken,
    },
  }
}

function buildForwardBody(
  fnName: string,
  context: EdgeRequestContext,
): Record<string, unknown> {
  const workerBinding =
    context.actorKind === 'worker'
      ? { job_id: context.jobId, job_lock_token: context.jobLockedAt }
      : {}

  if (fnName === EVIDENCE_FN) {
    return {
      case_id: context.caseId,
      document_id: context.documentId,
      ...workerBinding,
    }
  }
  if (fnName === EXTRACT_FN) {
    return {
      case_id: context.caseId,
      ...(context.documentId ? { document_id: context.documentId } : {}),
      allow_partial_evidence: false,
      ...workerBinding,
    }
  }
  if (fnName === TIER0_FN || fnName === DECISION_FN) {
    return { case_id: context.caseId, ...workerBinding }
  }
  if (fnName === REPORT_FN) {
    return {
      case_id: context.caseId,
      simulation_key: process.env.SIMULATION_KEY,
      ...workerBinding,
    }
  }
  throw new Error(`Unsupported Edge function: ${fnName}`)
}

/**
 * Proxy a request to a privileged Supabase Edge Function. The public anon key
 * is transport-only; an HMAC envelope carries the canonical actor/case/lease.
 */
export async function proxyEdgeFunction({
  fnName,
  request,
  caseIdField = 'case_id',
  probe,
}: ProxyOptions): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || Array.isArray(body)) {
    return NextResponse.json({ error: 'JSON body must be an object' }, { status: 400 })
  }

  const workerSecret = request.headers.get('x-worker-secret')
  const isWorkerRequest =
    typeof workerSecret === 'string' &&
    workerSecret.length > 0 &&
    workerSecret === process.env.WORKER_SECRET
  let context: EdgeRequestContext
  let workerJobType: string | null = null

  if (isWorkerRequest) {
    if (fnName === TIER0_FN) {
      return NextResponse.json({ error: 'Workers cannot invoke Tier 0' }, { status: 403 })
    }
    const workerAuthorization = await verifyWorkerJob(body)
    if (workerAuthorization.ok === false) return workerAuthorization.response
    context = workerAuthorization.context
    workerJobType = workerAuthorization.jobType
    if (
      (workerJobType === 'evidence_document_processing' && fnName !== EVIDENCE_FN) ||
      (workerJobType === 'post_payment_report_generation' && fnName === EVIDENCE_FN)
    ) {
      return NextResponse.json(
        { error: 'Worker function does not match the claimed job type' },
        { status: 403 },
      )
    }
  } else {
    if ([EVIDENCE_FN, DECISION_FN, REPORT_FN].includes(fnName)) {
      return NextResponse.json({ error: 'This function is worker-only' }, { status: 403 })
    }

    const { userId, getToken } = await auth()
    const userSupabaseJwt = userId ? await getToken({ template: 'supabase' }) : null
    if (!userId || !userSupabaseJwt) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const caseId = caseIdField ? body[caseIdField] : null
    if (typeof caseId !== 'string' || caseId.length === 0) {
      return NextResponse.json({ error: `${caseIdField ?? 'case_id'} is required` }, { status: 400 })
    }
    const userClient = await createUserClient()
    if (probe) {
      const probeResult = await probe(userClient, body)
      if (!probeResult.ok) {
        return NextResponse.json(
          { error: probeResult.status === 404 ? 'Not found' : 'Forbidden' },
          { status: probeResult.status ?? 404 },
        )
      }
    } else {
      const { data: canEdit, error: permissionError } = await userClient.rpc(
        'app_case_permission',
        { p_case_id: caseId, p_permission: 'edit' },
      )
      if (permissionError || canEdit !== true) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    }
    const { data: actorId, error: actorError } = await userClient.rpc('current_app_user_id')
    if (actorError || typeof actorId !== 'string' || actorId.length === 0) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    context = { actorKind: 'user', actorId, caseId }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: 'Edge proxy is not configured (missing Supabase URL or anon key)' },
      { status: 500 },
    )
  }

  let forwardBody: Record<string, unknown>
  let signedHeaders: Record<string, string>
  try {
    forwardBody = buildForwardBody(fnName, context)
    const bodyText = JSON.stringify(forwardBody)
    signedHeaders = signEdgeRequest(fnName, bodyText, context)
    const edgeRes = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        ...signedHeaders,
      },
      body: bodyText,
    })

    const text = await edgeRes.text()
    let data: unknown
    try {
      data = text.length > 0 ? JSON.parse(text) : null
    } catch {
      data = { ok: false, error: text.slice(0, 500) }
    }
    return NextResponse.json(data, { status: edgeRes.status })
  } catch (error) {
    console.error('[edge-proxy] signed fanout failed', {
      fnName,
      workerJobType,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Edge invocation unavailable' }, { status: 503 })
  }
}
