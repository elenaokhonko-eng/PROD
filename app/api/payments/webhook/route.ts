import { NextResponse, type NextRequest } from "next/server"
import Stripe from "stripe"
import { createServiceClient } from "@/lib/supabase/service"
import { fulfilCheckoutSessionCompleted } from "@/lib/payments/fulfil-checkout-session"
import { reconcilePaymentLifecycleEvents as reconcilePaymentLifecycle } from "@/lib/payments/reconcile-payment-lifecycle"

export const dynamic = "force-dynamic"

async function reconcilePaymentLifecycleEvents(
  supabase: ReturnType<typeof createServiceClient>,
  paymentIntentId: string,
): Promise<void> {
  await reconcilePaymentLifecycle(
    {
      loadPurchase: async (intentId) => {
        const { data, error } = await supabase
          .from("case_purchases")
          .select("id, case_id")
          .eq("provider_payment_intent_id", intentId)
          .maybeSingle()
        if (error) throw new Error(error.message)
        return data
      },
      loadEvents: async (intentId) => {
        const { data, error } = await supabase
          .from("payment_webhook_events")
          .select("id, event_type, payload")
          .in("event_type", ["charge.refunded", "charge.dispute.created"])
          .in("processing_status", ["received", "failed"])
          .contains("payload", { payment_intent_id: intentId })
          .order("created_at", { ascending: true })
        if (error) throw new Error(error.message)
        return (data ?? []) as Array<{
          id: string
          event_type: "charge.refunded" | "charge.dispute.created"
          payload: Record<string, unknown>
        }>
      },
      markLedger: async (ledgerId, patch) => {
        const { error } = await supabase
          .from("payment_webhook_events")
          .update(patch)
          .eq("id", ledgerId)
        if (error) throw new Error(error.message)
      },
      recordRefund: async (args) => {
        const { error } = await supabase.rpc("record_case_purchase_refund_v1", {
          p_purchase_id: args.purchaseId,
          p_payment_intent_id: args.paymentIntentId,
          p_refunded_amount: args.refundedAmount,
          p_currency: args.currency,
        })
        if (error) throw new Error(error.message)
      },
      recordDispute: async (args) => {
        const { error } = await supabase.rpc("record_case_purchase_dispute_v1", {
          p_purchase_id: args.purchaseId,
          p_payment_intent_id: args.paymentIntentId,
          p_disputed_at: args.disputedAt,
        })
        if (error) throw new Error(error.message)
      },
      nowIso: () => new Date().toISOString(),
    },
    paymentIntentId,
  )
}

