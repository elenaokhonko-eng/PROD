/**
 * Render background worker for Slice 6.
 *
 * Polls `public.jobs` for `status = 'queued'` rows, locks one with
 * `FOR UPDATE SKIP LOCKED` via the `claim_next_job()` Postgres function,
 * then executes one fenced durable stage:
 *
 *   - Evidence jobs process exactly their bound document.
 *   - Report jobs run extract, decision, and report only after evidence settles.
 *
 * All calls go through the Next.js `/api/edge/*` routes with the shared
 * `WORKER_SECRET` header so the edge proxy bypasses Clerk auth.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const appUrl = process.env.NEXT_PUBLIC_APP_URL
const workerSecret = process.env.WORKER_SECRET
const edgeProxyHmacSecret = process.env.EDGE_PROXY_HMAC_SECRET
const deploymentCommitSha = (process.env.RELEASE_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? '').trim()

if (!supabaseUrl || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}
if (!appUrl) {
  throw new Error('Missing NEXT_PUBLIC_APP_URL')
}
if (!workerSecret) {
  throw new Error('Missing WORKER_SECRET')
}
if (!edgeProxyHmacSecret || Buffer.byteLength(edgeProxyHmacSecret, 'utf8') < 32) {
  throw new Error('EDGE_PROXY_HMAC_SECRET must contain at least 32 bytes')
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const MAX_RETRIES = 2 // initial attempt + 2 retries = 3 total
const POLL_INTERVAL_MS = 5_000
const JOB_HEARTBEAT_INTERVAL_MS = 60_000
const EDGE_CALL_TIMEOUT_MS = 2 * 60_000
const JOB_DEADLINE_MS = 10 * 60_000
const RUN_ONCE = process.env.WORKER_RUN_ONCE === '1'
const EXPLICIT_LEASE_DENIAL_MESSAGES = [
  'worker_lease_lost',
  'worker job is not eligible',
  'edge_worker_lease_denied',
  'lease was lost',
  'lease denied',
]

type JobRow = {
  id: string
  case_id: string
  user_id: string
  document_id: string | null
  job_type: string
  status: string
  retry_count: number
  locked_at: string
  payload: Record<string, unknown>
}

class NonRetryableJobError extends Error {}
class LeaseLostError extends NonRetryableJobError {}
class LeaseRecoveryRequiredError extends Error {}
class JobDeadlineExceededError extends LeaseRecoveryRequiredError {}
class EdgeCallTimeoutError extends LeaseRecoveryRequiredError {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isExplicitLeaseDenialError(rawError: string | null | undefined): boolean {
  if (!rawError) return false
  const normalized = rawError.toLowerCase()
  return EXPLICIT_LEASE_DENIAL_MESSAGES.some((marker) => normalized.includes(marker))
}

function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  abortError: () => Error,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let onAbort: () => void
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    onAbort = () => finish(() => reject(abortError()))

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

async function callEdge(
  path: string,
  body: Record<string, unknown>,
  jobSignal: AbortSignal,
): Promise<void> {
  const url = `${appUrl}${path}`
  const requestAbortController = new AbortController()
  let abortError: Error | null = null

  const abortRequest = (error: Error) => {
    if (requestAbortController.signal.aborted) return
    abortError = error
    requestAbortController.abort()
  }
  const onJobAbort = () => abortRequest(new Error(`Job cancelled before POST ${path} completed`))
  const timeout = setTimeout(
    () => abortRequest(new EdgeCallTimeoutError(`POST ${path} exceeded the ${EDGE_CALL_TIMEOUT_MS}ms deadline`)),
    EDGE_CALL_TIMEOUT_MS,
  )

  if (jobSignal.aborted) {
    onJobAbort()
  } else {
    jobSignal.addEventListener('abort', onJobAbort, { once: true })
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': workerSecret,
      },
      body: JSON.stringify(body),
      signal: requestAbortController.signal,
    })

    if (!res.ok) {
      const rawBody = await res.text().catch(() => 'unknown error')
      let parsedError: string | null = null
      try {
        const parsed = JSON.parse(rawBody) as { error?: unknown }
        if (typeof parsed?.error === 'string' && parsed.error.length > 0) {
          parsedError = parsed.error
        }
      } catch {
        // raw text is not JSON; keep the response body for logging below.
      }
      const message = `POST ${path} failed (${res.status}): ${rawBody.slice(0, 500)}`
      const documentsNotReady =
        res.status === 409 &&
        (rawBody.toLowerCase().includes('documents_not_ready') ||
          (parsedError ?? '').toLowerCase().includes('documents_not_ready'))
      const explicitLeaseDenial =
        res.status === 409 &&
        (isExplicitLeaseDenialError(parsedError) ||
          isExplicitLeaseDenialError(rawBody) ||
          isExplicitLeaseDenialError(message))
      if (explicitLeaseDenial) throw new LeaseLostError(message)
      if (documentsNotReady) throw new Error(message)
      throw new Error(message)
    }
  } catch (error) {
    if (abortError) throw abortError
    throw error
  } finally {
    clearTimeout(timeout)
    jobSignal.removeEventListener('abort', onJobAbort)
  }
}

async function assertJobStillAuthorized(job: JobRow): Promise<void> {
  const { data, error } = await supabase.rpc('assert_active_worker_lease_v1', {
    p_job_id: job.id,
    p_case_id: job.case_id,
    p_job_locked_at: job.locked_at,
    p_document_id: job.document_id,
    p_allowed_job_types: ['post_payment_report_generation', 'evidence_document_processing'],
  })
  if (error) {
    if (error.code === '42501' || error.message.includes('worker_lease_lost')) {
      throw new LeaseLostError('Job lease was lost before execution')
    }
    throw new Error(`Authorization re-check failed: ${error.message}`)
  }

  const lease = (Array.isArray(data) ? data[0] : data) as JobRow | null
  if (!lease || lease.job_type !== job.job_type || lease.user_id !== job.user_id) {
    throw new LeaseLostError('Claimed job binding changed before execution')
  }
  if (job.job_type === 'evidence_document_processing') return
  if (job.job_type !== 'post_payment_report_generation') {
    throw new NonRetryableJobError(`Unsupported job type: ${job.job_type}`)
  }

  const { data: entitlement, error: entitlementError } = await supabase
    .from('case_entitlements')
    .select('plan, features')
    .eq('case_id', job.case_id)
    .maybeSingle()
  if (entitlementError) {
    throw new Error(`Report capability re-check failed: ${entitlementError.message}`)
  }

  const features = (entitlement?.features ?? {}) as Record<string, unknown>
  const hasReportCapability =
    entitlement?.plan === 'self_serve_report' ||
    entitlement?.plan === 'escalation_pack' ||
    features.allow_self_serve_report === true
  if (!hasReportCapability) {
    throw new NonRetryableJobError('Report job no longer has report capability')
  }
}

async function heartbeatJob(job: JobRow): Promise<void> {
  const { data, error } = await supabase.rpc('heartbeat_worker_job_v1', {
    p_job_id: job.id,
    p_case_id: job.case_id,
    p_job_locked_at: job.locked_at,
    p_document_id: job.document_id,
  })

  if (error) {
    if (error.code === '42501' || error.message.includes('worker_lease_lost')) {
      throw new LeaseLostError('Job lease was lost during heartbeat')
    }
    throw new Error(`Failed to heartbeat job lease: ${error.message}`)
  }
  if (!data) throw new LeaseLostError('Job lease was lost during heartbeat')
}

type JobHeartbeat = {
  stop: () => Promise<Error | null>
}

type JobDeadline = {
  stop: () => void
}

function startJobHeartbeat(
  job: JobRow,
  abortJob: (error: Error) => void,
): JobHeartbeat {
  let failure: Error | null = null
  let inFlight: Promise<void> | null = null

  const timer = setInterval(() => {
    if (inFlight || failure) return
    inFlight = heartbeatJob(job)
      .catch((error) => {
        const heartbeatError = error instanceof Error ? error : new Error(String(error))
        failure =
          heartbeatError instanceof NonRetryableJobError
            ? heartbeatError
            : new LeaseRecoveryRequiredError(
                `Job heartbeat became uncertain: ${heartbeatError.message}`,
              )
        console.error('[worker] job heartbeat failed', {
          jobId: job.id,
          error: failure.message,
        })
        abortJob(failure)
      })
      .finally(() => {
        inFlight = null
      })
  }, JOB_HEARTBEAT_INTERVAL_MS)

  return {
    stop: async () => {
      clearInterval(timer)
      if (inFlight) await inFlight
      return failure
    },
  }
}

function startJobDeadline(
  job: JobRow,
  abortJob: (error: Error) => void,
): JobDeadline {
  const timer = setTimeout(() => {
    abortJob(
      new JobDeadlineExceededError(
        `Job ${job.id} exceeded the ${JOB_DEADLINE_MS}ms deadline before its 15-minute lease reclaim window`,
      ),
    )
  }, JOB_DEADLINE_MS)

  return { stop: () => clearTimeout(timer) }
}

async function completeJob(job: JobRow): Promise<void> {
  const completedAt = new Date().toISOString()
  const { data, error } = await supabase.rpc('settle_worker_job_v1', {
    p_job_id: job.id,
    p_case_id: job.case_id,
    p_job_locked_at: job.locked_at,
    p_document_id: job.document_id,
    p_outcome: 'completed',
    p_error: null,
    p_retryable: false,
    p_payload_patch: {
      worker_commit_sha: deploymentCommitSha || null,
      worker_completed_at: completedAt,
    },
  })

  if (error) {
    if (error.code === '42501' || error.message.includes('worker_lease_lost')) {
      throw new LeaseLostError('Job lease was lost before completion')
    }
    throw new Error(`Failed to mark job completed: ${error.message}`)
  }
  if (!data) throw new LeaseLostError('Job lease was lost before completion')
}

async function failOrRetryJob(
  job: JobRow,
  message: string,
  retryable: boolean,
): Promise<void> {
  const { data, error } = await supabase.rpc('settle_worker_job_v1', {
    p_job_id: job.id,
    p_case_id: job.case_id,
    p_job_locked_at: job.locked_at,
    p_document_id: job.document_id,
    p_outcome: 'failed',
    p_error: message,
    p_retryable: retryable && job.retry_count < MAX_RETRIES,
    p_payload_patch: {},
  })

  if (error) {
    if (error.code === '42501' || error.message.includes('worker_lease_lost')) {
      throw new LeaseLostError('Job lease was lost before failure handling')
    }
    throw new Error(`Failed to update failed job: ${error.message}`)
  }
  if (!data) throw new LeaseLostError('Job lease was lost before failure handling')
}

async function deferForLeaseRecovery(job: JobRow, message: string): Promise<void> {
  const { data, error } = await supabase.rpc('defer_worker_job_v1', {
    p_job_id: job.id,
    p_case_id: job.case_id,
    p_job_locked_at: job.locked_at,
    p_document_id: job.document_id,
    p_error: message,
  })

  if (error) {
    if (error.code === '42501' || error.message.includes('worker_lease_lost')) {
      throw new LeaseLostError('Job lease was lost before deferred recovery handling')
    }
    throw new Error(`Failed to defer timed-out job recovery: ${error.message}`)
  }
  if (!data) throw new LeaseLostError('Job lease was lost before deferred recovery handling')
}

async function runJob(job: JobRow, signal: AbortSignal): Promise<void> {
  const { id: jobId, case_id: caseId } = job
  const workerBinding = {
    case_id: caseId,
    job_id: jobId,
    job_lock_token: job.locked_at,
  }

  console.log('[worker] running job', { jobId, caseId, jobType: job.job_type })
  await assertJobStillAuthorized(job)

  if (job.job_type === 'evidence_document_processing') {
    const documentId = job.document_id
    if (!documentId) {
      throw new NonRetryableJobError('Evidence job is missing document_id')
    }
    console.log('[worker] processing durable evidence job', { jobId, documentId })
    await callEdge(
      '/api/edge/evidence',
      { document_id: documentId, ...workerBinding },
      signal,
    )
    return
  }

  console.log('[worker] running extract after evidence jobs settled')
  await callEdge('/api/edge/extract', workerBinding, signal)

  console.log('[worker] running decision')
  await callEdge('/api/edge/decision', workerBinding, signal)

  console.log('[worker] running report')
  await callEdge('/api/edge/report', workerBinding, signal)
}
async function processOneJob(): Promise<'none' | 'completed' | 'failed'> {
  const { data, error } = await supabase.rpc('claim_next_job')
  if (error) {
    throw new Error(`claim_next_job failed: ${error.message}`)
  }

  const job = data as JobRow | null
  if (!job?.id || !job.case_id || !job.user_id) {
    return 'none'
  }

  const jobAbortController = new AbortController()
  let jobAbortError: Error | null = null
  const abortJob = (error: Error) => {
    if (jobAbortError) return
    jobAbortError = error
    jobAbortController.abort()
  }
  const abortError = () => jobAbortError ?? new Error('Job execution was cancelled')
  const heartbeat = startJobHeartbeat(job, abortJob)
  const deadline = startJobDeadline(job, abortJob)

  try {
    await abortable(runJob(job, jobAbortController.signal), jobAbortController.signal, abortError)
    const heartbeatFailure = await heartbeat.stop()
    if (heartbeatFailure) throw heartbeatFailure
    await abortable(completeJob(job), jobAbortController.signal, abortError)
    deadline.stop()
    console.log('[worker] job completed', { jobId: job.id })
  } catch (err) {
    deadline.stop()
    const heartbeatFailure = await heartbeat.stop()
    const failure = heartbeatFailure ?? jobAbortError ?? err
    const message = failure instanceof Error ? failure.message : String(failure)
    console.error('[worker] job failed', { jobId: job.id, message })
    if (failure instanceof LeaseLostError) {
      return 'failed'
    }
    if (failure instanceof LeaseRecoveryRequiredError) {
      await deferForLeaseRecovery(job, message)
    } else {
      await failOrRetryJob(job, message, !(failure instanceof NonRetryableJobError))
    }
    return 'failed'
  }

  return 'completed'
}

async function main() {
  console.log('[worker] starting', { appUrl, runOnce: RUN_ONCE })

  if (RUN_ONCE) {
    try {
      const result = await processOneJob()
      if (result === 'none') {
        console.log('[worker] run-once mode: no queued job found')
      } else if (result === 'completed') {
        console.log('[worker] run-once mode: finished one job')
      } else {
        console.error('[worker] run-once mode: job failed')
        process.exitCode = 1
      }
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[worker] run-once mode failed', message)
      process.exitCode = 1
      return
    }
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await processOneJob()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[worker] unexpected error', message)
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

main().catch((err) => {
  console.error('[worker] fatal error', err)
  process.exit(1)
})
