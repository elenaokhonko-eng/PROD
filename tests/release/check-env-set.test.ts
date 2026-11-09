import assert from "node:assert/strict"
import test from "node:test"
import {
  checkEnvironmentSet,
  compareEnvironmentSets,
  parseEnvFile,
  parseRenderBlueprint,
  renderChecklist,
  stagingSupabaseRef,
  verifyStripePrices,
  type EnvFile,
  type Finding,
} from "../../scripts/check-env-set"

// Fabricated values only, assembled at runtime so no secret-shaped literal is committed.
const fake = (prefix: string, seed: string) => `${prefix}${seed.repeat(4)}abcdefghijklmnopqrstuvwxyz0123456789`
const jwt = (role: string, ref: string) =>
  ["e30", Buffer.from(JSON.stringify({ role, ref })).toString("base64url"), "sig"].join(".")
const clerkPublishable = (mode: string, host: string) => `pk_${mode}_${Buffer.from(`${host}$`).toString("base64")}`
const productionRef = "abcdefghijklmnopqrst"

// These fixtures describe an environment that takes payments (stage 2); stage 1 tests below switch it off.
function stagingValues(): Record<string, string> {
  return {
    PAID_STAGES_ENABLED: "true",
    HARBOR_DEPLOYMENT_ENVIRONMENT: "preview",
    CHECKOUT_REDIRECT_ORIGIN: "https://guidebuoy-staging.onrender.com",
    NEXT_PUBLIC_APP_URL: "https://guidebuoy-staging.onrender.com",
    HARBOR_PRODUCTION_APP_ORIGIN: "https://guidebuoyai.sg",
    NEXT_PUBLIC_SITE_URL: "https://guidebuoy-staging.onrender.com",
    NEXT_PUBLIC_SUPABASE_URL: `https://${stagingSupabaseRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon", stagingSupabaseRef),
    SUPABASE_SERVICE_ROLE_KEY: jwt("service_role", stagingSupabaseRef),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishable("test", "clean-goblin-67.clerk.accounts.dev"),
    CLERK_SECRET_KEY: fake("sk_" + "test_", "a"),
    CLERK_WEBHOOK_SIGNING_SECRET: fake("whsec_", "b"),
    STRIPE_SECRET_KEY: fake("sk_" + "test_", "c"),
    STRIPE_WEBHOOK_SECRET: fake("whsec_", "d"),
    STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD: "price_stagingselfserve",
    STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD: "price_stagingtier2",
    WORKER_SECRET: fake("", "e"),
    EDGE_PROXY_HMAC_SECRET: fake("", "f"),
    SIMULATION_KEY: fake("", "g"),
    GOOGLE_GENERATIVE_AI_API_KEY: "google-staging",
    OPENAI_API_KEY: "openai-staging",
    SMTP_HOST: "sandbox.smtp.mailtrap.io",
    SMTP_PORT: "587",
    SMTP_USER: "user",
    SMTP_PASS: "pass-staging",
    EMAIL_FROM: "hello@guidebuoyai.sg",
    EMAIL_FROM_NAME: "GuideBuoy",
    ADMIN_EMAIL: "admin@guidebuoyai.sg",
    GuideBuoy_EdgeFunction: "edge-openai-staging",
    GEMINI_API_KEY: "gemini-staging",
  }
}

function productionValues(): Record<string, string> {
  return {
    ...stagingValues(),
    HARBOR_DEPLOYMENT_ENVIRONMENT: "production",
    LEGAL_EFFECTIVE_DATE: "2026-11-10",
    CHECKOUT_REDIRECT_ORIGIN: "https://guidebuoyai.sg",
    NEXT_PUBLIC_APP_URL: "https://guidebuoyai.sg",
    NEXT_PUBLIC_SITE_URL: "https://guidebuoyai.sg",
    NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon", productionRef),
    SUPABASE_SERVICE_ROLE_KEY: jwt("service_role", productionRef),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishable("live", "clerk.guidebuoyai.sg"),
    CLERK_SECRET_KEY: fake("sk_" + "live_", "h"),
    CLERK_WEBHOOK_SIGNING_SECRET: fake("whsec_", "i"),
    STRIPE_SECRET_KEY: fake("sk_" + "live_", "j"),
    STRIPE_WEBHOOK_SECRET: fake("whsec_", "k"),
    STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD: "price_1TsLZdFp6sSKMUXXz5xEbxrA",
    STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD: "price_1TsLY5Fp6sSKMUXXdHFwRsny",
    WORKER_SECRET: fake("", "l"),
    EDGE_PROXY_HMAC_SECRET: fake("", "m"),
    SIMULATION_KEY: fake("", "n"),
    GOOGLE_GENERATIVE_AI_API_KEY: "google-production",
    OPENAI_API_KEY: "openai-production",
    SMTP_HOST: "live.smtp.mailtrap.io",
    SMTP_PASS: "pass-production",
    GuideBuoy_EdgeFunction: "edge-openai-production",
    GEMINI_API_KEY: "gemini-production",
  }
}

const file = (values: Record<string, string>): EnvFile => ({ values, duplicates: [], malformedLines: [] })
const failures = (findings: Finding[]) => findings.filter((finding) => finding.status === "FAIL").map((finding) => finding.check)

test("a complete staging set passes", () => {
  assert.deepEqual(failures(checkEnvironmentSet("staging", file(stagingValues()))), [])
})

test("a complete production set passes once the PROD ref is confirmed", () => {
  const findings = checkEnvironmentSet("production", file(productionValues()), { productionRef })
  assert.deepEqual(failures(findings), [])
  assert.ok(!findings.some((finding) => finding.status === "PENDING"))
})

test("the legal effective date is pending until set in production, and must be a date", () => {
  const values = productionValues()
  values.LEGAL_EFFECTIVE_DATE = ""
  const pending = checkEnvironmentSet("production", file(values), { productionRef })
  assert.deepEqual(failures(pending), [])
  assert.ok(pending.some((finding) => finding.status === "PENDING" && finding.check.startsWith("LEGAL_EFFECTIVE_DATE")))
  values.LEGAL_EFFECTIVE_DATE = "10 Nov 2026"
  assert.ok(failures(checkEnvironmentSet("production", file(values), { productionRef })).includes("LEGAL_EFFECTIVE_DATE is a date"))
})

test("production is pending until Gate G4 confirms the Supabase ref", () => {
  const findings = checkEnvironmentSet("production", file(productionValues()))
  assert.ok(findings.some((finding) => finding.status === "PENDING"))
})

test("staging webhook secrets and origins are pending, not failing, before Phase 3", () => {
  const values = stagingValues()
  for (const key of ["CLERK_WEBHOOK_SIGNING_SECRET", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_APP_URL", "CHECKOUT_REDIRECT_ORIGIN"]) values[key] = ""
  const findings = checkEnvironmentSet("staging", file(values))
  assert.deepEqual(failures(findings), [])
  assert.equal(findings.filter((finding) => finding.status === "PENDING").length, 4)
})

test("a half-filled origin pair still fails", () => {
  const values = stagingValues()
  values.CHECKOUT_REDIRECT_ORIGIN = ""
  assert.ok(failures(checkEnvironmentSet("staging", file(values))).includes("required variables present") === false)
  assert.ok(failures(checkEnvironmentSet("staging", file(values))).includes("CHECKOUT_REDIRECT_ORIGIN equals NEXT_PUBLIC_APP_URL"))
})

test("duplicate keys fail and the last value is not silently trusted", () => {
  const parsed = parseEnvFile("NEXT_PUBLIC_SUPABASE_URL=https://a.supabase.co\r\n# note\r\nNEXT_PUBLIC_SUPABASE_URL=https://b.supabase.co\r\n")
  assert.deepEqual(parsed.duplicates, ["NEXT_PUBLIC_SUPABASE_URL"])
  assert.ok(failures(checkEnvironmentSet("staging", parsed)).includes("one value per key"))
})

test("cross-wired Supabase keys, live Stripe keys, and live prices fail in staging", () => {
  const values = stagingValues()
  values.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt("anon", "ujilatkjweudsptpoqyr")
  values.STRIPE_SECRET_KEY = fake("sk_" + "live_", "z")
  values.STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD = "price_1TsLZdFp6sSKMUXXz5xEbxrA"
  values.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = clerkPublishable("live", "clerk.guidebuoyai.sg")
  const failed = failures(checkEnvironmentSet("staging", file(values)))
  assert.ok(failed.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY ref matches URL"))
  assert.ok(failed.includes("Stripe secret key is test mode"))
  assert.ok(failed.includes("STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD is not the live-mode price"))
  assert.ok(failed.includes("Clerk publishable key is pk_test"))
})

test("staging checkout cannot target the production origin", () => {
  const values = stagingValues()
  values.CHECKOUT_REDIRECT_ORIGIN = "https://guidebuoyai.sg"
  values.NEXT_PUBLIC_APP_URL = "https://guidebuoyai.sg"
  assert.ok(failures(checkEnvironmentSet("staging", file(values))).includes("checkout redirect origin resolves (lib/payments/product-catalogue)"))
})

test("short HMAC secrets and service-role keys in NEXT_PUBLIC_* fail", () => {
  const values = stagingValues()
  values.EDGE_PROXY_HMAC_SECRET = "too-short"
  values.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt("service_role", stagingSupabaseRef)
  const failed = failures(checkEnvironmentSet("staging", file(values)))
  assert.ok(failed.includes("EDGE_PROXY_HMAC_SECRET is at least 32 bytes"))
  assert.ok(failed.includes("no secrets in NEXT_PUBLIC_*"))
})

test("generated secrets must differ between environments", () => {
  const production = productionValues()
  production.WORKER_SECRET = stagingValues().WORKER_SECRET
  assert.deepEqual(failures(compareEnvironmentSets(file(stagingValues()), file(production))), ["WORKER_SECRET differs between staging and production"])
})

test("model settings must be lower-case IDs the health check has verified", () => {
  const values = {
    ...productionValues(),
    GOOGLE_GENERATIVE_AI_MODEL: "gemini-3.8-flash",
    OPENAI_MODEL: "gpt-4.1-mini",
    CASE_DECISION_MODEL: "gpt-4.1-mini",
  }
  assert.deepEqual(failures(checkEnvironmentSet("production", file(values), { productionRef })), [])

  const findings = checkEnvironmentSet(
    "production",
    file({ ...values, OPENAI_MODEL: "GPT-4.1-mini", EVIDENCE_GEMINI_MODEL: "gemini-2.5-flash" }),
    { productionRef },
  )
  const failed = findings.filter((finding) => finding.status === "FAIL")
  assert.deepEqual(
    failed.map((finding) => finding.check),
    [
      "OPENAI_MODEL is a lower-case model ID the health check has verified",
      "EVIDENCE_GEMINI_MODEL is a lower-case model ID the health check has verified",
    ],
  )
  assert.equal(failed[0].detail, "contains capital letters")
  assert.match(failed[1].detail ?? "", /not in CHECKED_MODEL_IDS/)
})

test("render checklist reports readiness without values", () => {
  const blueprint = parseRenderBlueprint([
    "services:",
    "  - type: web",
    "    name: web",
    "    envVars:",
    "      - key: STRIPE_SECRET_KEY",
    "        sync: false",
    "      - key: WORKER_SECRET",
    "        generateValue: true",
  ].join("\n"))
  const checklist = renderChecklist(blueprint, { staging: file(stagingValues()) })
  assert.match(checklist, /\| `STRIPE_SECRET_KEY` \| enter in dashboard \| ready \| no file \|/)
  assert.match(checklist, /\| `WORKER_SECRET` \| generated by Render \| n\/a \| n\/a \|/)
  assert.doesNotMatch(checklist, /sk_test_/)
})

test("stage 1: with paid stages off, Stripe settings are not required and prices are not looked up", async () => {
  const values = stagingValues()
  delete values.PAID_STAGES_ENABLED
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD", "STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD"]) delete values[key]
  const findings = checkEnvironmentSet("staging", file(values))
  assert.deepEqual(failures(findings), [])
  assert.ok(findings.some((f) => f.check === "paid stages off (stage 1)"))
  const prices = await verifyStripePrices("staging", file(values))
  assert.deepEqual(prices.map((f) => [f.status, f.detail]), [["PASS", "skipped: paid stages are off (stage 1)"]])
})

test("stage 2: with paid stages on, a missing Stripe key still fails", () => {
  const values = stagingValues()
  values.STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD = ""
  assert.ok(failures(checkEnvironmentSet("staging", file(values))).includes("required variables present"))
})

test("PAID_STAGES_AVAILABLE_FROM must be a date", () => {
  const values = stagingValues()
  values.PAID_STAGES_AVAILABLE_FROM = "early December"
  assert.ok(failures(checkEnvironmentSet("staging", file(values))).includes("PAID_STAGES_AVAILABLE_FROM is a date"))
})
