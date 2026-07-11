import { EXTRACT_FN } from '@/lib/edge-functions'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return proxyEdgeFunction({
    fnName: EXTRACT_FN,
    request,
  })
}
