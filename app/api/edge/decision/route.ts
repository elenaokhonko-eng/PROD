import { DECISION_FN } from '@/lib/edge-functions'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return proxyEdgeFunction({
    fnName: DECISION_FN,
    request,
  })
}
