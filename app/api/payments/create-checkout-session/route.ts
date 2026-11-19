import { NextResponse, type NextRequest } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { createServiceClient } from "@/lib/supabase/service"
import { establishCheckoutSession } from "@/lib/payments/checkout-session-orchestration"
import {
  PRODUCT_CATALOGUE,
  buildCheckoutSessionMetadata,
  resolveCheckoutRedirectOrigin,
  resolvePriceId,
  type CheckoutProductKey,
} from "@/lib/payments/product-catalogue"
import { loadProductReadiness, productSwitchedOn } from "@/lib/billing/product-readiness"
import { paidStagesAvailableFrom, paidStagesEnabled } from "@/lib/billing/paid-stages"
import { invalidFields, logRefusal } from "@/lib/server/refusal-log"
import { safeErrorText } from "@/lib/server/safe-error"

export type ProductKey = CheckoutProductKey

const checkoutSchema = z
  .object({
    caseId: z.string().uuid(),
    productKey: z.enum(["self_serve_report", "fidrec_tier2_pack", "human_consult_30m"]),
  })
  .strict()

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
    const rawBody = await request.json()
    if (rawBody && typeof rawBody === "object" && "user_id" in (rawBody as object)) {
      logRefusal("checkout", "body_user_id", 400)
      return NextResponse.json(
        { error: "Request body must not include user_id" },
        { status: 400 },
      )
    }

    let parsed
    try {
      parsed = checkoutSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        logRefusal("checkout", "invalid_body", 400, { fields: invalidFields(err) })
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      logRefusal("checkout", "invalid_body", 400)
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { caseId, productKey } = parsed
    const product = PRODUCT_CATALOGUE[productKey]
    if (!product.checkoutEnabled) {
      logRefusal("checkout", "checkout_disabled", 409, { productKey, caseId })
      return NextResponse.json({ error: "Product is not currently available" }, { status: 409 })
    }
    // Stage 1 (free evaluation only): both paid products are refused until stage 2 is switched on.
    if (!paidStagesEnabled()) {
      logRefusal("checkout", "product_not_available", 409, { productKey, caseId })
      return NextResponse.json(
        { error: "Product is not available yet", reason: "product_not_available", availableFrom: paidStagesAvailableFrom() },
        { status: 409 },
      )
    }

    const authHeader = request.headers.get("authorization")
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
    if (!bearer) {
      logRefusal("checkout", "missing_bearer_token", 401, { productKey, caseId })
      return NextResponse.json({ error: "Missing bearer token" }, { status: 401 })
    }

    const payload = decodeJwtPayload(bearer)
    const supabaseUuid = typeof payload?.supabase_uuid === "string" ? payload.supabase_uuid : null
    if (!supabaseUuid) {
      logRefusal("checkout", "token_without_profile", 401, { productKey, caseId })
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
    if (caseError || !caseData) {
      logRefusal("checkout", "case_not_found", 404, { productKey, caseId })
      return NextResponse.json({ error: "Case not found" }, { status: 404 })
    }
    if (!caseData.user_id) {
      logRefusal("checkout", "case_owner_missing", 409, { productKey, caseId })
      return NextResponse.json({ error: "Case owner is missing" }, { status: 409 })
    }
    if (caseData.user_id !== supabaseUuid) {
      logRefusal("checkout", "case_not_owned", 404, { productKey, caseId })
      return NextResponse.json({ error: "Case not found" }, { status: 404 })
    }

    const service = createServiceClient()

    // The stage 2 buying rules (lib/billing/product-readiness.ts); the buy buttons use the same check, and
    // reserve_checkout_purchase_v1 applies the database part again under its lock.
    if (productKey === "self_serve_report" || productKey === "fidrec_tier2_pack") {
      // The bank pack's own switch (BANK_PACK_ENABLED), on top of PAID_STAGES_ENABLED above.
      if (!productSwitchedOn(productKey)) {
        logRefusal("checkout", "product_not_available", 409, { productKey, caseId })
        return NextResponse.json({ error: "Product is not available yet", reason: "product_not_available" }, { status: 409 })
      }
      let readiness
      try {
        readiness = await loadProductReadiness(service, caseId, productKey)
      } catch (error) {
        console.error("[payments] Failed to check product readiness", safeErrorText(error))
        return NextResponse.json({ error: "Failed to create purchase record" }, { status: 500 })
      }
      // An existing purchase goes on to the reservation, which resumes a pending checkout or repairs fulfilment.
      if (!readiness.ready && readiness.reason !== "already_purchased") {
        logRefusal("checkout", readiness.reason ?? "not_ready", 409, { productKey, caseId })
        return NextResponse.json(
          {
            error: "Purchase is not eligible",
            reason: readiness.reason,
            ...(readiness.opensOn ? { opensOn: readiness.opensOn } : {}),
          },
          { status: 409 },
        )
      }
    }

    type CheckoutReservation = {
      case_purchase_id: string
      legacy_payment_id: string | null
      owner_user_id: string
      amount: number | string
      currency: string
      reservation_disposition: "created" | "resumed_pending" | "reconcile_established"
    }

    const { data: reservation, error: reservationError } = await service.rpc(
      "reserve_checkout_purchase_v1",
      {
        p_case_id: caseId,
        p_checkout_product_key: productKey,
        p_actor_profile_id: supabaseUuid,
      },
    )

    if (reservationError || !reservation) {
      // A readiness change between the check above and the reservation (for example a second tab buying first).
      const notReady = reservationError?.message.match(/not ready: ([a-z_]+)/)?.[1]
      if (notReady) {
        logRefusal("checkout", notReady, 409, { productKey, caseId })
        return NextResponse.json({ error: "Purchase is not eligible", reason: notReady }, { status: 409 })
      }
      if (
        reservationError?.message.includes("requires reconciliation") ||
        reservationError?.message.includes("active purchase")
      ) {
        logRefusal("checkout", "reservation_refused", 409, { productKey, caseId, code: reservationError?.code ?? null })
        return NextResponse.json({ error: "Purchase is not eligible" }, { status: 409 })
      }
      console.error("[payments] Failed to reserve checkout purchase", safeErrorText(reservationError))
      return NextResponse.json({ error: "Failed to create purchase record" }, { status: 500 })
    }

    const purchaseRow = (Array.isArray(reservation) ? reservation[0] : reservation) as CheckoutReservation
    if (
      !purchaseRow ||
      purchaseRow.owner_user_id !== caseData.user_id ||
      Number(purchaseRow.amount) !== product.amountSgd ||
      purchaseRow.currency !== "SGD"
    ) {
      console.error("[payments] Invalid checkout reservation")
      return NextResponse.json({ error: "Purchase reservation mismatch" }, { status: 500 })
    }

    if (purchaseRow.reservation_disposition === "reconcile_established") {
      const { data: reconciliation, error: reconciliationError } = await service.rpc(
        "reconcile_established_case_purchase_fulfilment_v1",
        {
          p_purchase_id: purchaseRow.case_purchase_id,
          p_actor_profile_id: supabaseUuid,
        },
      )

      if (reconciliationError || !reconciliation) {
        console.error("[payments] Established purchase reconciliation is required", safeErrorText(reconciliationError))
        logRefusal("checkout", "reconciliation_required", 409, { productKey, caseId })
        return NextResponse.json(
          {
            error: "Purchase fulfilment is pending reconciliation",
            code: "PURCHASE_RECONCILIATION_REQUIRED",
          },
          { status: 409 },
        )
      }

      return NextResponse.json({ reconciled: true })
    }

    if (
      !["created", "resumed_pending"].includes(purchaseRow.reservation_disposition) ||
      !purchaseRow.legacy_payment_id
    ) {
      console.error("[payments] Invalid resumable checkout reservation")
      return NextResponse.json({ error: "Purchase reservation mismatch" }, { status: 500 })
    }

    const legacyPaymentId = purchaseRow.legacy_payment_id
    const stripeSecret = process.env.STRIPE_SECRET_KEY
    const priceId = resolvePriceId(product)
    const checkoutOrigin = resolveCheckoutRedirectOrigin()
    if (!stripeSecret || !priceId || !checkoutOrigin) {
      console.error("[payments] Missing or invalid Stripe checkout configuration", {
        productKey,
        hasSecret: Boolean(stripeSecret),
        priceIdPresent: Boolean(priceId),
        priceEnvVar: product.priceEnvVar,
        checkoutOriginPresent: Boolean(checkoutOrigin),
      })
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
    }

    const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" })
    const result = await establishCheckoutSession(
      {
        createSession: async (idempotencyKey) => {
          try {
            const session = await stripe.checkout.sessions.create(
              {
                mode: "payment",
                payment_method_types: ["card"],
                client_reference_id: purchaseRow.case_purchase_id,
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${checkoutOrigin}/app/case/${caseId}/dashboard?checkout=success&product=${productKey}`,
                cancel_url: `${checkoutOrigin}/app/case/${caseId}/dashboard?checkout=cancel&product=${productKey}`,
                metadata: buildCheckoutSessionMetadata({
                  caseId,
                  product,
                  casePurchaseId: purchaseRow.case_purchase_id,
                  legacyPaymentId,
                  caseOwnerUserId: caseData.user_id,
                }),
              },
              { idempotencyKey },
            )
            return {
              id: session.id,
              status: session.status,
              url: session.url,
              paymentIntentId:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : session.payment_intent?.id ?? null,
            }
          } catch (stripeError) {
            console.error("[payments] Stripe checkout session creation is ambiguous", {
              error: stripeError instanceof Error ? stripeError.message : stripeError,
              priceId,
              appUrl: checkoutOrigin,
            })
            throw stripeError
          }
        },
        attachSession: async (session) => {
          const { data, error } = await service.rpc("attach_checkout_session_v1", {
            p_purchase_id: purchaseRow.case_purchase_id,
            p_legacy_payment_id: legacyPaymentId,
            p_actor_profile_id: supabaseUuid,
            p_checkout_session_id: session.id,
            p_payment_intent_id: session.paymentIntentId,
          })
          if (error || !data) {
            console.error("[payments] Failed to atomically attach Stripe Checkout session", safeErrorText(error))
            throw new Error(error?.message ?? "Checkout attachment failed")
          }
        },
        expireSession: async (sessionId) => {
          const expired = await stripe.checkout.sessions.expire(sessionId)
          return { status: expired.status }
        },
        cancelReservation: async (sessionId) => {
          const { error } = await service.rpc("cancel_checkout_reservation_v1", {
            p_purchase_id: purchaseRow.case_purchase_id,
            p_legacy_payment_id: legacyPaymentId,
            p_checkout_session_id: sessionId,
          })
          if (error) {
            console.error("[payments] Failed to atomically cancel expired reservation", safeErrorText(error))
            throw new Error(error.message)
          }
        },
      },
      purchaseRow.case_purchase_id,
    )

    if (result.status === "retryable") {
      return NextResponse.json(
        { error: "Checkout setup is pending reconciliation", retryable: true },
        { status: 503, headers: { "Retry-After": "3" } },
      )
    }
    if (result.status === "closed") {
      logRefusal("checkout", "session_closed", 409, { productKey, caseId })
      return NextResponse.json({ error: "Checkout session is no longer open" }, { status: 409 })
    }

    return NextResponse.json({ url: result.url })
  } catch (err) {
    console.error("[payments] create session error:", safeErrorText(err))
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
