import type { SupabaseClient } from "@supabase/supabase-js"

// Whether a free case may buy the S$18 report: its free draft (Tier 0) exists and its latest validation is not
// blocking. This is "can buy", separate from get_case_eligibility's run_report_selfserve ("can run"), which is
// only true once the report is paid for. The capabilities API (buy button) and checkout share this check.

export type ReportPurchaseBlock = "free_draft_missing" | "validation_missing" | "validation_blocking"

export interface ReportPurchaseReadiness {
  ready: boolean
  blockedReason: ReportPurchaseBlock | null
}

export interface ReportPurchaseFacts {
  hasFreeDraft: boolean
  latestValidation: { status: string | null; is_valid: boolean | null } | null
}

const TIER0_NARRATIVE_TYPES = ["tier0_summary", "tier0_evidence_checklist", "tier0_srf_signal"]

// Same rule as get_case_eligibility's validation_blocking.
export function assessReportPurchaseReadiness(facts: ReportPurchaseFacts): ReportPurchaseReadiness {
  if (!facts.hasFreeDraft) return { ready: false, blockedReason: "free_draft_missing" }
  if (!facts.latestValidation) return { ready: false, blockedReason: "validation_missing" }
  const { status, is_valid } = facts.latestValidation
  if (status === "invalid" || status === "error" || is_valid !== true) {
    return { ready: false, blockedReason: "validation_blocking" }
  }
  return { ready: true, blockedReason: null }
}

// Throws on a query error, so callers fail closed.
export async function loadReportPurchaseReadiness(client: SupabaseClient, caseId: string): Promise<ReportPurchaseReadiness> {
  const [draft, extract] = await Promise.all([
    client.from("case_narratives").select("id").eq("case_id", caseId).in("narrative_type", TIER0_NARRATIVE_TYPES).limit(1),
    client.from("case_extract_runs").select("id").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  if (draft.error || extract.error) throw new Error("Failed to load report purchase readiness")

  let latestValidation: ReportPurchaseFacts["latestValidation"] = null
  const extractId = (extract.data as { id?: string } | null)?.id
  if (extractId) {
    const validation = await client
      .from("case_validation_runs")
      .select("status, is_valid")
      .eq("extract_run_id", extractId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (validation.error) throw new Error("Failed to load report purchase readiness")
    latestValidation = (validation.data as ReportPurchaseFacts["latestValidation"]) ?? null
  }

  return assessReportPurchaseReadiness({ hasFreeDraft: (draft.data ?? []).length > 0, latestValidation })
}
