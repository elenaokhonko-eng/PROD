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

        if (paymentRowId) {
          await supabase
            .from("payments")
            .update({ payment_status: "completed" })
            .eq("id", paymentRowId)
        }

        if (caseId && userId) {
          // Optional: mark case as unlocked or update status
          await supabase
            .from("cases")
            .update({ status: "intake", updated_at: new Date().toISOString() })
            .eq("id", caseId)
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
