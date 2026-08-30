import type { ProductDefinition, ProductFulfilment } from "@/lib/payments/product-catalogue"
import {
  assertRequiredCheckoutMetadata,
  requireCheckoutProduct,
} from "@/lib/payments/product-catalogue"

export type FulfilmentSideEffect =
  | { type: "enqueue_report_job" }
  | { type: "upsert_escalation_pack_entitlement" }

export function sideEffectsForFulfilment(
  fulfilment: ProductFulfilment,
): FulfilmentSideEffect[] {
  switch (fulfilment) {
    case "self_serve_report_job":
      return [{ type: "enqueue_report_job" }]
    case "escalation_pack_entitlement":
      return [{ type: "upsert_escalation_pack_entitlement" }]
    case "payment_record_only":
      return []
    default: {
      const _exhaustive: never = fulfilment
      return _exhaustive
    }
  }
}

export function mutatesCaseEntitlements(fulfilment: ProductFulfilment): boolean {
  return (
    fulfilment === "self_serve_report_job" ||
    fulfilment === "escalation_pack_entitlement"
  )
}

export function enqueuesReportJob(fulfilment: ProductFulfilment): boolean {
  return fulfilment === "self_serve_report_job"
}

export interface CheckoutSessionCompletedInput {
  eventId: string
  sessionId: string
  mode: string | null
  paymentStatus: string | null
  amountTotalCents: number | null
  currency: string | null
  paymentIntentId: string | null
  clientReferenceId?: string | null
  metadata: Record<string, string | undefined> | null | undefined
}

export interface CaseRow {
  id: string
  user_id: string | null
}

export interface PurchaseRow {
  id: string
  user_id: string
  case_id: string
  product_code: string
  payment_status: string
  amount?: number | string
  currency?: string
  provider_checkout_session_id?: string | null
  fulfilment_provider_event_id?: string | null
}

export interface WebhookLedgerRow {
  id: string
  processing_status: string
}

export interface FulfilmentDeps {
  recordWebhookEvent: (args: {
    providerEventId: string
    eventType: string
    casePurchaseId: string | null
    caseId: string | null
    processingStatus: string
    payload: Record<string, unknown>
  }) => Promise<WebhookLedgerRow>
  markLedger: (
    ledgerId: string,
    patch: {
      processing_status: string
      error?: string | null
      case_purchase_id?: string
      case_id?: string
      processed_at?: string
    },
  ) => Promise<void>
  completeLegacyPayment: (args: {
    paymentRowId: string
    caseId: string
    ownerUserId: string
    amountSgd: number
    currency: string
    serviceType: string
    paymentIntentId: string
  }) => Promise<void>
  loadCase: (caseId: string) => Promise<CaseRow | null>
  loadPurchase: (args: {
    purchaseId: string
    caseId: string
    productCode: string
    checkoutSessionId: string
  }) => Promise<PurchaseRow | null>
  upsertPaidPurchase: (args: {
    purchaseId: string
    caseId: string
    productCode: string
    amount: number
    currency: string
    checkoutSessionId: string
    paymentIntentId: string | null
    fulfilmentEventId: string
    checkoutProductKey: string
  }) => Promise<PurchaseRow>
  enqueueReportJob: (args: {
    caseId: string
    userId: string
    idempotencyKey: string
    paymentRowId: string | null
  }) => Promise<void>
  upsertEscalationPackEntitlement: (args: {
    caseId: string
    purchaseRef: string
  }) => Promise<void>
  nowIso: () => string
}

export type FulfilmentResult =
  | { status: "duplicate" }
  | { status: "ignored"; reason: string }
  | { status: "processed"; purchaseId: string; fulfilment: ProductFulfilment }
  | { status: "failed"; error: string }

/**
 * Compensating / retry-based fulfilment for checkout.session.completed.
 * Not a single DB transaction: Stripe retries on HTTP 500; idempotent RPCs
 * and UNIQUE constraints make re-delivery safe.
 */
