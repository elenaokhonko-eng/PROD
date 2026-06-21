import { createServiceClient } from "@/lib/supabase/service"

/**
 * Error code thrown when a case does not have Tier-2 enabled.
 * Routes should catch this and return 403 without exposing internal entitlement detail.
 */
export const TIER2_NOT_ENABLED = "TIER2_NOT_ENABLED" as const

export class Tier2NotEnabledError extends Error {
  readonly code = TIER2_NOT_ENABLED
  constructor() {
    super(TIER2_NOT_ENABLED)
    this.name = "Tier2NotEnabledError"
  }
}

/**
 * Asserts that a case has Tier-2 access by calling the existing
 * `get_effective_entitlement(p_case_id)` RPC and checking `allow_escalation_pack`.
 *
 * Tier-2 (FIDReC preparation) is gated on the `escalation_pack` plan or an
 * explicit `allow_escalation_pack: true` feature override in `case_entitlements`.
 *
 * Throws `Tier2NotEnabledError` (code TIER2_NOT_ENABLED) if the case is not
 * entitled. Does not expose plan or payment details in the error.
 */
export async function assertTier2Eligible(caseId: string): Promise<void> {
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc("get_effective_entitlement", {
    p_case_id: caseId,
  })

  if (error) {
    // Treat RPC errors as ineligible — do not leak internal messages to callers.
    throw new Tier2NotEnabledError()
  }

  const features = (data as Record<string, unknown> | null)?.features
  const allowed =
    typeof features === "object" &&
    features !== null &&
    (features as Record<string, unknown>).allow_escalation_pack === true

  if (!allowed) {
    throw new Tier2NotEnabledError()
  }
}
