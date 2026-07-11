import { REPORT_FN } from '@/lib/edge-functions'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'

export const dynamic = 'force-dynamic'

/**
 * `run_report_selfserve_v1` requires a server-only `simulation_key` and the
 * user_id of the requester in the body (IS §4.5). Inject them in `mutateBody`.
 * The user never sees `simulation_key`.
 */
export async function POST(request: Request) {
  return proxyEdgeFunction({
    fnName: REPORT_FN,
    request,
    mutateBody: (body) => ({
      ...body,
      simulation_key: process.env.SIMULATION_KEY,
    }),
  })
}
