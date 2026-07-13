import { NextResponse, type NextRequest } from "next/server"
import Stripe from "stripe"
import { createServiceClient } from "@/lib/supabase/service"
import { fulfilCheckoutSessionCompleted } from "@/lib/payments/fulfil-checkout-session"

export const dynamic = "force-dynamic"

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
          typeof session.payment_intent === "string" ? session.payment_intent : null

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
            completeLegacyPayment: async (paymentRowId) => {
              const { error } = await supabase
                .from("payments")
                .update({ payment_status: "completed" })
                .eq("id", paymentRowId)
              if (error) throw new Error(error.message)
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
            upsertPaidPurchase: async (args) => {
              const { data, error } = await supabase.rpc("upsert_case_purchase_from_provider", {
                p_case_id: args.caseId,
                p_product_code: args.productCode,
                p_amount: args.amount,
                p_currency: args.currency,
                p_payment_provider: "stripe",
                p_provider_checkout_session_id: args.checkoutSessionId,
                p_provider_payment_intent_id: args.paymentIntentId,
                p_payment_status: "paid",
                p_purchased_by_profile_id: null,
                p_fulfilment_provider_event_id: args.fulfilmentEventId,
                p_paid_at: new Date().toISOString(),
                p_refunded_amount: null,
                p_disputed_at: null,
                p_cancelled_at: null,
                p_metadata: {
                  checkout_product_key: args.checkoutProductKey,
                  stripe_event_id: args.fulfilmentEventId,
                },
                p_actor_profile_id: null,
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
              const { error } = await supabase.from("case_entitlements").upsert(
                {
                  case_id: args.caseId,
                  plan: "escalation_pack",
                  features: { allow_escalation_pack: true },
                  source: "stripe",
                  purchase_ref: args.purchaseRef,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "case_id" },
              )
              if (error) throw new Error(error.message)
            },
            createConsultation: async (args) => {
              const { error } = await supabase.rpc("create_consultation_from_paid_purchase", {
                p_purchase_id: args.purchaseId,
                p_duration_minutes: args.durationMinutes,
                p_actor_profile_id: null,
                p_actor_type: "system",
              })
              if (error) throw new Error(error.message)
            },
            nowIso: () => new Date().toISOString(),
          },
          {
            eventId: event.id,
            sessionId: session.id,
            amountTotalCents: session.amount_total,
            currency: session.currency,
            paymentIntentId,
            metadata: session.metadata,
          },
        )

        if (result.status === "failed") {
          console.error("[payments] checkout fulfilment failed:", result.error)
          return new NextResponse("Webhook handler failed", { status: 500 })
        }

        break
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent
        await supabase.rpc("record_payment_webhook_event", {
          p_payment_provider: "stripe",
          p_provider_event_id: event.id,
          p_event_type: event.type,
          p_case_purchase_id: null,
          p_case_id: null,
          p_processing_status: "processed",
          p_payload: { payment_intent_id: pi.id },
          p_error: null,
        })
        await supabase
          .from("payments")
          .update({ payment_status: "completed" })
          .eq("stripe_payment_intent_id", pi.id)
        break
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session
        await supabase.rpc("record_payment_webhook_event", {
          p_payment_provider: "stripe",
          p_provider_event_id: event.id,
          p_event_type: event.type,
          p_case_purchase_id: session.metadata?.case_purchase_id ?? null,
          p_case_id: session.metadata?.case_id ?? null,
          p_processing_status: "processed",
          p_payload: { session_id: session.id },
          p_error: null,
        })
        const paymentRowId = session.metadata?.payment_row_id
        if (paymentRowId) {
          await supabase
            .from("payments")
            .update({ payment_status: "failed" })
            .eq("id", paymentRowId)
        }
        if (session.metadata?.case_purchase_id) {
          await supabase
            .from("case_purchases")
            .update({
              payment_status: "cancelled",
              cancelled_at: new Date().toISOString(),
            })
            .eq("id", session.metadata.case_purchase_id)
            .eq("payment_status", "pending")
        }
        break
      }
      case "charge.refunded":
      case "charge.dispute.created": {
        await supabase.rpc("record_payment_webhook_event", {
          p_payment_provider: "stripe",
          p_provider_event_id: event.id,
          p_event_type: event.type,
          p_case_purchase_id: null,
          p_case_id: null,
          p_processing_status: "received",
          p_payload: event.data.object as unknown as Record<string, unknown>,
          p_error: null,
        })
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
