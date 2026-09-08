import { randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { expect, test, type Page } from "@playwright/test"
import pg from "pg"
import Stripe from "stripe"
import {
  cleanupDisposableRecords,
  createDisposableCase,
  requireUuid,
  type DisposableCleanupScope,
} from "./helpers/disposable-records"

const enabled = process.env.HARBOR_PREVIEW_HANDSHAKES === "1"
const authStatePath = resolve(
  process.env.HARBOR_PREVIEW_AUTH_STORAGE_STATE ?? "tests/e2e/.auth/harbor-preview.json",
)
const requiredEnvironment = [
  "HARBOR_PREVIEW_BASE_URL",
  "HARBOR_PREVIEW_EXPECTED_HOST",
  "HARBOR_PREVIEW_SUPABASE_URL",
  "HARBOR_PREVIEW_SUPABASE_ANON_KEY",
  "HARBOR_PREVIEW_SUPABASE_SERVICE_ROLE_KEY",
  "HARBOR_PREVIEW_DATABASE_URL",
  "HARBOR_PREVIEW_STRIPE_WEBHOOK_SECRET",
  "HARBOR_PREVIEW_EMAIL_SINK",
  "HARBOR_PREVIEW_CONFIRM_SUPABASE_REF",
  "HARBOR_PREVIEW_EXPECTED_COMMIT_SHA",
  "HARBOR_PREVIEW_CONFIRMED_SHA",
  "HARBOR_PRODUCTION_HOSTS",
  "HARBOR_PRODUCTION_SUPABASE_HOSTS",
] as const
const mutationConfirmation = "RUN_MUTATING_PREVIEW_HANDSHAKES"
const previewSupabaseRef = "yqqkkftfddxuxmpxwbcj"
const knownProductionHosts = new Set(["guidebuoyaisg.onrender.com", "guidebuoyai.sg", "www.guidebuoyai.sg"])

function configuredHosts(name: "HARBOR_PRODUCTION_HOSTS" | "HARBOR_PRODUCTION_SUPABASE_HOSTS", defaults: Iterable<string> = []) {
  return new Set([
    ...Array.from(defaults, (host) => host.trim().toLowerCase()).filter(Boolean),
    ...requiredEnv(name)
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  ])
}

const evidencePath = resolve(
  process.env.HARBOR_PREVIEW_EVIDENCE_FILE ?? "test-results/harbor-preview-handshake-evidence.jsonl",
)
let serviceClient: SupabaseClient
let observedReleaseSha = ""

test.describe("Harbor preview integration handshakes", () => {
  test.skip(!enabled, "Run through pnpm test:e2e:preview-handshakes with isolated preview credentials.")
  test.use({ storageState: existsSync(authStatePath) ? authStatePath : undefined })

  test.beforeAll(async () => {
    const missing = requiredEnvironment.filter((name) => !process.env[name]?.trim())
    if (missing.length > 0) {
      throw new Error(`Missing preview handshake environment: ${missing.join(", ")}`)
    }
    if (!existsSync(authStatePath)) {
      throw new Error(`Missing preview Clerk storage state: ${authStatePath}`)
    }
    if (process.env.HARBOR_PREVIEW_CONFIRM_MUTATIONS !== mutationConfirmation) {
      throw new Error(
        `Set HARBOR_PREVIEW_CONFIRM_MUTATIONS=${mutationConfirmation} after confirming the target is disposable preview infrastructure.`,
      )
    }

    const baseUrl = new URL(requiredEnv("HARBOR_PREVIEW_BASE_URL"))
    const previewHost = baseUrl.hostname.toLowerCase()
    const productionHosts = configuredHosts("HARBOR_PRODUCTION_HOSTS", knownProductionHosts)
    if (
      baseUrl.protocol !== "https:" ||
      previewHost !== requiredEnv("HARBOR_PREVIEW_EXPECTED_HOST").toLowerCase() ||
      !previewHost.endsWith(".onrender.com") ||
      productionHosts.has(previewHost)
    ) {
      throw new Error("Preview handshakes require the exact HTTPS staging Render host and refuse production hosts.")
    }

    const supabaseUrl = new URL(requiredEnv("HARBOR_PREVIEW_SUPABASE_URL"))
    const projectRef = supabaseUrl.hostname.split(".")[0]
    const productionSupabaseHosts = configuredHosts("HARBOR_PRODUCTION_SUPABASE_HOSTS")
    if (
      projectRef !== previewSupabaseRef ||
      requiredEnv("HARBOR_PREVIEW_CONFIRM_SUPABASE_REF") !== previewSupabaseRef ||
      productionSupabaseHosts.has(supabaseUrl.hostname.toLowerCase())
    ) {
      throw new Error("Preview handshakes require the confirmed staging Supabase ref and refuse production Supabase hosts.")
    }

    const databaseUrl = new URL(requiredEnv("HARBOR_PREVIEW_DATABASE_URL"))
    if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
      throw new Error("HARBOR_PREVIEW_DATABASE_URL must be a PostgreSQL connection URL.")
    }
    const sslMode = databaseUrl.searchParams.get("sslmode")?.toLowerCase()
    if (!sslMode || !["require", "verify-ca", "verify-full"].includes(sslMode)) {
      throw new Error("HARBOR_PREVIEW_DATABASE_URL must require TLS with a secure sslmode.")
    }
    const databaseTargetParts = [databaseUrl.hostname, decodeURIComponent(databaseUrl.username)]
      .flatMap((value) => value.toLowerCase().split("."))
    if (!databaseTargetParts.includes(projectRef.toLowerCase())) {
      throw new Error("HARBOR_PREVIEW_DATABASE_URL does not target the confirmed preview Supabase project.")
    }

    serviceClient = createClient(
      requiredEnv("HARBOR_PREVIEW_SUPABASE_URL"),
      requiredEnv("HARBOR_PREVIEW_SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    const expectedCommitSha = requiredEnv("HARBOR_PREVIEW_EXPECTED_COMMIT_SHA").toLowerCase()
    const confirmedCommitSha = requiredEnv("HARBOR_PREVIEW_CONFIRMED_SHA").toLowerCase()
    if (!/^[0-9a-f]{40}$/.test(expectedCommitSha) || !/^[0-9a-f]{40}$/.test(confirmedCommitSha)) {
      throw new Error("Preview handshakes require full 40-character Git SHAs.")
    }
    if (confirmedCommitSha !== expectedCommitSha) {
      throw new Error("Authenticated preview release SHA does not match the expected candidate SHA.")
    }
    observedReleaseSha = confirmedCommitSha
    mkdirSync(dirname(evidencePath), { recursive: true })
    writeFileSync(evidencePath, "", "utf8")
  })

  test.afterEach(({}, testInfo) => {
    recordPreviewEvidence({
      check: testInfo.title,
      status: testInfo.status,
      durationMs: testInfo.duration,
    })
  })

  test("fails closed anonymously and keeps internal analytics private", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: requiredEnv("HARBOR_PREVIEW_BASE_URL") })
    const page = await context.newPage()

    try {
      await page.goto("/")
      await assertPreviewPageOrigin(page)
      await expect(page.getByRole("link", { name: "Chat with GuideBuoy on WhatsApp" })).toHaveAttribute(
        "href",
        "https://wa.me/6590727915",
      )

      const preference = await appFetch(page, "/api/preferences/sensory-mode", { method: "GET" })
      expect(preference.status).toBe(401)

      const email = await appFetch(page, "/api/email/send", {
        method: "POST",
        body: { to: requiredEnv("HARBOR_PREVIEW_EMAIL_SINK"), subject: "blocked", html: "blocked" },
      })
      expect(email.status).toBe(401)

      const unsignedWebhook = await appFetch(page, "/api/payments/webhook", {
        method: "POST",
        body: {},
      })
      expect(unsignedWebhook.status).toBe(400)

      const invalidWorker = await appFetch(page, "/api/edge/decision", {
        method: "POST",
        headers: { "x-worker-secret": `invalid-${randomUUID()}` },
        body: { case_id: randomUUID() },
      })
      expect(invalidWorker.status).toBe(401)

      await page.goto("/analytics")
      await assertPreviewPageOrigin(page)
      await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached()
      await expect(page.getByRole("heading", { name: "Acquisition & engagement" })).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test("maps Clerk identity into Supabase RLS and restores the preference", async ({ page, request }) => {
    const { token, profileId } = await authenticatedIdentity(page)
    const exported = await appFetch(page, "/api/privacy/export", { method: "POST" })
    expect(exported.status).toBe(200)
    expect((exported.body as { user?: { id?: string } } | null)?.user?.id).toBe(profileId)

    const { data: serviceProfile, error: serviceProfileError } = await serviceClient
      .from("profiles")
      .select("id, sensory_mode")
      .eq("id", profileId)
      .single()
    expect(serviceProfileError).toBeNull()
    expect(serviceProfile?.id).toBe(profileId)

    const anonClient = createClient(
      requiredEnv("HARBOR_PREVIEW_SUPABASE_URL"),
      requiredEnv("HARBOR_PREVIEW_SUPABASE_ANON_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const anonProfile = await anonClient.from("profiles").select("id").eq("id", profileId)
    expect(anonProfile.error === null ? anonProfile.data.length : 0).toBe(0)

    const forgedToken = forgeUnsignedToken(profileId)
    const forgedResponse = await request.get(
      `${requiredEnv("HARBOR_PREVIEW_SUPABASE_URL")}/rest/v1/profiles?id=eq.${profileId}&select=id`,
      {
        headers: {
          apikey: requiredEnv("HARBOR_PREVIEW_SUPABASE_ANON_KEY"),
          Authorization: "Bearer " + forgedToken,
        },
      },
    )
    expect([401, 403]).toContain(forgedResponse.status())

    const originalResponse = await appFetch(page, "/api/preferences/sensory-mode", { method: "GET" })
    expect(originalResponse.status).toBe(200)
    const originalMode = (originalResponse.body as { mode?: string } | null)?.mode
    expect(["steady", "quiet", "grounding"]).toContain(originalMode)
    const alternateMode = originalMode === "quiet" ? "steady" : "quiet"

    try {
      const update = await appFetch(page, "/api/preferences/sensory-mode", {
        method: "PUT",
        body: { mode: alternateMode },
      })
      expect(update.status).toBe(200)
      expect((update.body as { mode?: string } | null)?.mode).toBe(alternateMode)

      const reread = await appFetch(page, "/api/preferences/sensory-mode", { method: "GET" })
      expect((reread.body as { mode?: string } | null)?.mode).toBe(alternateMode)

      const { data: stored, error } = await serviceClient
        .from("profiles")
        .select("sensory_mode")
        .eq("id", profileId)
        .single()
      expect(error).toBeNull()
      expect(stored?.sensory_mode).toBe(alternateMode)
    } finally {
      const restore = await appFetch(page, "/api/preferences/sensory-mode", {
        method: "PUT",
        body: { mode: originalMode },
      })
      expect(restore.status).toBe(200)
    }

    const identityMismatch = await appFetch(page, "/api/analytics/track", {
      method: "POST",
      body: { eventName: "preview_identity_mismatch", userId: randomUUID() },
    })
    expect(identityMismatch.status).toBe(403)

    await page.goto("/analytics")
    await assertPreviewPageOrigin(page)
    await expect(page.getByRole("heading", { name: "Acquisition & engagement" })).toBeVisible()
    expect(decodeJwtPayload(token).supabase_uuid).toBe(profileId)
  })

  test("confirms the Pattern C migration, ACLs, and transactional rollback", async ({ page }) => {
    const { profileId } = await authenticatedIdentity(page)
    const client = new pg.Client({ connectionString: requiredEnv("HARBOR_PREVIEW_DATABASE_URL") })
    await client.connect()

    try {
      const migrations = await client.query<{ version: string }>(
        `select version
         from supabase_migrations.schema_migrations
         where version = any($1::text[])
         order by version`,
        [["20260829000000", "20260830000000"]],
      )
      expect(migrations.rows.map((row) => row.version)).toEqual([
        "20260829000000",
        "20260830000000",
      ])

      const policyNames = [
        "cases_select_authorized",
        "profiles_select_self",
        "profiles_update_self",
        "invitations_select_inviter",
        "jobs_select_authorized",
      ]
      const policies = await client.query<{ policyname: string; qual: string | null; with_check: string | null }>(
        `select policyname, qual, with_check
         from pg_policies
         where schemaname = 'public' and policyname = any($1::text[])`,
        [policyNames],
      )
      expect(new Set(policies.rows.map((row) => row.policyname))).toEqual(new Set(policyNames))
      for (const policy of policies.rows.filter((row) => row.policyname.startsWith("profiles_"))) {
        expect(`${policy.qual ?? ""} ${policy.with_check ?? ""}`).toContain("current_app_user_id")
      }

      const privileges = await client.query<{
        anon_can_claim: boolean
        authenticated_can_claim: boolean
        service_can_claim: boolean
      }>(`select
          has_function_privilege('anon', 'public.claim_next_job()', 'execute') as anon_can_claim,
          has_function_privilege('authenticated', 'public.claim_next_job()', 'execute') as authenticated_can_claim,
          has_function_privilege('service_role', 'public.claim_next_job()', 'execute') as service_can_claim`)
      expect(privileges.rows[0]).toEqual({
        anon_can_claim: false,
        authenticated_can_claim: false,
        service_can_claim: true,
      })

      const before = await client.query<{ sensory_mode: string | null }>(
        "select sensory_mode from public.profiles where id = $1",
        [profileId],
      )
      expect(before.rowCount).toBe(1)
      const originalMode = before.rows[0].sensory_mode ?? "steady"
      const temporaryMode = originalMode === "quiet" ? "steady" : "quiet"

      await client.query("begin")
      try {
        await client.query("update public.profiles set sensory_mode = $1 where id = $2", [temporaryMode, profileId])
        const inside = await client.query<{ sensory_mode: string }>(
          "select sensory_mode from public.profiles where id = $1",
          [profileId],
        )
        expect(inside.rows[0]?.sensory_mode).toBe(temporaryMode)
      } finally {
        await client.query("rollback")
      }

      const after = await client.query<{ sensory_mode: string | null }>(
        "select sensory_mode from public.profiles where id = $1",
        [profileId],
      )
      expect(after.rows[0]?.sensory_mode).toBe(before.rows[0].sensory_mode)
    } finally {
      await client.end()
    }
  })

  test("fulfils Tier 1 before Tier 2 and processes each signed webhook once", async ({ page, request }) => {
    const { token, profileId } = await authenticatedIdentity(page)
    const disposable = await createDisposableCase(serviceClient, {
      ownerId: profileId,
      summary: 'Disposable Harbor preview commerce handshake',
      narrative: 'Disposable preview-only integration fixture.',
    })
    const caseId = disposable.caseId
    const cleanup: DisposableCleanupScope = { ...disposable }
    const reportEventId = `evt_harbor_preview_${randomUUID().replaceAll("-", "")}`
    const tier2EventId = `evt_harbor_preview_${randomUUID().replaceAll("-", "")}`
    const stripe = new Stripe("sk_test_harbor_preview_signature_only", { apiVersion: "2024-06-20" })
    const webhookUrl = new URL("/api/payments/webhook", requiredEnv("HARBOR_PREVIEW_BASE_URL")).toString()

    const checkoutAndFulfil = async ({
      productKey,
      productCode,
      amountCents,
      eventId,
    }: {
      productKey: "self_serve_report" | "fidrec_tier2_pack"
      productCode: "self_serve_report" | "escalation_pack"
      amountCents: number
      eventId: string
    }) => {
      const checkout = await appFetch(page, "/api/payments/create-checkout-session", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: { caseId, productKey },
      })
      expect(checkout.status).toBe(200)
      expect((checkout.body as { url?: string } | null)?.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)

      const { data: purchase, error: purchaseError } = await serviceClient
        .from("case_purchases")
        .select("id, user_id, provider_checkout_session_id, metadata")
        .eq("case_id", caseId)
        .eq("product_code", productCode)
        .single()
      expect(purchaseError).toBeNull()
      expect(purchase?.user_id).toBe(profileId)
      expect(purchase?.provider_checkout_session_id).toMatch(/^cs_test_/)
      const legacyPaymentId = (purchase?.metadata as { legacy_payment_id?: unknown } | null)
        ?.legacy_payment_id
      expect(legacyPaymentId).toMatch(/^[0-9a-f-]{36}$/i)
      cleanup.casePurchaseIds = [...(cleanup.casePurchaseIds ?? []), requireUuid(purchase!.id, "case purchase id")]
      cleanup.paymentIds = [...(cleanup.paymentIds ?? []), requireUuid(String(legacyPaymentId), "payment id")]

      const rawEvent = JSON.stringify({
        id: eventId,
        object: "event",
        api_version: "2024-06-20",
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: purchase!.provider_checkout_session_id,
            object: "checkout.session",
            amount_total: amountCents,
            currency: "sgd",
            livemode: false,
            payment_intent: `pi_harbor_preview_${randomUUID().replaceAll("-", "")}`,
            metadata: {
              case_id: caseId,
              product_key: productKey,
              product_code: productCode,
              case_purchase_id: purchase!.id,
              payment_row_id: legacyPaymentId,
              user_id: randomUUID(),
            },
          },
        },
        livemode: false,
        pending_webhooks: 1,
        request: null,
        type: "checkout.session.completed",
      })
      const signature = stripe.webhooks.generateTestHeaderString({
        payload: rawEvent,
        secret: requiredEnv("HARBOR_PREVIEW_STRIPE_WEBHOOK_SECRET"),
      })
      const deliver = () =>
        request.post(webhookUrl, {
          data: rawEvent,
          headers: { "content-type": "application/json", "stripe-signature": signature },
          maxRedirects: 0,
        })

      const firstDelivery = await deliver()
      expect(firstDelivery.status(), await firstDelivery.text()).toBe(200)
      const duplicateDelivery = await deliver()
      expect(duplicateDelivery.status(), await duplicateDelivery.text()).toBe(200)

      const { data: ledger, count: ledgerCount, error: ledgerError } = await serviceClient
        .from("payment_webhook_events")
        .select("id, processing_status", { count: "exact" })
        .eq("payment_provider", "stripe")
        .eq("provider_event_id", eventId)
      expect(ledgerError).toBeNull()
      expect(ledgerCount).toBe(1)
      expect(ledger?.[0]?.processing_status).toBe("processed")
      cleanup.webhookEventIds = [...(cleanup.webhookEventIds ?? []), requireUuid(String(ledger?.[0]?.id), "webhook event id")]

      const { data: paidPurchase, error: paidPurchaseError } = await serviceClient
        .from("case_purchases")
        .select("payment_status, fulfilment_provider_event_id")
        .eq("id", purchase!.id)
        .single()
      expect(paidPurchaseError).toBeNull()
      expect(paidPurchase).toMatchObject({ payment_status: "paid", fulfilment_provider_event_id: eventId })
      return purchase!
    }

    try {
      const reportPurchase = await checkoutAndFulfil({
        productKey: "self_serve_report",
        productCode: "self_serve_report",
        amountCents: 1_800,
        eventId: reportEventId,
      })
      const tier2Purchase = await checkoutAndFulfil({
        productKey: "fidrec_tier2_pack",
        productCode: "escalation_pack",
        amountCents: 18_800,
        eventId: tier2EventId,
      })

      const { data: entitlement, error: entitlementError } = await serviceClient
        .from("case_entitlements")
        .select("case_id, plan, purchase_ref, features")
        .eq("case_id", caseId)
        .single()
      expect(entitlementError).toBeNull()
      expect(entitlement).toMatchObject({
        case_id: caseId,
        plan: "escalation_pack",
        purchase_ref: reportPurchase.provider_checkout_session_id,
        features: {
          allow_self_serve_report: true,
          allow_escalation_pack: true,
        },
      })
      cleanup.entitlementCaseIds = [caseId]

      const { data: reportJobs, error: reportJobError } = await serviceClient
        .from("jobs")
        .select("id")
        .eq("idempotency_key", reportPurchase.provider_checkout_session_id)
      expect(reportJobError).toBeNull()
      expect(reportJobs).toHaveLength(1)
      cleanup.jobIds = [...(cleanup.jobIds ?? []), requireUuid(String(reportJobs?.[0]?.id), "report job id")]

      const { count: tier2JobCount, error: tier2JobCountError } = await serviceClient
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("idempotency_key", tier2Purchase.provider_checkout_session_id)
      expect(tier2JobCountError).toBeNull()
      expect(tier2JobCount).toBe(0)

      const capability = await appFetch(page, `/api/cases/${caseId}/capabilities`, {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
      })
      expect(capability.status).toBe(200)
      const capabilities = capability.body as {
        capabilities?: { report?: { entitled?: boolean }; fidrecPack?: { entitled?: boolean } }
      }
      expect(capabilities.capabilities?.report?.entitled).toBe(true)
      expect(capabilities.capabilities?.fidrecPack?.entitled).toBe(true)
    } finally {
      await cleanupDisposableRecords(serviceClient, cleanup)
    }
  })

  test("observes the deployed Render worker complete a controlled report job", async ({ page }) => {
    const timeoutMs = Number(process.env.HARBOR_PREVIEW_WORKER_TIMEOUT_MS ?? 180_000)
    test.setTimeout(timeoutMs + 30_000)

    const { profileId } = await authenticatedIdentity(page)
    const disposable = await createDisposableCase(serviceClient, {
      ownerId: profileId,
      summary: "Disposable Harbor preview worker report case",
    })
    const cleanup: DisposableCleanupScope = { ...disposable }
    const caseId = disposable.caseId
    const idempotencyKey = `harbor-preview-worker-${randomUUID()}`
    let jobId: string | null = null

    try {
      const { error: entitlementError } = await serviceClient.from("case_entitlements").insert({
        case_id: caseId,
        plan: "self_serve_report",
        features: { allow_self_serve_report: true },
        source: "harbor_preview_worker_handshake",
        purchase_ref: idempotencyKey,
      })
      expect(entitlementError).toBeNull()
      cleanup.entitlementCaseIds = [caseId]

      const { data: backlog, error: backlogError } = await serviceClient
        .from("jobs")
        .select("id")
        .in("status", ["queued", "running"])
      expect(backlogError).toBeNull()
      expect(backlog, "Clear the preview worker backlog before running the release handshake.").toEqual([])

      const { data: job, error: jobError } = await serviceClient
        .from("jobs")
        .insert({
          case_id: caseId,
          user_id: profileId,
          job_type: "post_payment_report_generation",
          idempotency_key: idempotencyKey,
          status: "queued",
          payload: { source: "harbor_preview_handshake" },
        })
        .select("id")
        .single()
      expect(jobError).toBeNull()
      jobId = job?.id ?? null
      expect(jobId).toBeTruthy()
      cleanup.jobIds = [requireUuid(jobId!, "worker job id")]

      const deadline = Date.now() + timeoutMs
      let observed: {
        status: string
        error: string | null
        payload: Record<string, unknown> | null
      } | null = null
      while (Date.now() < deadline) {
        const { data, error } = await serviceClient
          .from("jobs")
          .select("status, error, payload")
          .eq("id", jobId!)
          .single()
        expect(error).toBeNull()
        observed = data
        if (observed?.status === "completed" || observed?.status === "failed") break
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))
      }

      expect(observed?.status, observed?.error ?? "The preview worker did not finish before timeout.").toBe("completed")
      expect(observed?.payload?.worker_commit_sha).toBe(requiredEnv("HARBOR_PREVIEW_EXPECTED_COMMIT_SHA"))

      const [reports, decisionRuns, gapItems, validationRuns, extractRuns] = await Promise.all([
        collectDisposableIds("reports", caseId),
        collectDisposableIds("case_decision_runs", caseId),
        collectDisposableIds("case_validation_gap_items", caseId),
        collectDisposableIds("case_validation_runs", caseId),
        collectDisposableIds("case_extract_runs", caseId),
      ])
      cleanup.reportIds = reports
      cleanup.decisionRunIds = decisionRuns
      cleanup.validationGapItemIds = gapItems
      cleanup.validationRunIds = validationRuns
      cleanup.extractRunIds = extractRuns
    } finally {
      await cleanupDisposableRecords(serviceClient, cleanup)
    }
  })

  test("delivers an authenticated SMTP sink message", async ({ page }) => {
    await authenticatedIdentity(page)
    const marker = randomUUID()
    const response = await appFetch(page, "/api/email/send", {
      method: "POST",
      body: {
        to: requiredEnv("HARBOR_PREVIEW_EMAIL_SINK"),
        subject: `Harbor preview handshake ${marker}`,
        html: `<p>Preview-only SMTP handshake ${marker}</p>`,
      },
    })
    expect(response.status).toBe(200)
    expect((response.body as { success?: boolean } | null)?.success).toBe(true)
    expect((response.body as { messageId?: string } | null)?.messageId).toBeTruthy()
  })
})

