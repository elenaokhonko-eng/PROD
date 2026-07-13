import type { ProductDefinition, ProductFulfilment } from "@/lib/payments/product-catalogue"
import {
  assertRequiredCheckoutMetadata,
  requireCheckoutProduct,
} from "@/lib/payments/product-catalogue"

export type FulfilmentSideEffect =
  | { type: "enqueue_report_job" }
  | { type: "upsert_escalation_pack_entitlement" }
  | { type: "create_consultation"; durationMinutes: number }
  | { type: "none" }

export function sideEffectsForFulfilment(
  fulfilment: ProductFulfilment,
  product: ProductDefinition,
): FulfilmentSideEffect[] {
  switch (fulfilment) {
    case "self_serve_report_job":
      return [{ type: "enqueue_report_job" }]
    case "escalation_pack_entitlement":
      return [{ type: "upsert_escalation_pack_entitlement" }]
    case "human_consult_allocation":
      return [
        {
          type: "create_consultation",
          durationMinutes: product.defaultDurationMinutes ?? 30,
        },
      ]
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
  amountTotalCents: number | null
  currency: string | null
  paymentIntentId: string | null
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
  completeLegacyPayment: (paymentRowId: string) => Promise<void>
  loadCase: (caseId: string) => Promise<CaseRow | null>
  upsertPaidPurchase: (args: {
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
  createConsultation: (args: {
    purchaseId: string
    durationMinutes: number
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
  const casePurchaseIdMeta = input.metadata!.case_purchase_id ?? null

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

  if (paymentRowId) {
    await deps.completeLegacyPayment(paymentRowId)
  }

  const caseRow = await deps.loadCase(caseId)
  if (!caseRow) {
    const reason = `case ${caseId} not found`
    await deps.markLedger(ledger.id, {
      processing_status: "failed",
      error: reason,
      processed_at: deps.nowIso(),
    })
    return { status: "failed", error: reason }
  }
  if (!caseRow.user_id) {
    const reason = `case ${caseId} has null user_id`
    await deps.markLedger(ledger.id, {
      processing_status: "failed",
      error: reason,
      processed_at: deps.nowIso(),
    })
    return { status: "failed", error: reason }
  }

  // Ownership is always cases.user_id — never Stripe metadata.user_id.
  const amount =
    input.amountTotalCents != null
      ? input.amountTotalCents / 100
      : product.amountSgd
  const currency = (input.currency ?? "sgd").toUpperCase()

  let purchase: PurchaseRow
  try {
    purchase = await deps.upsertPaidPurchase({
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
    await deps.markLedger(ledger.id, {
      processing_status: "failed",
      error: message,
      processed_at: deps.nowIso(),
    })
    return { status: "failed", error: message }
  }

  if (purchase.user_id !== caseRow.user_id) {
    const reason = "purchase.user_id does not match cases.user_id"
    await deps.markLedger(ledger.id, {
      processing_status: "failed",
      error: reason,
      case_purchase_id: purchase.id,
      case_id: purchase.case_id,
      processed_at: deps.nowIso(),
    })
    return { status: "failed", error: reason }
  }

  await deps.markLedger(ledger.id, {
    processing_status: ledger.processing_status,
    case_purchase_id: purchase.id,
    case_id: purchase.case_id,
  })

  try {
    for (const effect of sideEffectsForFulfilment(product.fulfilment, product)) {
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
      } else if (effect.type === "create_consultation") {
        await deps.createConsultation({
          purchaseId: purchase.id,
          durationMinutes: effect.durationMinutes,
        })
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "fulfilment failed"
    await deps.markLedger(ledger.id, {
      processing_status: "failed",
      error: message,
      case_purchase_id: purchase.id,
      case_id: purchase.case_id,
      processed_at: deps.nowIso(),
    })
    return { status: "failed", error: message }
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
