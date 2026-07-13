import { NextResponse, type NextRequest } from "next/server"
import Stripe from "stripe"
import { createServiceClient } from "@/lib/supabase/service"
import { resolveCheckoutProduct } from "@/lib/payments/product-catalogue"

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
        const caseId = session.metadata?.case_id
        const paymentRowId = session.metadata?.payment_row_id
        const casePurchaseIdMeta = session.metadata?.case_purchase_id
        const product = resolveCheckoutProduct(session.metadata?.product_key)

        // Idempotent webhook ledger (all event types go here eventually).
        const { data: ledgerRow, error: ledgerErr } = await supabase.rpc(
          "record_payment_webhook_event",
          {
            p_payment_provider: "stripe",
            p_provider_event_id: event.id,
            p_event_type: event.type,
            p_case_purchase_id: casePurchaseIdMeta ?? null,
            p_case_id: caseId ?? null,
            p_processing_status: "received",
            p_payload: {
              session_id: session.id,
              product_key: product.checkoutKey,
              product_code: product.productCode,
            },
            p_error: null,
          },
        )

        if (ledgerErr) {
          console.error("[payments] webhook ledger insert failed:", ledgerErr)
          return new NextResponse("Webhook handler failed", { status: 500 })
        }

        const ledger = ledgerRow as { id: string; processing_status: string } | null
        if (ledger?.processing_status === "processed") {
          return NextResponse.json({ received: true, duplicate: true })
        }

        if (paymentRowId) {
          await supabase
            .from("payments")
            .update({ payment_status: "completed" })
            .eq("id", paymentRowId)
        }

        if (!caseId) {
          await supabase
            .from("payment_webhook_events")
            .update({
              processing_status: "ignored",
              error: "missing case_id metadata",
              processed_at: new Date().toISOString(),
            })
            .eq("id", ledger?.id)
          break
        }

        const paymentIntentId =
          typeof session.payment_intent === "string" ? session.payment_intent : null

        const { data: purchase, error: purchaseErr } = await supabase.rpc(
          "upsert_case_purchase_from_provider",
          {
            p_case_id: caseId,
            p_product_code: product.productCode,
            p_amount: (session.amount_total ?? product.amountSgd * 100) / 100,
            p_currency: (session.currency ?? "sgd").toUpperCase(),
            p_payment_provider: "stripe",
            p_provider_checkout_session_id: session.id,
            p_provider_payment_intent_id: paymentIntentId,
            p_payment_status: "paid",
            p_purchased_by_profile_id: null,
            p_fulfilment_provider_event_id: event.id,
            p_paid_at: new Date().toISOString(),
            p_refunded_amount: null,
            p_disputed_at: null,
            p_cancelled_at: null,
            p_metadata: {
              checkout_product_key: product.checkoutKey,
              stripe_event_id: event.id,
            },
            p_actor_profile_id: null,
          },
        )

        if (purchaseErr || !purchase) {
          console.error("[payments] case_purchase upsert failed:", purchaseErr)
          await supabase
            .from("payment_webhook_events")
            .update({
              processing_status: "failed",
              error: purchaseErr?.message ?? "purchase upsert failed",
              processed_at: new Date().toISOString(),
            })
            .eq("id", ledger?.id)
          return new NextResponse("Webhook handler failed", { status: 500 })
        }

        const purchaseRow = purchase as { id: string; user_id: string; case_id: string }

        await supabase
          .from("payment_webhook_events")
          .update({
            case_purchase_id: purchaseRow.id,
            case_id: purchaseRow.case_id,
          })
          .eq("id", ledger?.id)

        if (product.fulfilment === "escalation_pack_entitlement") {
          // Tier 2 pack: software entitlement only. Never enqueue report job.
          const { error: entitlementErr } = await supabase.from("case_entitlements").upsert(
            {
              case_id: caseId,
              plan: "escalation_pack",
              features: { allow_escalation_pack: true },
              source: "stripe",
              purchase_ref: session.id,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "case_id" },
          )

          if (entitlementErr) {
            console.error("[payments] Tier 2 entitlement upgrade failed:", entitlementErr)
            await supabase
              .from("payment_webhook_events")
              .update({
                processing_status: "failed",
                error: entitlementErr.message,
                processed_at: new Date().toISOString(),
              })
              .eq("id", ledger?.id)
            return new NextResponse("Webhook handler failed", { status: 500 })
          }
        } else if (product.fulfilment === "human_consult_allocation") {
          // Consult: allocate consultation. Never mutate case_entitlements / report job.
          const { error: consultErr } = await supabase.rpc(
            "create_consultation_from_paid_purchase",
            {
              p_purchase_id: purchaseRow.id,
              p_duration_minutes: product.defaultDurationMinutes ?? 30,
              p_actor_profile_id: null,
              p_actor_type: "system",
            },
          )

          if (consultErr) {
            console.error("[payments] consult allocation failed:", consultErr)
            await supabase
              .from("payment_webhook_events")
              .update({
                processing_status: "failed",
                error: consultErr.message,
                processed_at: new Date().toISOString(),
              })
              .eq("id", ledger?.id)
            return new NextResponse("Webhook handler failed", { status: 500 })
          }
        } else {
          // self_serve_report: entitlement + report job. Owner from cases via enqueue RPC args.
          // Prefer derived purchase.user_id over Stripe metadata user_id.
          const { error: enqueueErr } = await supabase.rpc(
            "enqueue_post_payment_report_generation",
            {
              p_case_id: caseId,
              p_user_id: purchaseRow.user_id,
              p_idempotency_key: session.id,
              p_payment_row_id: paymentRowId ?? null,
            },
          )

          if (enqueueErr) {
            console.error("[payments] post-payment enqueue failed:", enqueueErr)
            await supabase
              .from("payment_webhook_events")
              .update({
                processing_status: "failed",
                error: enqueueErr.message,
                processed_at: new Date().toISOString(),
              })
              .eq("id", ledger?.id)
            return new NextResponse("Webhook handler failed", { status: 500 })
          }
        }

        await supabase
          .from("payment_webhook_events")
          .update({
            processing_status: "processed",
            processed_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", ledger?.id)

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
        // Ledger-only for now; purchase status updates can be added without
        // changing fulfilment_provider_event_id semantics.
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
