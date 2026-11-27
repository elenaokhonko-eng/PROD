import type { SupabaseClient } from "@supabase/supabase-js"

// Requirements 8.3: which fault a person met, so it can be counted. The fault and the case ID only, never content.
export type Fault = "too_long" | "too_many" | "timed_out" | "cap"

export async function recordFault(service: SupabaseClient, fault: Fault, caseId: string | null): Promise<void> {
  const { error } = await service.from("analytics_events").insert({ event_name: "fault", event_data: { fault, case_id: caseId } })
  if (error) console.error(`[fault-log] not recorded: ${error.code ?? "unknown"}`)
}
