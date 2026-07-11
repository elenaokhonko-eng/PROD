import { TIER0_FN } from '@/lib/edge-functions'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return proxyEdgeFunction({
    fnName: TIER0_FN,
    request,
  })
}
