export type PaymentLifecycleEventType = "charge.refunded" | "charge.dispute.created"

export type PaymentLifecycleLedgerRow = {
  id: string
  event_type: PaymentLifecycleEventType
  payload: Record<string, unknown>
}

export type PaymentLifecyclePurchase = {
  id: string
  case_id: string
}

type LedgerPatch = {
  case_purchase_id?: string
  case_id?: string
  processing_status?: "processed" | "failed"
  error: string | null
  processed_at?: string
}

export interface PaymentLifecycleReconciliationDeps {
  loadPurchase: (paymentIntentId: string) => Promise<PaymentLifecyclePurchase | null>
  loadEvents: (paymentIntentId: string) => Promise<PaymentLifecycleLedgerRow[]>
  markLedger: (ledgerId: string, patch: LedgerPatch) => Promise<void>
  recordRefund: (args: {
    purchaseId: string
    paymentIntentId: string
    refundedAmount: number
    currency: string
  }) => Promise<void>
  recordDispute: (args: {
    purchaseId: string
    paymentIntentId: string
    disputedAt: string
  }) => Promise<void>
  nowIso: () => string
}

export async function reconcilePaymentLifecycleEvents(
  deps: PaymentLifecycleReconciliationDeps,
  paymentIntentId: string,
): Promise<void> {
  const [purchase, lifecycleEvents] = await Promise.all([
    deps.loadPurchase(paymentIntentId),
    deps.loadEvents(paymentIntentId),
  ])

  for (const ledger of lifecycleEvents) {
    if (!purchase) {
      await deps.markLedger(ledger.id, { error: "Awaiting canonical Checkout completion" })
      continue
    }

    const markFinished = async (processingStatus: "processed" | "failed", error: string | null) => {
      await deps.markLedger(ledger.id, {
        case_purchase_id: purchase.id,
        case_id: purchase.case_id,
        processing_status: processingStatus,
        error,
        processed_at: deps.nowIso(),
      })
    }

    if (ledger.event_type === "charge.refunded") {
      const amountRefundedCents = ledger.payload.amount_refunded
      const currency = ledger.payload.currency
      if (
        typeof amountRefundedCents !== "number" ||
        !Number.isSafeInteger(amountRefundedCents) ||
        amountRefundedCents < 0 ||
        typeof currency !== "string" ||
        !currency
      ) {
        await markFinished("failed", "Invalid refund lifecycle payload")
        continue
      }

      await deps.recordRefund({
        purchaseId: purchase.id,
        paymentIntentId,
        refundedAmount: amountRefundedCents / 100,
        currency,
      })
      await markFinished("processed", null)
      continue
    }

    const disputedAt = ledger.payload.disputed_at
    if (typeof disputedAt !== "string" || !disputedAt) {
      await markFinished("failed", "Invalid dispute lifecycle payload")
      continue
    }

    await deps.recordDispute({
      purchaseId: purchase.id,
      paymentIntentId,
      disputedAt,
    })
    await markFinished("processed", null)
  }
}
