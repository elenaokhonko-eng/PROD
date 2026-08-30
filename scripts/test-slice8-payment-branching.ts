/**
 * Slice 8 Step 4 — product checkout / webhook branching tests.
 *
 * Run: pnpm test:slice8-payments
 * Uses Node's built-in test runner (no vitest/jest dependency).
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  CHECKOUT_PRODUCT_KEYS,
  PAYMENT_IDEMPOTENCY,
  PRODUCT_CATALOGUE,
  REQUIRED_CHECKOUT_METADATA_KEYS,
  assertRequiredCheckoutMetadata,
  buildCheckoutSessionMetadata,
  isCheckoutProductKey,
  requireCheckoutProduct,
  resolveCheckoutRedirectOrigin,
  resolvePriceId,
} from "../lib/payments/product-catalogue"
import {
  enqueuesReportJob,
  fulfilCheckoutSessionCompleted,
  mutatesCaseEntitlements,
  sideEffectsForFulfilment,
  type FulfilmentDeps,
  type PurchaseRow,
  type WebhookLedgerRow,
} from "../lib/payments/fulfil-checkout-session"
import { buildCaseCapabilityBillingResponse } from "../lib/billing/case-capabilities"
import {
  establishCheckoutSession,
  type CheckoutSessionSnapshot,
} from "../lib/payments/checkout-session-orchestration"
import {
  reconcilePaymentLifecycleEvents,
  type PaymentLifecycleLedgerRow,
} from "../lib/payments/reconcile-payment-lifecycle"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const OWNER = "11111111-1111-1111-1111-111111111111"
const OTHER = "22222222-2222-2222-2222-222222222222"
const CASE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const PURCHASE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
const PAYMENT_ROW_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"

function baseMetadata(productKey: keyof typeof PRODUCT_CATALOGUE) {
  const product = PRODUCT_CATALOGUE[productKey]
  return buildCheckoutSessionMetadata({
    caseId: CASE_ID,
    product,
    casePurchaseId: PURCHASE_ID,
    legacyPaymentId: PAYMENT_ROW_ID,
    caseOwnerUserId: OWNER,
  })
}

type DurableFulfilmentState = {
  reportJobKeys: Set<string>
  entitlementKeys: Set<string>
  legacyPaymentKeys: Set<string>
}

function createDurableFulfilmentState(): DurableFulfilmentState {
  return {
    reportJobKeys: new Set(),
    entitlementKeys: new Set(),
    legacyPaymentKeys: new Set(),
  }
}

function createMockDeps(overrides?: {
  ledgerStatus?: string
  caseUserId?: string | null
  caseMissing?: boolean
  failOn?: "purchase" | "report" | "entitlement" | "legacyPayment"
  purchasePatch?: Partial<PurchaseRow>
  fulfilledByEventId?: string
  durableState?: DurableFulfilmentState
}): {
  deps: FulfilmentDeps
  calls: {
    reportJobs: number
    reportJobAttempts: number
    entitlements: number
    entitlementAttempts: number
    legacyPayments: number
    legacyPaymentAttempts: number
    purchases: number
    purchaseStatuses: string[]
    ledgerMarks: Array<string>
  }
} {
  const durableState = overrides?.durableState ?? createDurableFulfilmentState()
  const calls = {
    reportJobs: 0,
    reportJobAttempts: 0,
    entitlements: 0,
    entitlementAttempts: 0,
    legacyPayments: 0,
    legacyPaymentAttempts: 0,
    purchases: 0,
    purchaseStatuses: [] as string[],
    ledgerMarks: [] as string[],
  }

  let ledger: WebhookLedgerRow = {
    id: "ledger-1",
    processing_status: overrides?.ledgerStatus ?? "received",
  }

  const deps: FulfilmentDeps = {
    recordWebhookEvent: async () => ledger,
    markLedger: async (_id, patch) => {
      calls.ledgerMarks.push(patch.processing_status)
      if (patch.processing_status) {
        ledger = { ...ledger, processing_status: patch.processing_status }
      }
    },
    completeLegacyPayment: async ({ paymentRowId }) => {
      calls.legacyPaymentAttempts += 1
      if (overrides?.failOn === "legacyPayment") throw new Error("legacy payment boom")
      if (!durableState.legacyPaymentKeys.has(paymentRowId)) {
        durableState.legacyPaymentKeys.add(paymentRowId)
        calls.legacyPayments += 1
      }
    },
    loadCase: async () => {
      if (overrides?.caseMissing) return null
      return { id: CASE_ID, user_id: overrides?.caseUserId === undefined ? OWNER : overrides.caseUserId }
    },
    loadPurchase: async (args) => {
      const product = Object.values(PRODUCT_CATALOGUE).find(
        (candidate) => candidate.productCode === args.productCode,
      )!
      return {
        id: args.purchaseId,
        user_id: OWNER,
        case_id: args.caseId,
        product_code: args.productCode,
        payment_status: "pending",
        amount: product.amountSgd,
        currency: "SGD",
        provider_checkout_session_id: args.checkoutSessionId,
        ...overrides?.purchasePatch,
      }
    },
    upsertPaidPurchase: async (args) => {
      calls.purchases += 1
      if (overrides?.failOn === "purchase") throw new Error("purchase upsert boom")
      const paymentStatus = overrides?.purchasePatch?.payment_status ?? "paid"
      calls.purchaseStatuses.push(paymentStatus)
      const row: PurchaseRow = {
        id: PURCHASE_ID,
        user_id: OWNER,
        case_id: args.caseId,
        product_code: args.productCode,
        payment_status: paymentStatus,
        provider_checkout_session_id: args.checkoutSessionId,
        fulfilment_provider_event_id: overrides?.fulfilledByEventId ?? args.fulfilmentEventId,
      }
      return row
    },
    enqueueReportJob: async ({ idempotencyKey }) => {
      calls.reportJobAttempts += 1
      if (overrides?.failOn === "report") throw new Error("enqueue boom")
      if (!durableState.reportJobKeys.has(idempotencyKey)) {
        durableState.reportJobKeys.add(idempotencyKey)
        calls.reportJobs += 1
      }
    },
    upsertEscalationPackEntitlement: async ({ caseId, purchaseRef }) => {
      calls.entitlementAttempts += 1
      if (overrides?.failOn === "entitlement") throw new Error("entitlement boom")
      const entitlementKey = `${caseId}:${purchaseRef}`
      if (!durableState.entitlementKeys.has(entitlementKey)) {
        durableState.entitlementKeys.add(entitlementKey)
        calls.entitlements += 1
      }
    },
    nowIso: () => "2026-07-13T00:00:00.000Z",
  }

  return { deps, calls }
}

describe("product catalogue", () => {
  it("maps commerce keys to canonical product_code values", () => {
    assert.equal(requireCheckoutProduct("self_serve_report").productCode, "self_serve_report")
    assert.equal(requireCheckoutProduct("human_consult_30m").productCode, "human_consult_99")
    assert.equal(requireCheckoutProduct("fidrec_tier2_pack").productCode, "escalation_pack")
  })

  it("rejects unknown product keys", () => {
    assert.equal(isCheckoutProductKey("unknown_sku"), false)
    assert.throws(() => requireCheckoutProduct("unknown_sku"), /Unknown or missing/)
    assert.throws(() => requireCheckoutProduct(null), /Unknown or missing/)
    assert.throws(() => requireCheckoutProduct(undefined), /Unknown or missing/)
  })

  it("maps Stripe Price ID env vars only for enabled products", () => {
    const env = {
      STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD: "price_ss",
      STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD: "price_t2",
    }
    for (const key of CHECKOUT_PRODUCT_KEYS) {
      const product = PRODUCT_CATALOGUE[key]
      if (product.checkoutEnabled) {
        assert.ok(resolvePriceId(product, env), `missing price for ${key}`)
      }
    }
    assert.equal(resolvePriceId(PRODUCT_CATALOGUE.human_consult_30m, env), null)
  })

  it("fails closed on preview-to-production Stripe redirect misconfiguration", () => {
    const base = {
      HARBOR_DEPLOYMENT_ENVIRONMENT: "preview",
      CHECKOUT_REDIRECT_ORIGIN: "https://preview.guidebuoyai.test",
      NEXT_PUBLIC_APP_URL: "https://preview.guidebuoyai.test",
      HARBOR_PRODUCTION_APP_ORIGIN: "https://guidebuoyai.sg",
    }
    assert.equal(resolveCheckoutRedirectOrigin(base), "https://preview.guidebuoyai.test")
    assert.equal(
      resolveCheckoutRedirectOrigin({
        ...base,
        CHECKOUT_REDIRECT_ORIGIN: "https://guidebuoyai.sg",
        NEXT_PUBLIC_APP_URL: "https://guidebuoyai.sg",
      }),
      null,
    )
    assert.equal(resolveCheckoutRedirectOrigin({ ...base, HARBOR_DEPLOYMENT_ENVIRONMENT: "" }), null)
    assert.equal(resolveCheckoutRedirectOrigin({ ...base, CHECKOUT_REDIRECT_ORIGIN: "http://preview.guidebuoyai.test" }), null)
  })

  it("accepts only the explicit production checkout origin in production", () => {
    const base = {
      HARBOR_DEPLOYMENT_ENVIRONMENT: "production",
      CHECKOUT_REDIRECT_ORIGIN: "https://guidebuoyai.sg",
      NEXT_PUBLIC_APP_URL: "https://guidebuoyai.sg",
      HARBOR_PRODUCTION_APP_ORIGIN: "https://guidebuoyai.sg",
    }
    assert.equal(resolveCheckoutRedirectOrigin(base), "https://guidebuoyai.sg")
    assert.equal(
      resolveCheckoutRedirectOrigin({
        ...base,
        CHECKOUT_REDIRECT_ORIGIN: "https://preview.guidebuoyai.test",
        NEXT_PUBLIC_APP_URL: "https://preview.guidebuoyai.test",
      }),
      null,
    )
  })

  it("requires checkout metadata keys and matching product_code", () => {
    const meta = baseMetadata("human_consult_30m")
    assertRequiredCheckoutMetadata(meta)
    for (const key of REQUIRED_CHECKOUT_METADATA_KEYS) {
      const bad = { ...meta, [key]: "" }
      assert.throws(() => assertRequiredCheckoutMetadata(bad), new RegExp(key))
    }
    assert.throws(
      () =>
        assertRequiredCheckoutMetadata({
          ...meta,
          product_code: "self_serve_report",
        }),
      /product_code mismatch/,
    )
  })

  it("documents fulfilment side-effect matrix", () => {
    assert.equal(enqueuesReportJob("self_serve_report_job"), true)
    assert.equal(enqueuesReportJob("payment_record_only"), false)
    assert.equal(enqueuesReportJob("escalation_pack_entitlement"), false)

    assert.equal(mutatesCaseEntitlements("self_serve_report_job"), true)
    assert.equal(mutatesCaseEntitlements("escalation_pack_entitlement"), true)
    assert.equal(mutatesCaseEntitlements("payment_record_only"), false)

    assert.equal(PRODUCT_CATALOGUE.human_consult_30m.checkoutEnabled, false)
    assert.deepEqual(sideEffectsForFulfilment("payment_record_only"), [])
    assert.deepEqual(sideEffectsForFulfilment("escalation_pack_entitlement"), [
      { type: "upsert_escalation_pack_entitlement" },
    ])
    assert.deepEqual(sideEffectsForFulfilment("self_serve_report_job"), [
      { type: "enqueue_report_job" },
    ])
  })
})

describe("Checkout session ambiguity recovery", () => {
 it("retries an accepted-but-client-threw create with one stable reservation and Session", async () => {
   const sessions = new Map<string, CheckoutSessionSnapshot>()
   const idempotencyKeys: string[] = []
   let throwAfterAccept = true
   let attaches = 0
   let cancellations = 0

   const deps = {
     createSession: async (idempotencyKey: string) => {
       idempotencyKeys.push(idempotencyKey)
       let session = sessions.get(idempotencyKey)
       if (!session) {
         session = {
           id: "cs_accepted_once",
           status: "open",
           url: "https://checkout.stripe.test/cs_accepted_once",
           paymentIntentId: null,
         }
         sessions.set(idempotencyKey, session)
       }
       if (throwAfterAccept) {
         throwAfterAccept = false
         throw new Error("connection reset after Stripe accepted request")
       }
       return session
     },
     attachSession: async () => {
       attaches += 1
     },
     expireSession: async () => ({ status: "expired" }),
     cancelReservation: async () => {
       cancellations += 1
     },
   }

   const first = await establishCheckoutSession(deps, PURCHASE_ID)
   const retry = await establishCheckoutSession(deps, PURCHASE_ID)

   assert.deepEqual(first, { status: "retryable", reason: "create_ambiguous" })
   assert.equal(retry.status, "ready")
   assert.equal(sessions.size, 1)
   assert.deepEqual(idempotencyKeys, [
     `case-purchase:${PURCHASE_ID}`,
     `case-purchase:${PURCHASE_ID}`,
   ])
   assert.equal(attaches, 1)
   assert.equal(cancellations, 0)
 })
})

describe("fulfilCheckoutSessionCompleted", () => {
  it("self_serve_report: paid purchase + report job only", async () => {
    const { deps, calls } = createMockDeps()
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_ss_1",
      sessionId: "cs_ss_1",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 1800,
      currency: "sgd",
      paymentIntentId: "pi_1",
      metadata: baseMetadata("self_serve_report"),
    })
    assert.equal(result.status, "processed")
    if (result.status === "processed") {
      assert.equal(result.fulfilment, "self_serve_report_job")
    }
    assert.equal(calls.purchases, 1)
    assert.equal(calls.reportJobs, 1)
    assert.equal(calls.entitlements, 0)
  })

  it("binds an unattached reservation from a signed completion and fulfils it once", async () => {
    let cancellations = 0
    const setup = await establishCheckoutSession(
      {
        createSession: async () => ({
          id: "cs_attach_lost",
          status: "open",
          url: "https://checkout.stripe.test/cs_attach_lost",
          paymentIntentId: null,
        }),
        attachSession: async () => {
          throw new Error("database connection lost")
        },
        expireSession: async () => {
          throw new Error("Stripe outcome unavailable")
        },
        cancelReservation: async () => {
          cancellations += 1
        },
      },
      PURCHASE_ID,
    )
    assert.deepEqual(setup, { status: "retryable", reason: "attach_ambiguous" })
    assert.equal(cancellations, 0)

    const durableState = createDurableFulfilmentState()
    const first = createMockDeps({
      purchasePatch: { provider_checkout_session_id: null },
      durableState,
    })
    const firstResult = await fulfilCheckoutSessionCompleted(first.deps, {
      eventId: "evt_bind_unattached",
      sessionId: "cs_attach_lost",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 1800,
      currency: "sgd",
      paymentIntentId: "pi_attach_lost",
      metadata: baseMetadata("self_serve_report"),
    })
    assert.equal(firstResult.status, "processed")
    assert.equal(first.calls.reportJobs, 1)

    const laterCompletion = createMockDeps({
      purchasePatch: {
        payment_status: "paid",
        provider_checkout_session_id: "cs_attach_lost",
        fulfilment_provider_event_id: "evt_bind_unattached",
      },
      fulfilledByEventId: "evt_bind_unattached",
      durableState,
    })
    const replayResult = await fulfilCheckoutSessionCompleted(laterCompletion.deps, {
      eventId: "evt_later_completion",
      sessionId: "cs_attach_lost",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 1800,
      currency: "sgd",
      paymentIntentId: "pi_attach_lost",
      metadata: baseMetadata("self_serve_report"),
    })
    assert.equal(replayResult.status, "processed")
    assert.equal(laterCompletion.calls.reportJobAttempts, 1)
    assert.equal(laterCompletion.calls.reportJobs, 0)
    assert.equal(durableState.reportJobKeys.size, 1)
    assert.equal(durableState.legacyPaymentKeys.size, 1)
  })

  it("human_consult_30m records a historic payment without allocating consultation", async () => {
    const { deps, calls } = createMockDeps()
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_hc_1",
      sessionId: "cs_hc_1",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: "pi_2",
      metadata: baseMetadata("human_consult_30m"),
    })
    assert.equal(result.status, "processed")
    if (result.status === "processed") {
      assert.equal(result.fulfilment, "payment_record_only")
    }
    assert.equal(calls.purchases, 1)
    assert.equal(calls.legacyPayments, 1)
    assert.equal(calls.reportJobs, 0)
    assert.equal(calls.entitlements, 0)
  })

  it("fidrec_tier2_pack → escalation_pack: entitlement only, no report job", async () => {
    const { deps, calls } = createMockDeps()
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_t2_1",
      sessionId: "cs_t2_1",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 18800,
      currency: "sgd",
      paymentIntentId: "pi_3",
      metadata: baseMetadata("fidrec_tier2_pack"),
    })
    assert.equal(result.status, "processed")
    if (result.status === "processed") {
      assert.equal(result.fulfilment, "escalation_pack_entitlement")
    }
    assert.equal(calls.entitlements, 1)
    assert.equal(calls.reportJobs, 0)
  })

  it("rejects unknown product without falling back to self_serve", async () => {
    const { deps, calls } = createMockDeps()
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_bad",
      sessionId: "cs_bad",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: "pi_test",
      metadata: {
        ...baseMetadata("human_consult_30m"),
        product_key: "not_a_product",
      },
    })
    assert.equal(result.status, "ignored")
    assert.equal(calls.reportJobs, 0)
    assert.equal(calls.entitlements, 0)
  })

  it("duplicate webhook event (already processed) is a no-op", async () => {
    const { deps, calls } = createMockDeps({ ledgerStatus: "processed" })
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_dup",
      sessionId: "cs_dup",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: "pi_test",
      metadata: baseMetadata("human_consult_30m"),
    })
    assert.equal(result.status, "duplicate")
    assert.equal(calls.purchases, 0)
    assert.equal(calls.reportJobs, 0)
    assert.equal(calls.entitlements, 0)
  })

  it("duplicate checkout session is a record-only no-op after the first event", async () => {
    assert.match(PAYMENT_IDEMPOTENCY.checkoutSession, /provider_checkout_session_id/)

    const first = createMockDeps()
    const r1 = await fulfilCheckoutSessionCompleted(first.deps, {
      eventId: "evt_a",
      sessionId: "cs_same",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: "pi_test",
      metadata: baseMetadata("human_consult_30m"),
    })
    assert.equal(r1.status, "processed")
    if (r1.status === "processed") {
      assert.equal(r1.fulfilment, "payment_record_only")
    }
    assert.equal(first.calls.purchases, 1)
    assert.equal(first.calls.reportJobs, 0)
    assert.equal(first.calls.entitlements, 0)

    const replay = createMockDeps({ ledgerStatus: "processed" })
    const r2 = await fulfilCheckoutSessionCompleted(replay.deps, {
      eventId: "evt_a",
      sessionId: "cs_same",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: "pi_test",
      metadata: baseMetadata("human_consult_30m"),
    })
    assert.equal(r2.status, "duplicate")
    assert.equal(replay.calls.purchases, 0)
    assert.equal(replay.calls.reportJobs, 0)
    assert.equal(replay.calls.entitlements, 0)
  })

  it("completion replay preserves refund/dispute status and retries effects idempotently", async () => {
    for (const paymentStatus of ["partially_refunded", "refunded", "disputed"] as const) {
      const durableState = createDurableFulfilmentState()
      durableState.reportJobKeys.add("cs_lifecycle")
      durableState.legacyPaymentKeys.add(PAYMENT_ROW_ID)
      const { deps, calls } = createMockDeps({
        purchasePatch: {
          payment_status: paymentStatus,
          provider_checkout_session_id: "cs_lifecycle",
          fulfilment_provider_event_id: "evt_initial_completion",
        },
        fulfilledByEventId: "evt_initial_completion",
        durableState,
      })
      const result = await fulfilCheckoutSessionCompleted(deps, {
        eventId: `evt_completion_after_${paymentStatus}`,
        sessionId: "cs_lifecycle",
        mode: "payment",
        paymentStatus: "paid",
        amountTotalCents: 1800,
        currency: "sgd",
        paymentIntentId: "pi_lifecycle",
        metadata: baseMetadata("self_serve_report"),
      })

      assert.equal(result.status, "processed")
      assert.deepEqual(calls.purchaseStatuses, [paymentStatus])
      assert.equal(calls.reportJobAttempts, 1)
      assert.equal(calls.reportJobs, 0)
      assert.equal(calls.legacyPaymentAttempts, 1)
      assert.equal(calls.legacyPayments, 0)
      assert.equal(calls.entitlements, 0)
      assert.equal(durableState.reportJobKeys.size, 1)
      assert.equal(durableState.legacyPaymentKeys.size, 1)
    }
  })

  it("partial failure marks failed and allows retry repair", async () => {
    const durableState = createDurableFulfilmentState()
    const failing = createMockDeps({ failOn: "report", durableState })
    const failed = await fulfilCheckoutSessionCompleted(failing.deps, {
      eventId: "evt_fail",
      sessionId: "cs_fail",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 1800,
      currency: "sgd",
      paymentIntentId: "pi_test",
      metadata: baseMetadata("self_serve_report"),
    })
    assert.equal(failed.status, "failed")
    assert.ok(failing.calls.ledgerMarks.includes("failed"))

    const repairing = createMockDeps({ durableState })
    const repaired = await fulfilCheckoutSessionCompleted(repairing.deps, {
      eventId: "evt_fail",
      sessionId: "cs_fail",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 1800,
      currency: "sgd",
      paymentIntentId: "pi_test",
      metadata: baseMetadata("self_serve_report"),
    })
    assert.equal(repaired.status, "processed")
    assert.equal(repairing.calls.reportJobs, 1)
    assert.equal(repairing.calls.legacyPayments, 1)
    assert.equal(durableState.reportJobKeys.size, 1)
    assert.equal(durableState.legacyPaymentKeys.size, 1)
  })

  it("retries a later failed effect without duplicating an earlier durable effect", async () => {
    const durableState = createDurableFulfilmentState()
    const first = createMockDeps({ failOn: "legacyPayment", durableState })
    const input = {
      eventId: "evt_late_effect_failure",
      sessionId: "cs_late_effect_failure",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 1800,
      currency: "sgd",
      paymentIntentId: "pi_late_effect_failure",
      metadata: baseMetadata("self_serve_report"),
    }

    const failed = await fulfilCheckoutSessionCompleted(first.deps, input)
    assert.equal(failed.status, "failed")
    assert.equal(first.calls.reportJobs, 1)
    assert.equal(first.calls.legacyPayments, 0)

    const retry = createMockDeps({ durableState })
    const repaired = await fulfilCheckoutSessionCompleted(retry.deps, input)
    assert.equal(repaired.status, "processed")
    assert.equal(retry.calls.reportJobAttempts, 1)
    assert.equal(retry.calls.reportJobs, 0)
    assert.equal(retry.calls.legacyPayments, 1)
    assert.equal(durableState.reportJobKeys.size, 1)
    assert.equal(durableState.legacyPaymentKeys.size, 1)
  })

  it("fails when case owner user_id is null", async () => {
    const { deps, calls } = createMockDeps({ caseUserId: null })
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_null_owner",
      sessionId: "cs_null_owner",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 1800,
      currency: "sgd",
      paymentIntentId: "pi_test",
      metadata: baseMetadata("self_serve_report"),
    })
    assert.equal(result.status, "failed")
    if (result.status === "failed") {
      assert.match(result.error, /null user_id/)
    }
    assert.equal(calls.reportJobs, 0)
  })

  it("fails when case is missing", async () => {
    const { deps } = createMockDeps({ caseMissing: true })
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_missing_case",
      sessionId: "cs_missing_case",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 1800,
      currency: "sgd",
      paymentIntentId: "pi_test",
      metadata: baseMetadata("self_serve_report"),
    })
    assert.equal(result.status, "failed")
  })

  it("ignores metadata user_id for ownership (uses cases.user_id via purchase.user_id)", async () => {
    const { deps, calls } = createMockDeps()
    const meta = {
      ...baseMetadata("human_consult_30m"),
      user_id: OTHER, // attacker-controlled metadata must not drive ownership
    }
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_meta_user",
      sessionId: "cs_meta_user",
      mode: "payment",
      paymentStatus: "paid",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: "pi_test",
      metadata: meta,
    })
    assert.equal(result.status, "processed")
    // Purchase mock always returns OWNER from cases-derived upsert path.
    assert.equal(calls.purchases, 1)
    assert.equal(calls.reportJobs, 0)
    assert.equal(calls.entitlements, 0)
  })

  it("fails closed for invalid Stripe payment facts", async () => {
    const invalidInputs = [
      { mode: "subscription" },
      { paymentStatus: "unpaid" },
      { amountTotalCents: 1799 },
      { currency: "usd" },
      { paymentIntentId: null },
      { clientReferenceId: OTHER },
    ]

    for (const patch of invalidInputs) {
      const { deps, calls } = createMockDeps()
      const result = await fulfilCheckoutSessionCompleted(deps, {
        eventId: `evt_invalid_${Object.keys(patch)[0]}`,
        sessionId: "cs_invalid",
        mode: "payment",
        paymentStatus: "paid",
        amountTotalCents: 1800,
        currency: "sgd",
        paymentIntentId: "pi_test",
        clientReferenceId: PURCHASE_ID,
        metadata: baseMetadata("self_serve_report"),
        ...patch,
      })
      assert.equal(result.status, "failed", JSON.stringify(patch))
      assert.equal(calls.purchases, 0, JSON.stringify(patch))
      assert.equal(calls.reportJobs, 0, JSON.stringify(patch))
    }
  })

  it("fails closed when the canonical pending purchase differs", async () => {
    const purchasePatches: Partial<PurchaseRow>[] = [
      { case_id: OTHER },
      { user_id: OTHER },
      { product_code: "escalation_pack" },
      { payment_status: "cancelled" },
      { amount: 188 },
      { currency: "USD" },
      { provider_checkout_session_id: "cs_other" },
    ]

    for (const purchasePatch of purchasePatches) {
      const { deps, calls } = createMockDeps({ purchasePatch })
      const result = await fulfilCheckoutSessionCompleted(deps, {
        eventId: `evt_mismatch_${Object.keys(purchasePatch)[0]}`,
        sessionId: "cs_expected",
        mode: "payment",
        paymentStatus: "paid",
        amountTotalCents: 1800,
        currency: "sgd",
        paymentIntentId: "pi_test",
        clientReferenceId: PURCHASE_ID,
        metadata: baseMetadata("self_serve_report"),
      })
      assert.equal(result.status, "failed", JSON.stringify(purchasePatch))
      assert.equal(calls.purchases, 0, JSON.stringify(purchasePatch))
    }
  })
})

describe("payment lifecycle reconciliation", () => {
  it("refund→completed replays the early refund after canonical completion", async () => {
    const event: PaymentLifecycleLedgerRow = {
      id: "ledger-refund",
      event_type: "charge.refunded",
      payload: { amount_refunded: 1800, currency: "sgd" },
    }
    let purchase: { id: string; case_id: string } | null = null
    const patches: Array<Record<string, unknown>> = []
    const refunds: Array<Record<string, unknown>> = []

    const deps = {
      loadPurchase: async () => purchase,
      loadEvents: async () => [event],
      markLedger: async (_id: string, patch: Record<string, unknown>) => {
        patches.push(patch)
      },
      recordRefund: async (args: Record<string, unknown>) => {
        refunds.push(args)
      },
      recordDispute: async () => {},
      nowIso: () => "2026-08-29T00:00:00.000Z",
    }

    await reconcilePaymentLifecycleEvents(deps, "pi_early_refund")
    assert.equal(refunds.length, 0)
    assert.equal(patches.length, 1)
    assert.equal(patches[0]?.error, "Awaiting canonical Checkout completion")
    assert.equal(patches[0]?.processing_status, undefined)

    purchase = { id: PURCHASE_ID, case_id: CASE_ID }
    patches.length = 0
    await reconcilePaymentLifecycleEvents(deps, "pi_early_refund")
    assert.deepEqual(refunds, [
      {
        purchaseId: PURCHASE_ID,
        paymentIntentId: "pi_early_refund",
        refundedAmount: 18,
        currency: "sgd",
      },
    ])
    assert.equal(patches[0]?.processing_status, "processed")
    assert.equal(patches[0]?.case_purchase_id, PURCHASE_ID)
  })

  it("replays every lifecycle-before-completion ordering without monetary regression", async () => {
    const scenarios = [
      { name: "partial", events: ["partial"], status: "partially_refunded", refund: 5 },
      { name: "full", events: ["full"], status: "refunded", refund: 18 },
      { name: "dispute", events: ["dispute"], status: "disputed", refund: 0 },
      {
        name: "partial_dispute",
        events: ["partial", "dispute"],
        status: "disputed",
        refund: 5,
      },
      {
        name: "dispute_partial",
        events: ["dispute", "partial"],
        status: "disputed",
        refund: 5,
      },
      {
        name: "full_dispute",
        events: ["full", "dispute"],
        status: "refunded",
        refund: 18,
      },
      {
        name: "dispute_full",
        events: ["dispute", "full"],
        status: "refunded",
        refund: 18,
      },
    ] as const

    for (const scenario of scenarios) {
      let purchase: { id: string; case_id: string } | null = null
      let status: "paid" | "partially_refunded" | "refunded" | "disputed" = "paid"
      let refundedAmount = 0
      const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
      const events: PaymentLifecycleLedgerRow[] = scenario.events.map(
        (event, index): PaymentLifecycleLedgerRow =>
          event === "dispute"
            ? {
                id: `${scenario.name}-${index}`,
                event_type: "charge.dispute.created",
                payload: { disputed_at: `2026-08-29T0${index}:00:00.000Z` },
              }
            : {
                id: `${scenario.name}-${index}`,
                event_type: "charge.refunded",
                payload: {
                  amount_refunded: event === "full" ? 1800 : 500,
                  currency: "sgd",
                },
              },
      )
      const processedLedgerIds = new Set<string>()
      const deps = {
        loadPurchase: async () => purchase,
        loadEvents: async () => events.filter(({ id }) => !processedLedgerIds.has(id)),
        markLedger: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch })
          if (patch.processing_status === "processed") processedLedgerIds.add(id)
        },
        recordRefund: async ({ refundedAmount: incoming }: { refundedAmount: number }) => {
          refundedAmount = Math.max(refundedAmount, incoming)
          if (refundedAmount >= 18) status = "refunded"
          else if (status !== "refunded" && status !== "disputed") status = "partially_refunded"
        },
        recordDispute: async () => {
          if (status !== "refunded") status = "disputed"
        },
        nowIso: () => "2026-08-29T10:00:00.000Z",
      }

      await reconcilePaymentLifecycleEvents(deps, `pi_${scenario.name}`)
      assert.equal(
        patches.filter(({ patch }) => patch.error === "Awaiting canonical Checkout completion").length,
        events.length,
        scenario.name,
      )
      assert.equal(patches.some(({ patch }) => patch.processing_status === "processed"), false)

      purchase = { id: PURCHASE_ID, case_id: CASE_ID }
      patches.length = 0
      await reconcilePaymentLifecycleEvents(deps, `pi_${scenario.name}`)
      await reconcilePaymentLifecycleEvents(deps, `pi_${scenario.name}`)

      assert.equal(status, scenario.status, scenario.name)
      assert.equal(refundedAmount, scenario.refund, scenario.name)
      assert.equal(
        patches.filter(({ patch }) => patch.processing_status === "processed").length,
        events.length,
        scenario.name,
      )
      assert.equal(
        patches.every(({ patch }) =>
          patch.case_purchase_id === PURCHASE_ID && patch.case_id === CASE_ID && patch.error === null
        ),
        true,
        scenario.name,
      )
    }
  })

  it("completed→dispute records once and rejects malformed lifecycle facts", async () => {
    const events: PaymentLifecycleLedgerRow[] = [
      {
        id: "ledger-dispute",
        event_type: "charge.dispute.created",
        payload: { disputed_at: "2026-08-29T01:00:00.000Z" },
      },
      {
        id: "ledger-invalid-refund",
        event_type: "charge.refunded",
        payload: { amount_refunded: 1.5, currency: "sgd" },
      },
    ]
    const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
    const disputes: Array<Record<string, unknown>> = []

    await reconcilePaymentLifecycleEvents(
      {
        loadPurchase: async () => ({ id: PURCHASE_ID, case_id: CASE_ID }),
        loadEvents: async () => events,
        markLedger: async (id, patch) => {
          patches.push({ id, patch })
        },
        recordRefund: async () => {
          assert.fail("malformed refund must not mutate a purchase")
        },
        recordDispute: async (args) => {
          disputes.push(args)
        },
        nowIso: () => "2026-08-29T00:00:00.000Z",
      },
      "pi_lifecycle",
    )

    assert.deepEqual(disputes, [
      {
        purchaseId: PURCHASE_ID,
        paymentIntentId: "pi_lifecycle",
        disputedAt: "2026-08-29T01:00:00.000Z",
      },
    ])
    assert.equal(patches[0]?.patch.processing_status, "processed")
    assert.equal(patches[1]?.patch.processing_status, "failed")
    assert.equal(patches[1]?.patch.error, "Invalid refund lifecycle payload")
  })
})

describe("typed case capability response", () => {
  it("retains report capability when FIDReC capability is granted", () => {
    const response = buildCaseCapabilityBillingResponse({
      caseId: CASE_ID,
      entitlement: {
        plan: "escalation_pack",
        features: { allow_escalation_pack: true },
        purchased_at: "2026-07-13T00:00:00.000Z",
      },
      purchases: [],
      generatedAt: "2026-07-13T00:00:00.000Z",
    })

    assert.equal(response.capabilities.report.entitled, true)
    assert.equal(response.capabilities.fidrecPack.entitled, true)
    assert.equal(response.capabilities.report.canCheckout, false)
    assert.equal(response.capabilities.fidrecPack.canCheckout, false)
    assert.equal(response.capabilities.regeneration.availability, "policy_blocked")
    assert.equal(response.billing.subscription.availability, "policy_blocked")
  })

  it("allows FIDReC checkout only after the FI report capability", () => {
    const response = buildCaseCapabilityBillingResponse({
      caseId: CASE_ID,
      entitlement: {
        plan: "self_serve_report",
        features: { allow_self_serve_report: true },
        purchased_at: "2026-07-13T00:00:00.000Z",
      },
      purchases: [],
    })

    assert.equal(response.capabilities.report.canGenerate, true)
    assert.equal(response.capabilities.fidrecPack.canCheckout, true)
  })

  it("blocks duplicate checkout while established purchases await fulfilment recovery", () => {
    for (const status of ["paid", "partially_refunded", "refunded", "disputed"] as const) {
      const reportRecovery = buildCaseCapabilityBillingResponse({
        caseId: CASE_ID,
        entitlement: null,
        purchases: [{
          id: `${PURCHASE_ID}-${status}`,
          product_code: "self_serve_report",
          payment_status: status,
          paid_at: "2026-07-13T00:00:00.000Z",
          created_at: "2026-07-13T00:00:00.000Z",
        }],
      })
      assert.equal(reportRecovery.capabilities.report.canCheckout, false, status)
      assert.equal(reportRecovery.capabilities.report.reconciliationRequired, true, status)

      const retainedCapability = buildCaseCapabilityBillingResponse({
        caseId: CASE_ID,
        entitlement: {
          plan: "self_serve_report",
          features: { allow_self_serve_report: true },
          purchased_at: "2026-07-13T00:00:00.000Z",
        },
        purchases: [{
          id: `${PURCHASE_ID}-${status}`,
          product_code: "self_serve_report",
          payment_status: status,
          paid_at: "2026-07-13T00:00:00.000Z",
          created_at: "2026-07-13T00:00:00.000Z",
        }],
      })
      assert.equal(retainedCapability.capabilities.report.entitled, true, status)
      assert.equal(retainedCapability.capabilities.report.canGenerate, true, status)
      assert.equal(retainedCapability.capabilities.report.reconciliationRequired, false, status)
    }
  })

  it("marks a pending checkout as resumable rather than established", () => {
    const response = buildCaseCapabilityBillingResponse({
      caseId: CASE_ID,
      entitlement: null,
      purchases: [{
        id: PURCHASE_ID,
        product_code: "self_serve_report",
        payment_status: "pending",
        paid_at: null,
        created_at: "2026-07-13T00:00:00.000Z",
      }],
    })

    assert.equal(response.capabilities.report.checkoutInProgress, true)
    assert.equal(response.capabilities.report.reconciliationRequired, false)
    assert.equal(response.capabilities.report.canCheckout, true)
  })

  it("returns entitlements to collaborators without advertising owner-only checkout", () => {
    const response = buildCaseCapabilityBillingResponse({
      caseId: CASE_ID,
      entitlement: {
        plan: "self_serve_report",
        features: { allow_self_serve_report: true },
        purchased_at: "2026-07-13T00:00:00.000Z",
      },
      purchases: [],
      canPurchase: false,
    })

    assert.equal(response.access.canPurchase, false)
    assert.equal(response.capabilities.report.entitled, true)
    assert.equal(response.capabilities.fidrecPack.canCheckout, false)
  })
})

describe("Pattern C ownership hygiene in payment sources", () => {
  it("payment modules do not introduce auth.uid() or auth.users ownership", () => {
    const files = [
      "lib/payments/product-catalogue.ts",
      "lib/payments/fulfil-checkout-session.ts",
      "app/api/payments/create-checkout-session/route.ts",
      "app/api/payments/webhook/route.ts",
    ]
    for (const rel of files) {
      const text = readFileSync(path.join(process.cwd(), rel), "utf8")
      assert.equal(text.includes("auth.uid()"), false, rel)
      assert.equal(text.includes("auth.users"), false, rel)
    }
  })

  it("documents idempotency constraints", () => {
    assert.ok(PAYMENT_IDEMPOTENCY.webhookEvent.includes("provider_event_id"))
    assert.ok(PAYMENT_IDEMPOTENCY.checkoutSession.includes("provider_checkout_session_id"))
    assert.ok(PAYMENT_IDEMPOTENCY.fulfilmentEvent.includes("fulfilment_provider_event_id"))
    assert.ok(PAYMENT_IDEMPOTENCY.reportJob.includes("session.id"))
  })
})

describe("cross-user RLS isolation contract (documentation)", () => {
  it("claimant SELECT on case_purchases is case-scoped via current_app_user_id()", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20260713180100_slice8_b_case_purchases.sql"),
      "utf8",
    )
    assert.match(migration, /c\.user_id = public\.current_app_user_id\(\)/)
    assert.doesNotMatch(migration, /auth\.uid\(\)/)
    assert.doesNotMatch(migration, /REFERENCES\s+auth\.users/i)
    assert.match(migration, /REFERENCES public\.profiles\(id\)/)
  })

  it("hardens purchase transitions and preserves monotonic capabilities", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260829000000_release_security_and_fulfilment_hardening.sql",
      ),
      "utf8",
    )
    assert.match(migration, /case_purchases_one_pending_checkout_idx/)
    assert.match(migration, /case_purchases_provider_payment_intent_unique_idx/)
    assert.match(migration, /payments_stripe_payment_intent_unique_idx/)
    assert.match(migration, /mark_case_purchase_paid_v1/)
    assert.match(migration, /record_case_purchase_refund_v1/)
    assert.match(migration, /record_case_purchase_dispute_v1/)
    assert.match(migration, /WHEN public\.case_entitlements\.plan = 'escalation_pack'/)
    assert.match(migration, /features = COALESCE\(public\.case_entitlements\.features/)
    assert.match(migration, /grant_fidrec_pack_capability_v1/)
  })

  it("resumes pending reservations and blocks established purchase recovery atomically", () => {
    const route = readFileSync(
      path.join(process.cwd(), "app/api/payments/create-checkout-session/route.ts"),
      "utf8",
    )
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260829000000_release_security_and_fulfilment_hardening.sql",
      ),
      "utf8",
    )
    const orchestration = readFileSync(
      path.join(process.cwd(), "lib/payments/checkout-session-orchestration.ts"),
      "utf8",
    )
    assert.match(route, /reserve_checkout_purchase_v1/)
    assert.match(route, /reservation_disposition/)
    assert.match(route, /PURCHASE_RECONCILIATION_REQUIRED/)
    assert.doesNotMatch(route, /\.from\("case_purchases"\)/)
    assert.match(migration, /pg_advisory_xact_lock/)
    assert.match(migration, /case_purchases_one_active_product_idx/)
    assert.match(migration, /'resumed_pending'::text/)
    assert.match(migration, /'reconcile_established'::text/)
    assert.match(route, /establishCheckoutSession/)
    assert.match(orchestration, /`case-purchase:\$\{casePurchaseId\}`/)
    assert.match(orchestration, /session\.status !== "open" \|\| !session\.url/)
    assert.match(orchestration, /expired\.status !== "expired"/)
  })

  it("repairs established purchases through the canonical provider-bound transaction", () => {
    const route = readFileSync(
      path.join(process.cwd(), "app/api/payments/create-checkout-session/route.ts"),
      "utf8",
    )
    const hook = readFileSync(
      path.join(process.cwd(), "hooks/state-machine/transition/use-create-checkout-session.ts"),
      "utf8",
    )
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260829000000_release_security_and_fulfilment_hardening.sql",
      ),
      "utf8",
    )

    assert.match(route, /reconcile_established_case_purchase_fulfilment_v1/)
    assert.match(route, /p_actor_profile_id: supabaseUuid/)
    assert.match(route, /return NextResponse\.json\(\{ reconciled: true \}\)/)
    assert.match(hook, /status: 'reconciled'/)
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reconcile_established_case_purchase_fulfilment_v1/)
    assert.match(migration, /pg_advisory_xact_lock/)
    assert.match(migration, /provider_checkout_session_id IS NOT NULL/)
    assert.match(migration, /provider_payment_intent_id = p_payment_intent_id/)
    assert.match(migration, /metadata ->> 'legacy_payment_id' = p_payment_id::text/)
    assert.match(migration, /payment_status IN \('pending', 'failed', 'completed'\)/)
    assert.match(migration, /'allow_self_serve_report', true/)
    assert.match(migration, /'allow_escalation_pack', true/)
  })

  it("keeps authenticated case_documents access read-only", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260829000000_release_security_and_fulfilment_hardening.sql",
      ),
      "utf8",
    )
    assert.match(migration, /DROP POLICY IF EXISTS case_documents_insert_authorized/)
    assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.case_documents FROM anon, authenticated/)
    assert.match(migration, /GRANT SELECT ON TABLE public\.case_documents TO authenticated/)
    assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE).*case_documents.*authenticated/)
  })

  it("requires edit access inside evidence document registration", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/case-documents/register-from-evidence-v1.ts"),
      "utf8",
    )
    const registrationBody = source.slice(source.indexOf("export async function registerCaseDocumentFromEvidenceV1"))
    assert.match(registrationBody, /getProfileCaseEditAccess\(supabase, caseId, profileId\)/)
  })

  it("enforces upload content, size, quota, and orphan recovery boundaries", () => {
    const route = readFileSync(path.join(process.cwd(), "app/api/evidence/upload/route.ts"), "utf8")
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260829000000_release_security_and_fulfilment_hardening.sql",
      ),
      "utf8",
    )

    assert.match(route, /MAX_FILE_BYTES = 50 \* 1024 \* 1024/)
    assert.match(route, /MAX_MULTIPART_BODY_BYTES/)
    assert.match(route, /headers\.get\("content-length"\)/)
    assert.match(route, /hasValidFileSignature/)
    assert.match(route, /bytes\[0\] === 0x25/)
    assert.doesNotMatch(route, /\.includes\("%PDF-"\)/)
    assert.ok(
      route.indexOf("const contentLength = getContentLength(request)") < route.indexOf("await request.formData()"),
      "must reject oversized request bodies before parsing multipart data",
    )
    assert.match(route, /register_evidence_upload_v1/)
    assert.match(route, /storage_cleanup_queue/)
    assert.match(migration, /pg_advisory_xact_lock/)
    assert.match(migration, /v_total_size \+ p_file_size > 524288000/)
    assert.match(migration, /REVOKE ALL ON TABLE public\.storage_cleanup_queue FROM PUBLIC, anon, authenticated/)
  })

  it("does not expose the retired legacy generation endpoint", () => {
    assert.equal(
      existsSync(path.join(process.cwd(), "app/api/cases/[caseId]/generate-pack/route.ts")),
      false,
    )
  })

  it("binds worker fanout to a locked canonical report job", () => {
    const worker = readFileSync(path.join(process.cwd(), "worker/index.ts"), "utf8")
    const proxy = readFileSync(path.join(process.cwd(), "lib/server/edge-proxy.ts"), "utf8")
    const autoRefire = readFileSync(
      path.join(process.cwd(), "lib/case-documents/fire-extract-when-settled.ts"),
      "utf8",
    )

    assert.match(worker, /job\.job_type !== 'post_payment_report_generation'/)
    assert.match(worker, /await assertJobStillAuthorized\(job\)/)
    assert.match(worker, /job_id: jobId/)
    assert.match(worker, /job_lock_token: job\.locked_at/)
    assert.match(worker, /EDGE_CALL_TIMEOUT_MS = 2 \* 60_000/)
    assert.match(worker, /JOB_DEADLINE_MS = 10 \* 60_000/)
    assert.match(worker, /new EdgeCallTimeoutError/)
    assert.match(worker, /new JobDeadlineExceededError/)
    assert.match(worker, /abortJob\(failure\)/)
    assert.match(worker, /deferForLeaseRecovery\(job, message\)/)
    assert.match(worker, /const heartbeatFailure = await heartbeat\.stop\(\)/)
    assert.match(proxy, /assert_active_worker_lease_v1/)
    assert.match(proxy, /p_job_locked_at: lockToken/)
    assert.match(proxy, /p_document_id: canonicalDocumentId/)
    assert.match(proxy, /p_allowed_job_types:/)
    assert.doesNotMatch(proxy, /\.from\(['"]jobs['"]\)/)
    assert.match(worker, /heartbeat_worker_job_v1/)
    assert.match(worker, /defer_worker_job_v1/)
    assert.match(worker, /settle_worker_job_v1/)
    assert.doesNotMatch(autoRefire, /x-worker-secret/)
  })
})
