import type { SupabaseClient } from "@supabase/supabase-js"
import { bankPackEnabled, paidStagesEnabled } from "@/lib/billing/paid-stages"

// Whether a case may buy a pack (Elena, 13 Nov 2026; docs/release/stage2-plan.md §3a). The packs are sold on their
// own: the bank pack needs only a story; the FIDReC pack also needs the route answer (a final reply no more than 6
// months old, or a written complaint with no reply after 4 weeks). The database decides
// (get_case_product_readiness_v1, also enforced inside reserve_checkout_purchase_v1). The capabilities API (buy
// buttons) and checkout share this check. The on/off switches (PAID_STAGES_ENABLED, BANK_PACK_ENABLED) are applied
// separately, so with paid stages off a case still reads as ready and shows "coming shortly", not a blocked screen.

export type ReadinessProductKey = "self_serve_report" | "fidrec_tier2_pack"

export type ProductReadinessReason =
  | "story_missing"
  | "product_not_available"
  | "already_purchased"
  | "fidrec_too_early"
  | "fidrec_window_expired"
  | "complaint_not_raised"

export const PRODUCT_READINESS_REASONS: readonly ProductReadinessReason[] = [
  "story_missing",
  "product_not_available",
  "already_purchased",
  "fidrec_too_early",
  "fidrec_window_expired",
  "complaint_not_raised",
]

export interface ProductReadiness {
  ready: boolean
  reason: ProductReadinessReason | null
  /** fidrec_too_early only: the first day the FIDReC pack can be bought (YYYY-MM-DD, Singapore). */
  opensOn?: string
}

export function productSwitchedOn(product: ReadinessProductKey): boolean {
  return product === "self_serve_report" ? bankPackEnabled() : paidStagesEnabled()
}

/** Reads the RPC's answer; anything unexpected is treated as not ready. */
export function parseProductReadiness(value: unknown): ProductReadiness {
  const row = (value ?? {}) as { ready?: unknown; reason?: unknown; opens_on?: unknown }
  if (row.ready === true) return { ready: true, reason: null }
  const reason = PRODUCT_READINESS_REASONS.includes(row.reason as ProductReadinessReason)
    ? (row.reason as ProductReadinessReason)
    : "product_not_available"
  return typeof row.opens_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.opens_on)
    ? { ready: false, reason, opensOn: row.opens_on }
    : { ready: false, reason }
}

// Needs a service-role client (the RPC is not granted to signed-in users). Throws on a query error, so callers fail
// closed.
export async function loadProductReadiness(
  service: SupabaseClient,
  caseId: string,
  product: ReadinessProductKey,
): Promise<ProductReadiness> {
  const { data, error } = await service.rpc("get_case_product_readiness_v1", {
    p_case_id: caseId,
    p_checkout_product_key: product,
  })
  if (error) throw new Error("Failed to load product readiness")
  return parseProductReadiness(data)
}
