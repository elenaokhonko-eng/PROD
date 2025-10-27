import { NextResponse, type NextRequest } from "next/server"
import Stripe from "stripe"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const checkoutSchema = z.object({
  caseId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  try {
    let parsed
    try {
      parsed = checkoutSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { caseId } = parsed

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Validate case ownership or access
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("id, owner_user_id, creator_user_id")
      .eq("id", caseId)
      .single()
    if (caseError || !caseData) return NextResponse.json({ error: "Case not found" }, { status: 404 })
    const isOwner = caseData.owner_user_id === user.id || caseData.creator_user_id === user.id
    if (!isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const stripeSecret = process.env.STRIPE_SECRET_KEY
    const priceId = process.env.STRIPE_PRICE_ID_SGD
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!stripeSecret || !priceId) {
      console.error("[payments] Missing Stripe configuration", {
        hasSecret: Boolean(stripeSecret),
        priceIdPresent: Boolean(priceId),
      })
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
    }
    const normalizedAppUrl = appUrl
      ? appUrl.startsWith("http") ? appUrl : `https://${appUrl}`
      : "https://guidebuoyaisg.onrender.com"

    const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" })

    // Create or reuse a pending payment record
    const { data: payment, error: paymentInsertError } = await supabase
      .from("payments")
      .insert({
        user_id: user.id,
        case_id: caseId,
        amount: 99,
        currency: "SGD",
        service_type: "standard",
        payment_status: "pending",
      })
      .select()
      .single()
    if (paymentInsertError || !payment) {
      console.error("[payments] Failed to insert pending payment", paymentInsertError)
      return NextResponse.json({ error: "Failed to create payment record" }, { status: 500 })
    }

    let session: Stripe.Checkout.Session
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${normalizedAppUrl}/app/case/${caseId}/dashboard?checkout=success`,
        cancel_url: `${normalizedAppUrl}/app/case/${caseId}/dashboard?checkout=cancel`,
        metadata: {
          case_id: caseId,
          user_id: user.id,
          payment_row_id: payment.id,
        },
      })
    } catch (stripeError) {
      console.error("[payments] Stripe checkout session creation failed", {
        error: stripeError instanceof Error ? stripeError.message : stripeError,
        priceId,
        appUrl: normalizedAppUrl,
      })
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
    }

    // Store Stripe checkout session ID
    const { error: updateError } = await supabase
      .from("payments")
      .update({ stripe_payment_intent_id: session.payment_intent as string })
      .eq("id", payment.id)
    if (updateError) {
      console.error("[payments] Failed to store stripe payment intent id", updateError, {
        paymentId: payment.id,
        sessionPaymentIntent: session.payment_intent,
      })
    }

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error("[payments] create session error:", err)
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
