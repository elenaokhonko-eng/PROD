import { REPORT_FN } from '@/lib/edge-functions'
import { proxyEdgeFunction } from '@/lib/server/edge-proxy'

export const dynamic = 'force-dynamic'

/**
 * `run_report_selfserve_v1` requires a server-only `simulation_key` (IS §4.5).
 * Inject it in `mutateBody`. The user never sees `simulation_key`.
 *
 * Pattern C ownership: do NOT inject or forward an authoritative `user_id`.
 * The edge function resolves owner from `cases.user_id` via `case_id`.
 * Report RLS is case-scoped (`cases.user_id = current_app_user_id()`).
 */
export async function POST(request: Request) {
  return proxyEdgeFunction({
    fnName: REPORT_FN,
    request,
    mutateBody: (body) => {
      const { user_id: _ignored, ...rest } = body
      return {
        ...rest,
        simulation_key: process.env.SIMULATION_KEY,
      }
    },
  })
}
