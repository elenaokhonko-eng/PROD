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
import { readFileSync } from "node:fs"
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

function createMockDeps(overrides?: {
  ledgerStatus?: string
  caseUserId?: string | null
  caseMissing?: boolean
  failOn?: "purchase" | "consult" | "report" | "entitlement"
}): {
  deps: FulfilmentDeps
  calls: {
    reportJobs: number
    entitlements: number
    consultations: number
    purchases: number
    ledgerMarks: Array<string>
  }
} {
  const calls = {
    reportJobs: 0,
    entitlements: 0,
    consultations: 0,
    purchases: 0,
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
    completeLegacyPayment: async () => {},
    loadCase: async () => {
      if (overrides?.caseMissing) return null
      return { id: CASE_ID, user_id: overrides?.caseUserId === undefined ? OWNER : overrides.caseUserId }
    },
    upsertPaidPurchase: async (args) => {
      calls.purchases += 1
      if (overrides?.failOn === "purchase") throw new Error("purchase upsert boom")
      const row: PurchaseRow = {
        id: PURCHASE_ID,
        user_id: OWNER,
        case_id: args.caseId,
        product_code: args.productCode,
        payment_status: "paid",
      }
      return row
    },
    enqueueReportJob: async () => {
      calls.reportJobs += 1
      if (overrides?.failOn === "report") throw new Error("enqueue boom")
    },
    upsertEscalationPackEntitlement: async () => {
      calls.entitlements += 1
      if (overrides?.failOn === "entitlement") throw new Error("entitlement boom")
    },
    createConsultation: async () => {
      calls.consultations += 1
      if (overrides?.failOn === "consult") throw new Error("consult boom")
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

  it("maps Stripe Price ID env vars per product", () => {
    const env = {
      STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD: "price_ss",
      STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD: "price_t2",
      STRIPE_PRICE_ID_HUMAN_CONSULT_30M_SGD: "price_hc",
    }
    for (const key of CHECKOUT_PRODUCT_KEYS) {
      const product = PRODUCT_CATALOGUE[key]
      assert.ok(resolvePriceId(product, env), `missing price for ${key}`)
    }
    assert.equal(
      resolvePriceId(PRODUCT_CATALOGUE.human_consult_30m, {
        STRIPE_PRICE_ID_HUMAN_CONSULT_30M_SGD: "   ",
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
    assert.equal(enqueuesReportJob("human_consult_allocation"), false)
    assert.equal(enqueuesReportJob("escalation_pack_entitlement"), false)

    assert.equal(mutatesCaseEntitlements("self_serve_report_job"), true)
    assert.equal(mutatesCaseEntitlements("escalation_pack_entitlement"), true)
    assert.equal(mutatesCaseEntitlements("human_consult_allocation"), false)

    assert.deepEqual(sideEffectsForFulfilment("human_consult_allocation", PRODUCT_CATALOGUE.human_consult_30m), [
      { type: "create_consultation", durationMinutes: 30 },
    ])
    assert.deepEqual(sideEffectsForFulfilment("escalation_pack_entitlement", PRODUCT_CATALOGUE.fidrec_tier2_pack), [
      { type: "upsert_escalation_pack_entitlement" },
    ])
    assert.deepEqual(sideEffectsForFulfilment("self_serve_report_job", PRODUCT_CATALOGUE.self_serve_report), [
      { type: "enqueue_report_job" },
    ])
  })
})

describe("fulfilCheckoutSessionCompleted", () => {
  it("self_serve_report: paid purchase + report job only", async () => {
    const { deps, calls } = createMockDeps()
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_ss_1",
      sessionId: "cs_ss_1",
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
    assert.equal(calls.consultations, 0)
    assert.equal(calls.entitlements, 0)
  })

  it("human_consult_30m → human_consult_99: one consultation, no entitlements/jobs", async () => {
    const { deps, calls } = createMockDeps()
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_hc_1",
      sessionId: "cs_hc_1",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: "pi_2",
      metadata: baseMetadata("human_consult_30m"),
    })
    assert.equal(result.status, "processed")
    if (result.status === "processed") {
      assert.equal(result.fulfilment, "human_consult_allocation")
    }
    assert.equal(calls.purchases, 1)
    assert.equal(calls.consultations, 1)
    assert.equal(calls.reportJobs, 0)
    assert.equal(calls.entitlements, 0)
  })

  it("fidrec_tier2_pack → escalation_pack: entitlement only, no report job", async () => {
    const { deps, calls } = createMockDeps()
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_t2_1",
      sessionId: "cs_t2_1",
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
    assert.equal(calls.consultations, 0)
  })

  it("rejects unknown product without falling back to self_serve", async () => {
    const { deps, calls } = createMockDeps()
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_bad",
      sessionId: "cs_bad",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: null,
      metadata: {
        ...baseMetadata("human_consult_30m"),
        product_key: "not_a_product",
      },
    })
    assert.equal(result.status, "ignored")
    assert.equal(calls.reportJobs, 0)
    assert.equal(calls.consultations, 0)
    assert.equal(calls.entitlements, 0)
  })

  it("duplicate webhook event (already processed) is a no-op", async () => {
    const { deps, calls } = createMockDeps({ ledgerStatus: "processed" })
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_dup",
      sessionId: "cs_dup",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: null,
      metadata: baseMetadata("human_consult_30m"),
    })
    assert.equal(result.status, "duplicate")
    assert.equal(calls.purchases, 0)
    assert.equal(calls.consultations, 0)
  })

  it("duplicate checkout session: DB UNIQUE(purchase_id) is the one-consultation guarantee", async () => {
    // Two Stripe event ids for the same session (rare) would each attempt fulfilment.
    // case_consultations.UNIQUE(purchase_id) + create_consultation_from_paid_purchase
    // ON CONFLICT semantics ensure one allocation. Document + verify constraints text.
    assert.match(PAYMENT_IDEMPOTENCY.consultationPerPurchase, /UNIQUE\(purchase_id\)/)
    assert.match(PAYMENT_IDEMPOTENCY.checkoutSession, /provider_checkout_session_id/)

    const first = createMockDeps()
    const r1 = await fulfilCheckoutSessionCompleted(first.deps, {
      eventId: "evt_a",
      sessionId: "cs_same",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: null,
      metadata: baseMetadata("human_consult_30m"),
    })
    assert.equal(r1.status, "processed")
    assert.equal(first.calls.consultations, 1)

    // Same event id redelivered → ledger already processed → no second consult call.
    const replay = createMockDeps({ ledgerStatus: "processed" })
    const r2 = await fulfilCheckoutSessionCompleted(replay.deps, {
      eventId: "evt_a",
      sessionId: "cs_same",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: null,
      metadata: baseMetadata("human_consult_30m"),
    })
    assert.equal(r2.status, "duplicate")
    assert.equal(replay.calls.consultations, 0)
  })

  it("partial failure marks failed and allows retry repair", async () => {
    const failing = createMockDeps({ failOn: "consult" })
    const failed = await fulfilCheckoutSessionCompleted(failing.deps, {
      eventId: "evt_fail",
      sessionId: "cs_fail",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: null,
      metadata: baseMetadata("human_consult_30m"),
    })
    assert.equal(failed.status, "failed")
    assert.ok(failing.calls.ledgerMarks.includes("failed"))

    const repairing = createMockDeps()
    const repaired = await fulfilCheckoutSessionCompleted(repairing.deps, {
      eventId: "evt_fail",
      sessionId: "cs_fail",
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: null,
      metadata: baseMetadata("human_consult_30m"),
    })
    assert.equal(repaired.status, "processed")
    assert.equal(repairing.calls.consultations, 1)
  })

  it("fails when case owner user_id is null", async () => {
    const { deps, calls } = createMockDeps({ caseUserId: null })
    const result = await fulfilCheckoutSessionCompleted(deps, {
      eventId: "evt_null_owner",
      sessionId: "cs_null_owner",
      amountTotalCents: 1800,
      currency: "sgd",
      paymentIntentId: null,
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
      amountTotalCents: 1800,
      currency: "sgd",
      paymentIntentId: null,
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
      amountTotalCents: 9900,
      currency: "sgd",
      paymentIntentId: null,
      metadata: meta,
    })
    assert.equal(result.status, "processed")
    // Purchase mock always returns OWNER from cases-derived upsert path.
    assert.equal(calls.consultations, 1)
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
    assert.ok(PAYMENT_IDEMPOTENCY.consultationPerPurchase.includes("purchase_id"))
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
})
