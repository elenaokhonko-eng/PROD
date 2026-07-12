/**
 * Render background worker for Slice 6.
 *
 * Polls `public.jobs` for `status = 'queued'` rows, locks one with
 * `FOR UPDATE SKIP LOCKED` via the `claim_next_job()` Postgres function,
 * then executes the canonical Tier-1 sequence:
 *
 *   1. Conditional evidence re-run (R14a) — per new case_documents row.
 *   2. Conditional extract re-run (R14b) — if new intake or evidence reran.
 *   3. Always run decision.
 *   4. Always run report.
 *
 * All calls go through the Next.js `/api/edge/*` routes with the shared
 * `WORKER_SECRET` header so the edge proxy bypasses Clerk auth.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const appUrl = process.env.NEXT_PUBLIC_APP_URL
const workerSecret = process.env.WORKER_SECRET

if (!supabaseUrl || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}
if (!appUrl) {
  throw new Error('Missing NEXT_PUBLIC_APP_URL')
}
if (!workerSecret) {
  throw new Error('Missing WORKER_SECRET')
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const MAX_RETRIES = 2 // initial attempt + 2 retries = 3 total
const POLL_INTERVAL_MS = 5_000
const RUN_ONCE = process.env.WORKER_RUN_ONCE === '1'

type JobRow = {
  id: string
  case_id: string
  user_id: string
  status: string
  retry_count: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callEdge(path: string, body: Record<string, unknown>): Promise<void> {
  const url = `${appUrl}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown error')
    throw new Error(`POST ${path} failed (${res.status}): ${text.slice(0, 500)}`)
  }
}

async function getLastDecisionRunAt(caseId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('case_decision_runs')
    .select('created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to read last decision run: ${error.message}`)
  }

  return (data?.created_at as string | null) ?? null
}

async function getNewDocuments(
  caseId: string,
  cutoff: string | null,
): Promise<Array<{ id: string }>> {
  let query = supabase
    .from('case_documents')
    .select('id, upload_date')
    .eq('case_id', caseId)

  if (cutoff) {
    query = query.gt('upload_date', cutoff)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Failed to read case_documents: ${error.message}`)
  }
  return (data ?? []) as Array<{ id: string }>
}

async function hasNewIntake(caseId: string, cutoff: string | null): Promise<boolean> {
  let query = supabase
    .from('case_intake')
    .select('id')
    .eq('case_id', caseId)

  if (cutoff) {
    query = query.gt('created_at', cutoff)
  }

  const { data, error } = await query.limit(1)
  if (error) {
    throw new Error(`Failed to read case_intake: ${error.message}`)
  }
  return (data ?? []).length > 0
}

async function completeJob(jobId: string): Promise<void> {
  const { error } = await supabase
    .from('jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: null,
    })
    .eq('id', jobId)

  if (error) {
    throw new Error(`Failed to mark job completed: ${error.message}`)
  }
}

async function failOrRetryJob(jobId: string, retryCount: number, message: string): Promise<void> {
  const canRetry = retryCount < MAX_RETRIES
  const { error } = await supabase
    .from('jobs')
    .update({
      status: canRetry ? 'queued' : 'failed',
      retry_count: retryCount + 1,
      error: message,
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  if (error) {
    throw new Error(`Failed to update failed job: ${error.message}`)
  }
}

async function runJob(job: JobRow): Promise<void> {
  const { id: jobId, case_id: caseId } = job

  console.log('[worker] running job', { jobId, caseId })

  const cutoff = await getLastDecisionRunAt(caseId)
  const newDocs = await getNewDocuments(caseId, cutoff)
  let evidenceRerun = false

  // R14a: re-run evidence processor for each new document.
  for (const doc of newDocs) {
    console.log('[worker] re-running evidence for document', { documentId: doc.id })
    await callEdge('/api/edge/evidence', { document_id: doc.id })
    evidenceRerun = true
  }

  // R14b: re-run extract if new intake exists OR any evidence was re-processed.
  const newIntake = await hasNewIntake(caseId, cutoff)
  if (newIntake || evidenceRerun) {
    console.log('[worker] re-running extract', { newIntake, evidenceRerun })
    await callEdge('/api/edge/extract', { case_id: caseId })
  }

  // Always run decision, then report.
  console.log('[worker] running decision')
  await callEdge('/api/edge/decision', { case_id: caseId })

  console.log('[worker] running report')
  await callEdge('/api/edge/report', { case_id: caseId })

  await completeJob(jobId)
  console.log('[worker] job completed', { jobId })
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

  try {
    await runJob(job)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[worker] job failed', { jobId: job.id, message })
    await failOrRetryJob(job.id, job.retry_count, message)
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
