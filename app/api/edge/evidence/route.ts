/** Worker-only durable evidence execution. Browser requests enqueue a job. */

import { EVIDENCE_FN } from '@/lib/edge-functions'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const response = await proxyEdgeFunction({
    fnName: EVIDENCE_FN,
    request,
  })

  // documents_not_ready is a transient, retryable evidence state for the
  // fireExtractWhenSettled worker loop; it should not be treated as a lease loss.
  if (response.status === 409) {
    try {
      const body = (await response.clone().json()) as { error?: string } | null
      if (body?.error === 'documents_not_ready') {
        return Response.json(
          { ok: false, error: 'documents_not_ready', pending: true },
          { status: 409 },
        )
      }
    } catch {
      // Falls through to the original proxy response if the payload is not JSON.
    }
  }

  return response
}
