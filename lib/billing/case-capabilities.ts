import type { ProductReadiness, ProductReadinessReason } from "@/lib/billing/product-readiness"
import { PRODUCT_CATALOGUE } from "@/lib/payments/product-catalogue"

export type CasePurchaseStatus =
  | "pending"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "disputed"
  | "cancelled"

export interface CasePurchaseCapabilityRow {
  id: string
  product_code: string
  payment_status: string
  paid_at: string | null
  created_at: string
}

export interface CaseEntitlementCapabilityRow {
  plan: string
  features: Record<string, unknown> | null
  purchased_at: string | null
}

/**
 * One state per pack (design C2). "unavailable" carries the reason: a readiness reason
 * (lib/billing/product-readiness.ts), or product_not_available when paid stages or the pack are switched off or the
 * viewer can't buy for this case.
 */
export type PackState = "owned" | "available" | "checkout_in_progress" | "reconciling" | "unavailable"

export interface PackReadinessInput {
  report: ProductReadiness
  fidrecPack: ProductReadiness
}

export interface CaseCapabilityBillingResponse {
  version: 1
  caseId: string
  generatedAt: string
  access: {
    canPurchase: boolean
    paidStagesEnabled: boolean
    paidStagesAvailableFrom: string | null
  }
  capabilities: {
    report: {
      entitled: boolean
      canGenerate: boolean
      canCheckout: boolean
      checkoutInProgress: boolean
      reconciliationRequired: boolean
      // The stage 2 buying rules allow it (lib/billing/product-readiness.ts).
      purchaseReady: boolean
      purchaseBlockedReason: ProductReadinessReason | null
      state: PackState
      reason: ProductReadinessReason | null
    }
    fidrecPack: {
      entitled: boolean
      canUse: boolean
      canCheckout: boolean
      checkoutInProgress: boolean
      reconciliationRequired: boolean
      purchaseReady: boolean
      purchaseBlockedReason: ProductReadinessReason | null
      /** fidrec_too_early only: the first day it can be bought. */
      opensOn: string | null
      state: PackState
      reason: ProductReadinessReason | null
    }
    regeneration: {
      availability: "policy_blocked"
      allowedTiers: []
    }
  }
  billing: {
    currency: "SGD"
    oneTime: {
      report: OneTimeProductBilling
      fidrecPack: OneTimeProductBilling
    }
    subscription: {
      availability: "policy_blocked"
      plan: null
      status: null
      canManagePortal: false
    }
  }
}

interface OneTimeProductBilling {
  productKey: "self_serve_report" | "fidrec_tier2_pack"
  amount: number
  checkoutEnabled: boolean
  latestPurchase: {
    id: string
    status: CasePurchaseStatus
    paidAt: string | null
  } | null
}

function isTrue(value: unknown): boolean {
  return value === true
}

const ESTABLISHED_PURCHASE_STATUSES = new Set<CasePurchaseStatus>([
  "paid",
  "partially_refunded",
  "refunded",
  "disputed",
])

function packState(pack: {
  entitled: boolean
  reconciliationRequired: boolean
  checkoutInProgress: boolean
  canCheckout: boolean
  blockedReason: ProductReadinessReason | null
}): { state: PackState; reason: ProductReadinessReason | null } {
  if (pack.entitled) return { state: "owned", reason: null }
  if (pack.reconciliationRequired) return { state: "reconciling", reason: null }
  if (pack.checkoutInProgress) return { state: "checkout_in_progress", reason: null }
  if (pack.canCheckout) return { state: "available", reason: null }
  return { state: "unavailable", reason: pack.blockedReason ?? "product_not_available" }
}

const UNKNOWN_READINESS: ProductReadiness = { ready: false, reason: null }

function purchasesForProduct(rows: CasePurchaseCapabilityRow[], productCode: string) {
  return rows.filter((row) => row.product_code === productCode)
}

function latestPurchase(
  rows: CasePurchaseCapabilityRow[],
  productCode: string,
): OneTimeProductBilling["latestPurchase"] {
  const purchase = purchasesForProduct(rows, productCode)[0]
  if (!purchase) return null

  return {
    id: purchase.id,
    status: purchase.payment_status as CasePurchaseStatus,
    paidAt: purchase.paid_at,
  }
}

function hasPurchaseStatus(
  rows: CasePurchaseCapabilityRow[],
  productCode: string,
  predicate: (status: CasePurchaseStatus) => boolean,
): boolean {
  return purchasesForProduct(rows, productCode).some((row) =>
    predicate(row.payment_status as CasePurchaseStatus),
  )
}