export async function fulfilCheckoutSessionCompleted(
  deps: FulfilmentDeps,
  input: CheckoutSessionCompletedInput,
): Promise<FulfilmentResult> {
  let product: ProductDefinition
  try {
    assertRequiredCheckoutMetadata(input.metadata)
    product = requireCheckoutProduct(input.metadata?.product_key)
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid metadata"
    const ledger = await deps.recordWebhookEvent({
      providerEventId: input.eventId,
      eventType: "checkout.session.completed",
      casePurchaseId: input.metadata?.case_purchase_id ?? null,
      caseId: input.metadata?.case_id ?? null,
      processingStatus: "received",
      payload: {
        session_id: input.sessionId,
        error: message,
      },
    })
    if (ledger.processing_status === "processed") {
      return { status: "duplicate" }
    }
    await deps.markLedger(ledger.id, {
      processing_status: "ignored",
      error: message,
      processed_at: deps.nowIso(),
    })
    return { status: "ignored", reason: message }
  }

  const caseId = input.metadata!.case_id!
  const paymentRowId = input.metadata!.payment_row_id ?? null
  const casePurchaseIdMeta = input.metadata!.case_purchase_id!

  const ledger = await deps.recordWebhookEvent({
    providerEventId: input.eventId,
    eventType: "checkout.session.completed",
    casePurchaseId: casePurchaseIdMeta,
    caseId,
    processingStatus: "received",
    payload: {
      session_id: input.sessionId,
      product_key: product.checkoutKey,
      product_code: product.productCode,
    },
  })

  if (ledger.processing_status === "processed") {
    return { status: "duplicate" }
  }

  const fail = async (reason: string, purchase?: PurchaseRow): Promise<FulfilmentResult> => {
    await deps.markLedger(ledger.id, {
      processing_status: "failed",
      error: reason,
      case_purchase_id: purchase?.id,
      case_id: purchase?.case_id,
      processed_at: deps.nowIso(),
    })
    return { status: "failed", error: reason }
  }

  const expectedAmountCents = Math.round(product.amountSgd * 100)
  if (input.mode !== "payment") {
    return fail(`checkout mode must be payment, received ${input.mode ?? "missing"}`)
  }
  if (input.paymentStatus !== "paid") {
    return fail(`checkout payment_status must be paid, received ${input.paymentStatus ?? "missing"}`)
  }
  if (!input.paymentIntentId) {
    return fail("checkout payment_intent is required")
  }
  if (input.amountTotalCents !== expectedAmountCents) {
    return fail(`checkout amount mismatch for ${product.checkoutKey}`)
  }
  if (input.currency?.toLowerCase() !== "sgd") {
    return fail(`checkout currency mismatch for ${product.checkoutKey}`)
  }
  if (input.clientReferenceId && input.clientReferenceId !== casePurchaseIdMeta) {
    return fail("checkout client_reference_id does not match case_purchase_id")
  }

  const caseRow = await deps.loadCase(caseId)
  if (!caseRow) {
    return fail(`case ${caseId} not found`)
  }
  if (!caseRow.user_id) {
    return fail(`case ${caseId} has null user_id`)
  }

  const pendingPurchase = await deps.loadPurchase({
    purchaseId: casePurchaseIdMeta,
    caseId,
    productCode: product.productCode,
    checkoutSessionId: input.sessionId,
  })
  if (!pendingPurchase) {
    return fail(`case purchase ${casePurchaseIdMeta} not found`)
  }
  if (
    pendingPurchase.case_id !== caseId ||
    pendingPurchase.product_code !== product.productCode ||
    pendingPurchase.user_id !== caseRow.user_id ||
    Number(pendingPurchase.amount) !== product.amountSgd ||
    pendingPurchase.currency?.toUpperCase() !== "SGD" ||
    (pendingPurchase.provider_checkout_session_id !== null &&
      pendingPurchase.provider_checkout_session_id !== undefined &&
      pendingPurchase.provider_checkout_session_id !== input.sessionId) ||
    !["pending", "paid", "partially_refunded", "refunded", "disputed"].includes(
      pendingPurchase.payment_status,
    )
  ) {
    return fail("checkout does not match its canonical pending purchase", pendingPurchase)
  }

  // Ownership is always cases.user_id — never Stripe metadata.user_id.
  const amount = product.amountSgd
  const currency = "SGD"

  let purchase: PurchaseRow
  try {
    purchase = await deps.upsertPaidPurchase({
      purchaseId: casePurchaseIdMeta,
      caseId,
      productCode: product.productCode,
      amount,
      currency,
      checkoutSessionId: input.sessionId,
      paymentIntentId: input.paymentIntentId,
      fulfilmentEventId: input.eventId,
      checkoutProductKey: product.checkoutKey,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "purchase upsert failed"
    return fail(message)
  }

  if (
    purchase.user_id !== caseRow.user_id ||
    purchase.id !== casePurchaseIdMeta ||
    purchase.case_id !== caseId ||
    purchase.product_code !== product.productCode ||
    purchase.provider_checkout_session_id !== input.sessionId
  ) {
    return fail("fulfilled purchase identity does not match checkout", purchase)
  }

  await deps.markLedger(ledger.id, {
    processing_status: ledger.processing_status,
    case_purchase_id: purchase.id,
    case_id: purchase.case_id,
  })

  try {
    for (const effect of sideEffectsForFulfilment(product.fulfilment)) {
      if (effect.type === "enqueue_report_job") {
        await deps.enqueueReportJob({
          caseId,
          userId: purchase.user_id,
          idempotencyKey: input.sessionId,
          paymentRowId,
        })
      } else if (effect.type === "upsert_escalation_pack_entitlement") {
        await deps.upsertEscalationPackEntitlement({
          caseId,
          purchaseRef: input.sessionId,
        })
      }
    }

    if (paymentRowId) {
      await deps.completeLegacyPayment({
        paymentRowId,
        caseId,
        ownerUserId: caseRow.user_id,
        amountSgd: product.amountSgd,
        currency: "SGD",
        serviceType: product.legacyServiceType,
        paymentIntentId: input.paymentIntentId,
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "fulfilment failed"
    return fail(message, purchase)
  }

  await deps.markLedger(ledger.id, {
    processing_status: "processed",
    error: null,
    case_purchase_id: purchase.id,
    case_id: purchase.case_id,
    processed_at: deps.nowIso(),
  })

  return {
    status: "processed",
    purchaseId: purchase.id,
    fulfilment: product.fulfilment,
  }
}
