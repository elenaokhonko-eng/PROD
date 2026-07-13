import { NextResponse, type NextRequest } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { createServiceClient } from "@/lib/supabase/service"
import {
  PRODUCT_CATALOGUE,
  type CheckoutProductKey,
} from "@/lib/payments/product-catalogue"

export type ProductKey = CheckoutProductKey

const checkoutSchema = z.object({
  caseId: z.string().uuid(),
  productKey: z.enum(["self_serve_report", "fidrec_tier2_pack", "human_consult_30m"]),
})

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const payloadPart = parts[1]
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
    const json = Buffer.from(padded, "base64").toString("utf8")
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

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

    const { caseId, productKey } = parsed
    const product = PRODUCT_CATALOGUE[productKey]

    const authHeader = request.headers.get("authorization")
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
    if (!bearer) {
      return NextResponse.json({ error: "Missing bearer token" }, { status: 401 })
    }

    const payload = decodeJwtPayload(bearer)
    const supabaseUuid = typeof payload?.supabase_uuid === "string" ? payload.supabase_uuid : null
    if (!supabaseUuid) {
      return NextResponse.json({ error: "Invalid token: missing supabase_uuid claim" }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    })

    // Pattern C ownership probe — never trust body user_id.
    const { data: caseData, error: caseError } = await userClient
      .from("cases")
      .select("id, user_id")
      .eq("id", caseId)
      .single()
    if (caseError || !caseData || caseData.user_id !== supabaseUuid) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 })
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY
    const priceId = process.env[product.priceEnvVar]
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!stripeSecret || !priceId) {
      console.error("[payments] Missing Stripe configuration", {
        productKey,
        hasSecret: Boolean(stripeSecret),
        priceIdPresent: Boolean(priceId),
        priceEnvVar: product.priceEnvVar,
      })
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
    }
    const normalizedAppUrl = appUrl
      ? appUrl.startsWith("http") ? appUrl : `https://${appUrl}`
      : "https://guidebuoyaisg.onrender.com"

    const service = createServiceClient()

    // Durable multi-SKU ledger. user_id is derived inside the RPC from cases.user_id.
    const { data: purchase, error: purchaseErr } = await service.rpc(
      "upsert_case_purchase_from_provider",
      {
        p_case_id: caseId,
        p_product_code: product.productCode,
        p_amount: product.amountSgd,
        p_currency: "SGD",
        p_payment_provider: "stripe",
        p_provider_checkout_session_id: null,
        p_provider_payment_intent_id: null,
        p_payment_status: "pending",
        p_purchased_by_profile_id: supabaseUuid,
        p_fulfilment_provider_event_id: null,
        p_paid_at: null,
        p_refunded_amount: null,
        p_disputed_at: null,
        p_cancelled_at: null,
        p_metadata: {
          checkout_product_key: productKey,
        },
        p_actor_profile_id: supabaseUuid,
      },
    )

    if (purchaseErr || !purchase) {
      console.error("[payments] Failed to create case_purchase", purchaseErr)
      return NextResponse.json({ error: "Failed to create purchase record" }, { status: 500 })
    }

    const purchaseId = (purchase as { id: string }).id

    // Legacy payments dual-write (transition). Pattern C: use cases.user_id.
    const { data: legacyPayment, error: paymentInsertError } = await service
      .from("payments")
      .insert({
        user_id: caseData.user_id,
        case_id: caseId,
        amount: product.amountSgd,
        currency: "SGD",
        service_type: product.legacyServiceType,
        payment_status: "pending",
      })
      .select("id")
      .single()
    if (paymentInsertError || !legacyPayment) {
      console.error("[payments] Failed to insert legacy payment", paymentInsertError)
      return NextResponse.json({ error: "Failed to create payment record" }, { status: 500 })
    }

    const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" })

    let session: Stripe.Checkout.Session
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${normalizedAppUrl}/app/case/${caseId}/dashboard?checkout=success&product=${productKey}`,
        cancel_url: `${normalizedAppUrl}/app/case/${caseId}/dashboard?checkout=cancel&product=${productKey}`,
        metadata: {
          case_id: caseId,
          product_key: productKey,
          product_code: product.productCode,
          case_purchase_id: purchaseId,
          payment_row_id: legacyPayment.id,
          // Denormalized for Stripe dashboards only — ownership is cases.user_id.
          user_id: caseData.user_id,
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

    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : null

    const { error: purchaseUpdateErr } = await service
      .from("case_purchases")
      .update({
        provider_checkout_session_id: session.id,
        provider_payment_intent_id: paymentIntentId,
        updated_by_profile_id: supabaseUuid,
      })
      .eq("id", purchaseId)

    if (purchaseUpdateErr) {
      console.error("[payments] Failed to attach Stripe session to case_purchase", purchaseUpdateErr)
    }

    const { error: legacyUpdateErr } = await service
      .from("payments")
      .update({ stripe_payment_intent_id: paymentIntentId })
      .eq("id", legacyPayment.id)

    if (legacyUpdateErr) {
      console.error("[payments] Failed to store stripe payment intent id", legacyUpdateErr)
    }

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error("[payments] create session error:", err)
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
