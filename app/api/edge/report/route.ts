import { REPORT_FN } from '@/lib/edge-functions'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'

export const dynamic = 'force-dynamic'

/**
 * The shared proxy injects the server-only simulation key and binds report
 * generation to the active worker lease. Browser calls are denied.
 */
export async function POST(request: Request) {
  return proxyEdgeFunction({
    fnName: REPORT_FN,
    request,
  })
}
