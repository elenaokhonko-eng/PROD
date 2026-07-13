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

export const CHECKOUT_PRODUCT_KEYS = Object.keys(
  PRODUCT_CATALOGUE,
) as CheckoutProductKey[]

export function isCheckoutProductKey(key: string | null | undefined): key is CheckoutProductKey {
  return typeof key === "string" && key in PRODUCT_CATALOGUE
}

/**
 * Resolve a known checkout product key. Unknown / missing keys throw —
 * never silently fall back to self_serve_report (that would mis-route payments).
 */
export function requireCheckoutProduct(
  key: string | null | undefined,
): ProductDefinition {
  if (!isCheckoutProductKey(key)) {
    throw new Error(`Unknown or missing checkout product_key: ${key ?? "null"}`)
  }
  return PRODUCT_CATALOGUE[key]
}

/** @deprecated Prefer requireCheckoutProduct — kept only for transitional callers. */
export function resolveCheckoutProduct(
  key: string | null | undefined,
): ProductDefinition {
  return requireCheckoutProduct(key)
}

export function resolvePriceId(
  product: ProductDefinition,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const value = env[product.priceEnvVar]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

/** Metadata written onto Stripe Checkout Session at create time. */
export function buildCheckoutSessionMetadata(input: {
  caseId: string
  product: ProductDefinition
  casePurchaseId: string
  legacyPaymentId: string
  /** Denormalized dashboard copy only — never used as ownership authority. */
  caseOwnerUserId: string
}): Record<string, string> {
  return {
    case_id: input.caseId,
    product_key: input.product.checkoutKey,
    product_code: input.product.productCode,
    case_purchase_id: input.casePurchaseId,
    payment_row_id: input.legacyPaymentId,
    user_id: input.caseOwnerUserId,
  }
}

export const REQUIRED_CHECKOUT_METADATA_KEYS = [
  "case_id",
  "product_key",
  "product_code",
  "case_purchase_id",
  "payment_row_id",
] as const

export function assertRequiredCheckoutMetadata(
  metadata: Record<string, string | undefined> | null | undefined,
): void {
  if (!metadata) {
    throw new Error("Checkout session metadata is missing")
  }
  for (const key of REQUIRED_CHECKOUT_METADATA_KEYS) {
    const value = metadata[key]
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Checkout session metadata missing required key: ${key}`)
    }
  }
  const product = requireCheckoutProduct(metadata.product_key)
  if (metadata.product_code !== product.productCode) {
    throw new Error(
      `Checkout metadata product_code mismatch: got ${metadata.product_code}, expected ${product.productCode}`,
    )
  }
}

/** Idempotency constraints used by Slice 8 payment fulfilment (documentation + tests). */
export const PAYMENT_IDEMPOTENCY = {
  webhookEvent: "UNIQUE(payment_provider, provider_event_id) on payment_webhook_events",
  checkoutSession: "UNIQUE(payment_provider, provider_checkout_session_id) WHERE NOT NULL on case_purchases",
  fulfilmentEvent: "UNIQUE(payment_provider, fulfilment_provider_event_id) WHERE NOT NULL on case_purchases",
  consultationPerPurchase: "UNIQUE(purchase_id) on case_consultations",
  reportJob: "UNIQUE(idempotency_key) WHERE NOT NULL on jobs (key = Stripe session.id)",
} as const
