// Node side of the model-call metering (supabase/functions/_shared/model-usage.ts): the web app and worker record
// through the service client, in the environment this deployment declares.
import { createServiceClient } from "@/lib/supabase/service"
import {
  breakerFor,
  dailyBreaker,
  PRE_SIGN_IN_PURPOSES,
  preSignInCapUsd,
  recordModelUsage,
  singaporeDayStart,
  type UsageClient,
  usageEnvironment,
  type UsageRecord,
} from "../../supabase/functions/_shared/model-usage"

export * from "../../supabase/functions/_shared/model-usage"

const client = () => createServiceClient() as unknown as UsageClient

export function recordUsage(rec: UsageRecord): Promise<void> {
  return recordModelUsage(client(), usageEnvironment(process.env), rec)
}

export function currentBreaker() {
  return dailyBreaker(client(), usageEnvironment(process.env), process.env)
}

/** Today's spend on the calls reachable before sign-in, against its sub-cap. A failed read leaves it closed, like the
 * daily breaker: a metering outage is not a stop. */
export async function preSignInBreaker() {
  const cap = preSignInCapUsd(process.env)
  try {
    const { data, error } = await createServiceClient()
      .from("model_usage")
      .select("estimated_cost_usd")
      .eq("environment", usageEnvironment(process.env))
      .in("purpose", [...PRE_SIGN_IN_PURPOSES])
      .gte("created_at", singaporeDayStart())
      .limit(20_000)
    if (error || !data) return breakerFor(0, cap)
    const spent = data.reduce((sum, row) => sum + (Number((row as { estimated_cost_usd: unknown }).estimated_cost_usd) || 0), 0)
    return breakerFor(spent, cap)
  } catch {
    return breakerFor(0, cap)
  }
}

/** Pre-sign-in model work stops when either the daily breaker or the anonymous sub-cap is open. */
export async function preSignInModelPaused(): Promise<boolean> {
  const [daily, anonymous] = await Promise.all([currentBreaker(), preSignInBreaker()])
  return daily.state === "open" || anonymous.state === "open"
}
