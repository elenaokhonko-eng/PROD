import { NextResponse, type NextRequest } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/supabase/server"

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
    const supabase = await createClient()

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const caseId = session.metadata?.case_id
        const userId = session.metadata?.user_id
        const paymentRowId = session.metadata?.payment_row_id
        const productKey = session.metadata?.product_key ?? "self_serve_report"

        if (paymentRowId) {
          await supabase
            .from("payments")
            .update({ payment_status: "completed" })
            .eq("id", paymentRowId)
        }

        if (!caseId || !userId) {
          break
        }

        if (productKey === "fidrec_tier2_pack") {
          // Slice 8: Tier 2 pack upgrades entitlement but never enqueues Layer 2.
          const { error: entitlementErr } = await supabase
            .from("case_entitlements")
            .upsert(
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
            return new NextResponse("Webhook handler failed", { status: 500 })
          }
        } else if (productKey === "human_consult_30m") {
          // Slice 8: consult purchase is persisted on the payment row only.
          // No entitlement change and no Layer 2 job.
          // eslint-disable-next-line no-empty
        } else {
          // Slice 6: self-serve report. One transaction upgrades the entitlement
          // and enqueues the background job. Stripe may redeliver events, so
          // session.id is the idempotency key that prevents duplicate jobs.
          const { error: enqueueErr } = await supabase.rpc(
            "enqueue_post_payment_report_generation",
            {
              p_case_id: caseId,
              p_user_id: userId,
              p_idempotency_key: session.id,
              p_payment_row_id: paymentRowId ?? null,
            },
          )

          if (enqueueErr) {
            console.error("[payments] post-payment enqueue failed:", enqueueErr)
            return new NextResponse("Webhook handler failed", { status: 500 })
          }
        }
        break
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent
        await supabase
          .from("payments")
          .update({ payment_status: "completed" })
          .eq("stripe_payment_intent_id", pi.id)
        break
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session
        const paymentRowId = session.metadata?.payment_row_id
        if (paymentRowId) {
          await supabase
            .from("payments")
            .update({ payment_status: "failed" })
            .eq("id", paymentRowId)
        }
        break
      }
      default:
        // Ignore other events for MVP
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error("[payments] webhook handler error:", err)
    return new NextResponse("Webhook handler failed", { status: 500 })
  }
}