export function buildCaseCapabilityBillingResponse(input: {
  caseId: string
  entitlement: CaseEntitlementCapabilityRow | null
  purchases: CasePurchaseCapabilityRow[]
  canPurchase?: boolean
  // Omitted means unknown: neither pack can be bought.
  readiness?: PackReadinessInput
  // Stage 1 launches without payments (lib/billing/paid-stages.ts). Omitted means enabled (pure callers, tests).
  paidStages?: { enabled: boolean; availableFrom: string | null }
  // The bank pack's own switch (BANK_PACK_ENABLED). Omitted means enabled (pure callers, tests).
  bankPackEnabled?: boolean
  generatedAt?: string
}): CaseCapabilityBillingResponse {
  const paidStages = input.paidStages ?? { enabled: true, availableFrom: null }
  const canPurchase = (input.canPurchase ?? true) && paidStages.enabled
  const reportReadiness = input.readiness?.report ?? UNKNOWN_READINESS
  const fidrecReadiness = input.readiness?.fidrecPack ?? UNKNOWN_READINESS
  const features = input.entitlement?.features ?? {}
  // Each pack is its own entitlement (migration 20261120120000): the FIDReC plan doesn't include the bank pack.
  const reportEntitled =
    input.entitlement?.plan === "self_serve_report" || isTrue(features.allow_self_serve_report)
  const fidrecEntitled =
    input.entitlement?.plan === "escalation_pack" || isTrue(features.allow_escalation_pack)
  const reportCheckoutInProgress = hasPurchaseStatus(
    input.purchases,
    "self_serve_report",
    (status) => status === "pending",
  )
  const reportPurchaseEstablished = hasPurchaseStatus(
    input.purchases,
    "self_serve_report",
    (status) => ESTABLISHED_PURCHASE_STATUSES.has(status),
  )
  const fidrecCheckoutInProgress = hasPurchaseStatus(
    input.purchases,
    "escalation_pack",
    (status) => status === "pending",
  )
  const fidrecPurchaseEstablished = hasPurchaseStatus(
    input.purchases,
    "escalation_pack",
    (status) => ESTABLISHED_PURCHASE_STATUSES.has(status),
  )

  const bankPackOn = input.bankPackEnabled ?? true
  const reportCanCheckout =
    canPurchase &&
    bankPackOn &&
    PRODUCT_CATALOGUE.self_serve_report.checkoutEnabled &&
    reportReadiness.ready &&
    !reportEntitled &&
    !reportPurchaseEstablished
  const fidrecCanCheckout =
    canPurchase &&
    PRODUCT_CATALOGUE.fidrec_tier2_pack.checkoutEnabled &&
    fidrecReadiness.ready &&
    !fidrecEntitled &&
    !fidrecPurchaseEstablished
  const reportBlockedReason = canPurchase && bankPackOn ? reportReadiness.reason : "product_not_available"
  const fidrecBlockedReason = canPurchase ? fidrecReadiness.reason : "product_not_available"

  return {
    version: 1,
    caseId: input.caseId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    access: {
      canPurchase,
      paidStagesEnabled: paidStages.enabled,
      paidStagesAvailableFrom: paidStages.availableFrom,
    },
    capabilities: {
      report: {
        entitled: reportEntitled,
        canGenerate: reportEntitled,
        canCheckout: reportCanCheckout,
        checkoutInProgress: reportCheckoutInProgress,
        reconciliationRequired: reportPurchaseEstablished && !reportEntitled,
        purchaseReady: reportReadiness.ready,
        purchaseBlockedReason: reportReadiness.reason,
        ...packState({
          entitled: reportEntitled,
          reconciliationRequired: reportPurchaseEstablished && !reportEntitled,
          checkoutInProgress: reportCheckoutInProgress,
          canCheckout: reportCanCheckout,
          blockedReason: reportBlockedReason,
        }),
      },
      fidrecPack: {
        entitled: fidrecEntitled,
        canUse: fidrecEntitled,
        canCheckout: fidrecCanCheckout,
        checkoutInProgress: fidrecCheckoutInProgress,
        reconciliationRequired: fidrecPurchaseEstablished && !fidrecEntitled,
        purchaseReady: fidrecReadiness.ready,
        purchaseBlockedReason: fidrecReadiness.reason,
        opensOn: fidrecReadiness.opensOn ?? null,
        ...packState({
          entitled: fidrecEntitled,
          reconciliationRequired: fidrecPurchaseEstablished && !fidrecEntitled,
          checkoutInProgress: fidrecCheckoutInProgress,
          canCheckout: fidrecCanCheckout,
          blockedReason: fidrecBlockedReason,
        }),
      },
      regeneration: {
        availability: "policy_blocked",
        allowedTiers: [],
      },
    },
    billing: {
      currency: "SGD",
      oneTime: {
        report: {
          productKey: "self_serve_report",
          amount: PRODUCT_CATALOGUE.self_serve_report.amountSgd,
          checkoutEnabled: PRODUCT_CATALOGUE.self_serve_report.checkoutEnabled,
          latestPurchase: latestPurchase(input.purchases, "self_serve_report"),
        },
        fidrecPack: {
          productKey: "fidrec_tier2_pack",
          amount: PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd,
          checkoutEnabled: PRODUCT_CATALOGUE.fidrec_tier2_pack.checkoutEnabled,
          latestPurchase: latestPurchase(input.purchases, "escalation_pack"),
        },
      },
      subscription: {
        availability: "policy_blocked",
        plan: null,
        status: null,
        canManagePortal: false,
      },
    },
  }
}
