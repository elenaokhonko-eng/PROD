import type { SupabaseClient } from "@supabase/supabase-js"

import {
  type BankReply,
  type Institution,
  type Money,
  recommend,
  type Recommendation,
  type ReportedEvent,
} from "@/lib/facts"
import { paidStagesState, type PaidStagesState } from "@/lib/billing/paid-stages"
import { isFIDReCSubscriber } from "@/lib/fidrec-subscribers"
import { FactsUnavailableError } from "./run-reconcile"

export interface RecommendationView {
  // Null when the case has no confirmed free snapshot (cases evaluated before fact checking existed).
  recommendation: Recommendation | null
  paidStages: PaidStagesState
}

type Labelled = { value: unknown; label: "confirmed" | "not_sure" | "claimant_only" | "not_known" }

function singaporeToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10)
}

// The recommendation after the free evaluation (design 6.1), from the latest confirmed "free" snapshot. Facts the
// user kept without a document count; facts marked "not sure" or "not known" do not.
export async function loadRecommendation(service: SupabaseClient, caseId: string): Promise<RecommendationView> {
  const { data, error } = await service
    .from("case_fact_snapshots")
    .select("facts")
    .eq("case_id", caseId)
    .eq("stage", "free")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new FactsUnavailableError("Failed to load snapshot")
  if (!data) return { recommendation: null, paidStages: paidStagesState() }

  const facts = data.facts as Record<string, Labelled | undefined>
  const value = <T>(key: string): T | null => {
    const fact = facts[key]
    return fact && (fact.label === "confirmed" || fact.label === "claimant_only") ? (fact.value as T) : null
  }
  const paidStages = paidStagesState()
  const recommendation = recommend(
    {
      reportedToBank: value<ReportedEvent>("reported_to_bank"),
      writtenComplaint: value<ReportedEvent>("written_complaint_sent"),
      bankReply: value<BankReply>("bank_reply"),
      fidrecFiled: value<ReportedEvent>("fidrec_filed"),
      totalLoss: value<Money>("total_loss"),
      recovered: value<Money>("amount_recovered_or_offered"),
      institutions: value<Institution[]>("institution_names"),
    },
    { today: singaporeToday(), bankPackEnabled: paidStages.enabled, isFidrecMember: isFIDReCSubscriber },
  )
  return { recommendation, paidStages }
}
