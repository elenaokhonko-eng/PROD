// Node side of the model-call metering (supabase/functions/_shared/model-usage.ts): the web app and worker record
// through the service client, in the environment this deployment declares.
import { createServiceClient } from "@/lib/supabase/service"
import {
  dailyBreaker,
  recordModelUsage,
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
