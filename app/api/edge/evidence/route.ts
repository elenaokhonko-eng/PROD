/**
 * Evidence route — body carries `document_id` so we probe ownership by joining
 * `case_documents` to the RLS-protected `cases` table via `case_id`.
 *
 * Auto-re-fire extract only when ALL case documents are settled (ready with
 * extraction content, or failed). 409 documents_not_ready is expected pending.
 */

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { EVIDENCE_FN } from '@/lib/edge-functions'
import { createUserClient } from '@/lib/supabase/server'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'
import { fireExtractWhenSettled } from '@/lib/case-documents/fire-extract-when-settled'
import type { DocStatusRow } from '@/lib/case-documents/document-readiness'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
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

  const res = await proxyEdgeFunction({
    fnName: EVIDENCE_FN,
    request,
    caseIdField: null,
    probe: async (client) => {
      const { data: canEdit, error: permissionError } = await client.rpc(
        'app_case_permission',
        { p_case_id: caseId, p_permission: 'edit' },
      )
      return { ok: !permissionError && canEdit === true, status: 404 }
    },
  })

  if (res.ok) {
    void (async () => {
      try {
        const docs = await loadCaseDocStatusRows(userClient, caseId)
        const result = await fireExtractWhenSettled({
          caseId,
          docs,
          edgeProxyBaseUrl: new URL(request.url).origin,
        })
        if (result.status === 'skipped_not_settled') {
          console.log(
            '[edge/evidence] extract deferred; documents_not_ready',
            JSON.stringify({ case_id: caseId, not_ready: result.not_ready }),
          )
          return
        }
        if (result.status === 'pending_documents_not_ready') {
          console.log(
            '[edge/evidence] extract returned documents_not_ready (expected pending)',
            JSON.stringify({ case_id: caseId }),
          )
          return
        }
        if (result.status === 'skipped_overlap') {
          console.log(
            '[edge/evidence] extract overlap skipped',
            JSON.stringify({ case_id: caseId }),
          )
          return
        }
        if (!result.ok) {
          console.error(
            '[edge/evidence] auto-re-fire extract failed',
            JSON.stringify({ case_id: caseId, ...result }),
          )
        }
      } catch (err) {
        console.error('[edge/evidence] auto-re-fire extract error', err)
      }
    })()
  }

  return res
}

async function loadCaseDocStatusRows(
  userClient: Awaited<ReturnType<typeof createUserClient>>,
  caseId: string,
): Promise<DocStatusRow[]> {
  const { data: docs, error } = await userClient
    .from('case_documents')
    .select('id, processing_status, is_processed, content_latest_id')
    .eq('case_id', caseId)

  if (error || !docs) return []

  const { data: extr } = await userClient
    .from('case_document_extractions')
    .select('document_id')
    .eq('case_id', caseId)

  const withExtr = new Set(
    (extr ?? []).map((r) => String(r.document_id)).filter(Boolean),
  )

  return docs.map((d) => ({
    id: String(d.id),
    processing_status: d.processing_status,
    is_processed: d.is_processed,
    has_extraction_content:
      withExtr.has(String(d.id)) || Boolean(d.content_latest_id),
  }))
}
