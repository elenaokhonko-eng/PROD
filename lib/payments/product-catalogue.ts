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
  | "payment_record_only"

export interface ProductDefinition {
  checkoutKey: CheckoutProductKey
  productCode: CasePurchaseProductCode
  priceEnvVar: string
  amountSgd: number
  checkoutEnabled: boolean
  /** Legacy payments.service_type for dual-write during transition. */
  legacyServiceType: string
  fulfilment: ProductFulfilment
}

export const PRODUCT_CATALOGUE: Record<CheckoutProductKey, ProductDefinition> = {
  self_serve_report: {
    checkoutKey: "self_serve_report",
    productCode: "self_serve_report",
    priceEnvVar: "STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD",
    amountSgd: 18,
    checkoutEnabled: true,
    legacyServiceType: "standard",
    fulfilment: "self_serve_report_job",
  },
  fidrec_tier2_pack: {
    checkoutKey: "fidrec_tier2_pack",
    productCode: "escalation_pack",
    priceEnvVar: "STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD",
    amountSgd: 188,
    checkoutEnabled: true,
    legacyServiceType: "fidrec_tier2_pack",
    fulfilment: "escalation_pack_entitlement",
  },
  human_consult_30m: {
    checkoutKey: "human_consult_30m",
    productCode: "human_consult_99",
    priceEnvVar: "STRIPE_PRICE_ID_HUMAN_CONSULT_30M_SGD",
    amountSgd: 99,
    checkoutEnabled: false,
    legacyServiceType: "human_consult_30m",
    fulfilment: "payment_record_only",
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

export function resolveCheckoutRedirectOrigin(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const deployment = env.HARBOR_DEPLOYMENT_ENVIRONMENT?.trim()
  const configuredOrigin = env.CHECKOUT_REDIRECT_ORIGIN?.trim()
  const publicOrigin = env.NEXT_PUBLIC_APP_URL?.trim()
  const productionOrigin = env.HARBOR_PRODUCTION_APP_ORIGIN?.trim()
  if (
    !["development", "preview", "production"].includes(deployment ?? "") ||
    !configuredOrigin ||
    !publicOrigin
  ) {
    return null
  }

  try {
    const checkoutUrl = new URL(configuredOrigin)
    const publicUrl = new URL(publicOrigin)
    const canonicalOrigin = checkoutUrl.origin
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(checkoutUrl.hostname)

    for (const url of [checkoutUrl, publicUrl]) {
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null
    }
    if (publicUrl.origin !== canonicalOrigin) return null

    if (deployment === "development") {
      return isLocal && ["http:", "https:"].includes(checkoutUrl.protocol) ? canonicalOrigin : null
    }
    if (checkoutUrl.protocol !== "https:" || isLocal || !productionOrigin) return null

    const productionUrl = new URL(productionOrigin)
    if (
      productionUrl.protocol !== "https:" ||
      productionUrl.username ||
      productionUrl.password ||
      productionUrl.pathname !== "/" ||
      productionUrl.search ||
      productionUrl.hash
    ) {
      return null
    }

    if (deployment === "preview" && canonicalOrigin === productionUrl.origin) return null
    if (deployment === "production" && canonicalOrigin !== productionUrl.origin) return null
    return canonicalOrigin
  } catch {
    return null
  }
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
  reportJob: "UNIQUE(idempotency_key) WHERE NOT NULL on jobs (key = Stripe session.id)",
} as const