export async function POST(request: NextRequest) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeSecret || !webhookSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" })

  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return new NextResponse("Missing stripe-signature header", { status: 400 })
  }

  const buf = await request.arrayBuffer()
  const rawBody = Buffer.from(buf).toString("utf8")

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error("[payments] webhook signature error:", err)
    return new NextResponse("Invalid signature", { status: 400 })
  }

  try {
    const supabase = createServiceClient()
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null

        const result = await fulfilCheckoutSessionCompleted(
          {
            recordWebhookEvent: async (args) => {
              const { data, error } = await supabase.rpc("record_payment_webhook_event", {
                p_payment_provider: "stripe",
                p_provider_event_id: args.providerEventId,
                p_event_type: args.eventType,
                p_case_purchase_id: args.casePurchaseId,
                p_case_id: args.caseId,
                p_processing_status: args.processingStatus,
                p_payload: args.payload,
                p_error: null,
              })
              if (error || !data) {
                throw new Error(error?.message ?? "record_payment_webhook_event failed")
              }
              return data as { id: string; processing_status: string }
            },
            markLedger: async (ledgerId, patch) => {
              const { error } = await supabase
                .from("payment_webhook_events")
                .update(patch)
                .eq("id", ledgerId)
              if (error) throw new Error(error.message)
            },
            completeLegacyPayment: async (args) => {
              const { data, error } = await supabase.rpc("complete_legacy_payment_v1", {
                p_payment_id: args.paymentRowId,
                p_case_id: args.caseId,
                p_owner_user_id: args.ownerUserId,
                p_amount: args.amountSgd,
                p_currency: args.currency,
                p_service_type: args.serviceType,
                p_payment_intent_id: args.paymentIntentId,
              })
              if (error || !data) {
                throw new Error(error?.message ?? "legacy payment identity mismatch")
              }
            },
            loadCase: async (caseId) => {
              const { data, error } = await supabase
                .from("cases")
                .select("id, user_id")
                .eq("id", caseId)
                .maybeSingle()
              if (error) throw new Error(error.message)
              return data
            },
            loadPurchase: async (args) => {
              const { data, error } = await supabase
                .from("case_purchases")
                .select(
                  "id, user_id, case_id, product_code, payment_status, amount, currency, provider_checkout_session_id, fulfilment_provider_event_id",
                )
                .eq("id", args.purchaseId)
                .maybeSingle()
              if (error) throw new Error(error.message)
              return data
            },
            upsertPaidPurchase: async (args) => {
              const { data, error } = await supabase.rpc("mark_case_purchase_paid_v1", {
                p_purchase_id: args.purchaseId,
                p_case_id: args.caseId,
                p_product_code: args.productCode,
                p_amount: args.amount,
                p_currency: args.currency,
                p_checkout_session_id: args.checkoutSessionId,
                p_payment_intent_id: args.paymentIntentId,
                p_fulfilment_event_id: args.fulfilmentEventId,
                p_metadata: {
                  checkout_product_key: args.checkoutProductKey,
                  stripe_event_id: args.fulfilmentEventId,
                },
              })
              if (error || !data) {
                throw new Error(error?.message ?? "upsert_case_purchase_from_provider failed")
              }
              return data as {
                id: string
                user_id: string
                case_id: string
                product_code: string
                payment_status: string
              }
            },
            enqueueReportJob: async (args) => {
              const { error } = await supabase.rpc("enqueue_post_payment_report_generation", {
                p_case_id: args.caseId,
                p_user_id: args.userId,
                p_idempotency_key: args.idempotencyKey,
                p_payment_row_id: args.paymentRowId,
              })
              if (error) throw new Error(error.message)
            },
            upsertEscalationPackEntitlement: async (args) => {
              const { error } = await supabase.rpc("grant_fidrec_pack_capability_v1", {
                p_case_id: args.caseId,
                p_purchase_ref: args.purchaseRef,
              })
              if (error) throw new Error(error.message)
            },
            nowIso: () => new Date().toISOString(),
          },
          {
            eventId: event.id,
            sessionId: session.id,
            mode: session.mode,
            paymentStatus: session.payment_status,
            amountTotalCents: session.amount_total,
            currency: session.currency,
            paymentIntentId,
            clientReferenceId: session.client_reference_id,
            metadata: session.metadata,
          },
        )

        if (result.status === "failed") {
          console.error("[payments] checkout fulfilment failed:", result.error)
          return new NextResponse("Webhook handler failed", { status: 500 })
        }
        if (
          paymentIntentId &&
          (result.status === "processed" || result.status === "duplicate")
        ) {
          await reconcilePaymentLifecycleEvents(supabase, paymentIntentId)
        }

        break
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent
        const { error } = await supabase.rpc("record_payment_webhook_event", {
          p_payment_provider: "stripe",
          p_provider_event_id: event.id,
          p_event_type: event.type,
          p_case_purchase_id: null,
          p_case_id: null,
          p_processing_status: "processed",
          p_payload: { payment_intent_id: pi.id },
          p_error: null,
        })
        if (error) throw new Error(error.message)
        break
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session
        const { data: ledger, error: ledgerError } = await supabase.rpc("record_payment_webhook_event", {
          p_payment_provider: "stripe",
          p_provider_event_id: event.id,
          p_event_type: event.type,
          p_case_purchase_id: session.metadata?.case_purchase_id ?? null,
          p_case_id: session.metadata?.case_id ?? null,
          p_processing_status: "received",
          p_payload: { session_id: session.id },
          p_error: null,
        })
        if (ledgerError || !ledger) {
          throw new Error(ledgerError?.message ?? "Failed to record expired Checkout session")
        }

        const paymentRowId = session.metadata?.payment_row_id
        const casePurchaseId = session.metadata?.case_purchase_id
        if (paymentRowId && casePurchaseId) {
          const { error } = await supabase.rpc("cancel_checkout_reservation_v1", {
            p_purchase_id: casePurchaseId,
            p_legacy_payment_id: paymentRowId,
            p_checkout_session_id: session.id,
          })
          if (error) throw new Error(error.message)
        }

        const ledgerId = (ledger as { id?: string }).id
        if (!ledgerId) throw new Error("Expired Checkout ledger has no id")
        const { error: processedError } = await supabase
          .from("payment_webhook_events")
          .update({
            processing_status: "processed",
            error: null,
            processed_at: new Date().toISOString(),
          })
          .eq("id", ledgerId)
        if (processedError) throw new Error(processedError.message)
        break
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null
        const { error } = await supabase.rpc("record_payment_webhook_event", {
          p_payment_provider: "stripe",
          p_provider_event_id: event.id,
          p_event_type: event.type,
          p_case_purchase_id: null,
          p_case_id: null,
          p_processing_status: paymentIntentId ? "received" : "ignored",
          p_payload: {
            charge_id: charge.id,
            payment_intent_id: paymentIntentId,
            amount_refunded: charge.amount_refunded,
            currency: charge.currency,
          },
          p_error: paymentIntentId ? null : "Refunded charge has no PaymentIntent",
        })
        if (error) throw new Error(error.message)
        if (paymentIntentId) {
          await reconcilePaymentLifecycleEvents(supabase, paymentIntentId)
        }
        break
      }
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute
        const paymentIntentId =
          typeof dispute.payment_intent === "string"
            ? dispute.payment_intent
            : dispute.payment_intent?.id ?? null
        const { error } = await supabase.rpc("record_payment_webhook_event", {
          p_payment_provider: "stripe",
          p_provider_event_id: event.id,
          p_event_type: event.type,
          p_case_purchase_id: null,
          p_case_id: null,
          p_processing_status: paymentIntentId ? "received" : "ignored",
          p_payload: {
            dispute_id: dispute.id,
            charge_id: typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id,
            payment_intent_id: paymentIntentId,
            disputed_at: new Date(event.created * 1000).toISOString(),
            amount: dispute.amount,
            currency: dispute.currency,
          },
          p_error: paymentIntentId ? null : "Dispute has no PaymentIntent",
        })
        if (error) throw new Error(error.message)
        if (paymentIntentId) {
          await reconcilePaymentLifecycleEvents(supabase, paymentIntentId)
        }
        break
      }
      default:
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error("[payments] webhook handler error:", err)
    return new NextResponse("Webhook handler failed", { status: 500 })
  }
}
