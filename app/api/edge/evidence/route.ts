/**
 * Evidence route — body carries `document_id` so we probe ownership by joining
 * `case_documents` to the RLS-protected `cases` table via `case_id`.
 *
 * IS §8.2 decision D (auto-re-fire extract): on `ok: true`, additionally fire
 * `run_case_extract_v4` for the owning `case_id`. The server route does this
 * so the frontend doesn't need a second round-trip; the `case_extract_runs`
 * row will surface via the next read / Realtime push. (SM R11.)
 *
 * We do the auto-fire AFTER returning to the caller would be ideal, but
 * Next.js route handlers don't support post-response work without
 * `after()` from Next 15+. To stay forward-compatible and simple, we fire
 * the extract in parallel with the response stream: await the evidence call,
 * kick off extract with `fetch` + `void`, then return the evidence result.
 * Any extract failure is logged but not surfaced — the next single-shot read
 * or Realtime push will catch up.
 */

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { EVIDENCE_FN, EXTRACT_FN } from '@/lib/edge-functions'
import { createUserClient } from '@/lib/supabase/server'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // Clone the request so we can read the body here AND let proxyEdgeFunction
  // read it again (Request bodies are single-use).
  const clone = request.clone()
  const body = (await clone.json().catch(() => null)) as
    | { document_id?: string }
    | null
  if (!body?.document_id || typeof body.document_id !== 'string') {
    return NextResponse.json(
      { error: 'document_id is required' },
      { status: 400 },
    )
  }

  const workerSecret = request.headers.get('x-worker-secret')
  const isWorkerRequest =
    typeof workerSecret === 'string' &&
    workerSecret.length > 0 &&
    workerSecret === process.env.WORKER_SECRET

  if (isWorkerRequest) {
    return proxyEdgeFunction({
      fnName: EVIDENCE_FN,
      request,
      caseIdField: null,
      probe: async () => ({ ok: true }),
    })
  }

  // We need to know case_id for the post-success extract re-fire, but the
  // body only has document_id. Read it up-front via the user-scoped client
  // so RLS enforces ownership.
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userClient = await createUserClient()
  const { data: doc, error } = await userClient
    .from('case_documents')
    .select('id, case_id')
    .eq('id', body.document_id)
    .maybeSingle()

  if (error || !doc || !doc.case_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const caseId = doc.case_id as string

  // Run the proxy with a custom probe that short-circuits — ownership was
  // just verified above, don't waste another round-trip.
  const res = await proxyEdgeFunction({
    fnName: EVIDENCE_FN,
    request,
    caseIdField: null,
    probe: async () => ({ ok: true }),
  })

  // If the evidence call succeeded, auto-fire extract for the owning case.
  // Fire-and-forget: do not await. Log any failure server-side.
  if (res.ok) {
    void fireExtract(caseId).catch((err) => {
      console.error(
        '[edge/evidence] auto-re-fire of run_case_extract_v4 failed',
        err,
      )
    })
  }

  return res
}

async function fireExtract(caseId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return

  await fetch(`${supabaseUrl}/functions/v1/${EXTRACT_FN}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ case_id: caseId }),
  })
}
