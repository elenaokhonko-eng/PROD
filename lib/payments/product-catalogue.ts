/**
 * Stripe checkout product keys (API/UI) ↔ durable case_purchases.product_code.
 *
 * Checkout may keep commerce keys (human_consult_30m, fidrec_tier2_pack) for
 * Stripe/env compatibility. Database product_code values are constrained by
 * Slice 8 case_purchases CHECK:
 *   self_serve_report | human_consult_99 | escalation_pack
 */

export type CheckoutProductKey =
  | "self_serve_report"
  | "fidrec_tier2_pack"
  | "human_consult_30m"

export type CasePurchaseProductCode =
  | "self_serve_report"
  | "human_consult_99"
  | "escalation_pack"

export type ProductFulfilment =
  | "self_serve_report_job"
  | "escalation_pack_entitlement"
  | "human_consult_allocation"

export interface ProductDefinition {
  checkoutKey: CheckoutProductKey
  productCode: CasePurchaseProductCode
  priceEnvVar: string
  amountSgd: number
  /** Legacy payments.service_type for dual-write during transition. */
  legacyServiceType: string
  fulfilment: ProductFulfilment
  /** Default consult duration; ignored for non-consult products. */
  defaultDurationMinutes?: number
}

export const PRODUCT_CATALOGUE: Record<CheckoutProductKey, ProductDefinition> = {
  self_serve_report: {
    checkoutKey: "self_serve_report",
    productCode: "self_serve_report",
    priceEnvVar: "STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD",
    amountSgd: 18,
    legacyServiceType: "standard",
    fulfilment: "self_serve_report_job",
  },
  fidrec_tier2_pack: {
    checkoutKey: "fidrec_tier2_pack",
    productCode: "escalation_pack",
    priceEnvVar: "STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD",
    amountSgd: 188,
    legacyServiceType: "fidrec_tier2_pack",
    fulfilment: "escalation_pack_entitlement",
  },
  human_consult_30m: {
    checkoutKey: "human_consult_30m",
    productCode: "human_consult_99",
    priceEnvVar: "STRIPE_PRICE_ID_HUMAN_CONSULT_30M_SGD",
    amountSgd: 99,
    legacyServiceType: "human_consult_30m",
    fulfilment: "human_consult_allocation",
    defaultDurationMinutes: 30,
  },
}

export function resolveCheckoutProduct(
  key: string | null | undefined,
): ProductDefinition {
  if (key && key in PRODUCT_CATALOGUE) {
    return PRODUCT_CATALOGUE[key as CheckoutProductKey]
  }
  return PRODUCT_CATALOGUE.self_serve_report
}
