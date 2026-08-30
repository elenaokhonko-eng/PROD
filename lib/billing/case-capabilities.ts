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

export interface CaseCapabilityBillingResponse {
  version: 1
  caseId: string
  generatedAt: string
  access: {
    canPurchase: boolean
  }
  capabilities: {
    report: {
      entitled: boolean
      canGenerate: boolean
      canCheckout: boolean
      checkoutInProgress: boolean
      reconciliationRequired: boolean
    }
    fidrecPack: {
      entitled: boolean
      canUse: boolean
      canCheckout: boolean
      checkoutInProgress: boolean
      reconciliationRequired: boolean
      requiresReportEntitlement: true
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
  generatedAt?: string
}): CaseCapabilityBillingResponse {
  const canPurchase = input.canPurchase ?? true
  const features = input.entitlement?.features ?? {}
  const reportEntitled =
    input.entitlement?.plan === "self_serve_report" ||
    input.entitlement?.plan === "escalation_pack" ||
    isTrue(features.allow_self_serve_report)
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

  return {
    version: 1,
    caseId: input.caseId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    access: {
      canPurchase,
    },
    capabilities: {
      report: {
        entitled: reportEntitled,
        canGenerate: reportEntitled,
        canCheckout:
          canPurchase &&
          PRODUCT_CATALOGUE.self_serve_report.checkoutEnabled &&
          !reportEntitled &&
          !reportPurchaseEstablished,
        checkoutInProgress: reportCheckoutInProgress,
        reconciliationRequired: reportPurchaseEstablished && !reportEntitled,
      },
      fidrecPack: {
        entitled: fidrecEntitled,
        canUse: fidrecEntitled,
        canCheckout:
          canPurchase &&
          PRODUCT_CATALOGUE.fidrec_tier2_pack.checkoutEnabled &&
          reportEntitled &&
          !fidrecEntitled &&
          !fidrecPurchaseEstablished,
        checkoutInProgress: fidrecCheckoutInProgress,
        reconciliationRequired: fidrecPurchaseEstablished && !fidrecEntitled,
        requiresReportEntitlement: true,
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