async function collectDisposableIds(table: string, caseId: string) {
  const { data, error } = await serviceClient
    .from(table)
    .select("id")
    .eq("case_id", requireUuid(caseId, "disposable case id"))
  if (error) throw new Error(`Unable to collect disposable ${table} ids: ${error.message}`)
  return (data ?? []).map((row) => requireUuid(String(row.id), `${table} id`))
}

function requiredEnv(name: (typeof requiredEnvironment)[number] | "HARBOR_PREVIEW_CONFIRM_MUTATIONS") {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function recordPreviewEvidence(result: {
  check: string
  status: string
  durationMs: number
}) {
  appendFileSync(
    evidencePath,
    `${JSON.stringify({
      observedAt: new Date().toISOString(),
      commitSha: observedReleaseSha,
      previewOrigin: new URL(requiredEnv("HARBOR_PREVIEW_BASE_URL")).origin,
      ...result,
    })}\n`,
    "utf8",
  )
}

async function assertPreviewPageOrigin(page: Page) {
  const currentUrl = new URL(page.url())
  const expectedOrigin = new URL(requiredEnv("HARBOR_PREVIEW_BASE_URL")).origin
  if (currentUrl.origin !== expectedOrigin || knownProductionHosts.has(currentUrl.hostname.toLowerCase())) {
    throw new Error(`Preview page redirected outside the configured preview origin: ${currentUrl.origin}`)
  }
}

async function authenticatedIdentity(page: Page) {
  await page.goto("/")
  await assertPreviewPageOrigin(page)
  await page.waitForFunction(() => {
    const clerkWindow = window as typeof window & {
      Clerk?: { session?: { getToken: (options: { template: string }) => Promise<string | null> } }
    }
    return Boolean(clerkWindow.Clerk?.session)
  })
  const token = await page.evaluate(async () => {
    const clerkWindow = window as typeof window & {
      Clerk?: { session?: { getToken: (options: { template: string }) => Promise<string | null> } }
    }
    return clerkWindow.Clerk?.session?.getToken({ template: "supabase" }) ?? null
  })
  expect(token).toBeTruthy()
  const profileId = decodeJwtPayload(token!).supabase_uuid
  expect(profileId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  return { token: token!, profileId }
}

function decodeJwtPayload(token: string): { supabase_uuid: string } {
  const payload = token.split(".")[1]
  if (!payload) throw new Error("Clerk Supabase JWT has no payload")
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    supabase_uuid?: unknown
  }
  if (typeof decoded.supabase_uuid !== "string") {
    throw new Error("Clerk Supabase JWT is missing supabase_uuid")
  }
  return { supabase_uuid: decoded.supabase_uuid }
}

function forgeUnsignedToken(profileId: string) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "forged", supabase_uuid: profileId })}.invalid`
}

async function appFetch(
  page: Page,
  path: string,
  options: { method: "GET" | "POST" | "PUT"; headers?: Record<string, string>; body?: unknown },
) {
  await assertPreviewPageOrigin(page)
  return page.evaluate(
    async ({ requestPath, requestOptions }) => {
      const response = await fetch(requestPath, {
        method: requestOptions.method,
        redirect: "manual",
        headers: {
          ...(requestOptions.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...requestOptions.headers,
        },
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
      })
      const text = await response.text()
      let body: unknown = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }
      return { status: response.status, body }
    },
    { requestPath: path, requestOptions: options },
  )
}
