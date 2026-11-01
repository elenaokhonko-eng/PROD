import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { resolveCheckoutRedirectOrigin } from "../lib/payments/product-catalogue"

// Validates one environment's git-ignored env file against the release contract
// in docs/release-operations.md. Reports variable names, key types, refs, and
// lengths only; values are never printed.

export type EnvironmentName = "staging" | "production"
export type Status = "PASS" | "WARN" | "FAIL" | "PENDING"
export type Finding = { status: Status; check: string; detail?: string }
export type EnvFile = { values: Record<string, string>; duplicates: string[]; malformedLines: number[] }

export const stagingSupabaseRef = "yqqkkftfddxuxmpxwbcj"
const retiredSupabaseRefs = ["iyinkfbarokqugsxggol", "ypifhfivvhvoiadytwem"]
const productionClerkFrontendApi = "clerk.guidebuoyai.sg"
const liveStripePriceIds: Record<string, string> = {
  STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD: "price_1TsLZdFp6sSKMUXXz5xEbxrA",
  STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD: "price_1TsLY5Fp6sSKMUXXdHFwRsny",
}
const expectedPriceAmounts: Record<string, number> = {
  STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD: 1800,
  STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD: 18800,
}

export const requiredKeys = [
  "HARBOR_DEPLOYMENT_ENVIRONMENT",
  "CHECKOUT_REDIRECT_ORIGIN",
  "HARBOR_PRODUCTION_APP_ORIGIN",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID_SELF_SERVE_REPORT_SGD",
  "STRIPE_PRICE_ID_FIDREC_TIER2_PACK_SGD",
  "WORKER_SECRET",
  "EDGE_PROXY_HMAC_SECRET",
  "SIMULATION_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "ADMIN_EMAIL",
  // Supabase Edge Function secrets (set with `supabase secrets set`, not on Render).
  "GuideBuoy_EdgeFunction",
  "GEMINI_API_KEY",
] as const

export const optionalKeys = [
  "STRIPE_PRICE_ID_HUMAN_CONSULT_30M_SGD",
  "GOOGLE_GENERATIVE_AI_MODEL",
  "OPENAI_MODEL",
  "SMTP_SECURE",
  "SMTP_REQUIRE_TLS",
  "SMTP_CONNECTION_TIMEOUT_MS",
  "SMTP_SOCKET_TIMEOUT_MS",
  "SMTP_MAX_CONNECTIONS",
  "SMTP_MAX_MESSAGES",
  "SMTP_MAX_RETRIES",
  "LOG_LEVEL",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL",
  "SUPABASE_CASE_PACK_BUCKET",
  "EVIDENCE_GEMINI_MODEL",
  "CASE_DECISION_MODEL",
  "CASE_EXTRACT_MODEL",
  "SELF_SERVE_REPORT_MODEL",
  "CLERK_RECONCILIATION_USER_ALLOWLIST_JSON",
  "SUPABASE_STAGING_DB_URL",
  "SUPABASE_PRODUCTION_DB_URL",
] as const

const generatedSecretKeys = ["EDGE_PROXY_HMAC_SECRET", "WORKER_SECRET", "SIMULATION_KEY"] as const
const providerSecretKeys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "SMTP_PASS",
  "GuideBuoy_EdgeFunction",
  "GEMINI_API_KEY",
] as const

export function parseEnvFile(text: string): EnvFile {
  const values: Record<string, string> = {}
  const duplicates = new Set<string>()
  const malformedLines: number[] = []

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith("#")) return
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) {
      malformedLines.push(index + 1)
      return
    }
    const [, key, rawValue] = match
    if (key in values) duplicates.add(key)
    values[key] = unquote(rawValue)
  })

  return { values, duplicates: [...duplicates], malformedLines }
}

function unquote(value: string) {
  const quoted = /^(["'])(.*)\1$/.exec(value)
  if (quoted) return quoted[2]
  return value.replace(/\s+#.*$/, "").trim()
}

type SupabaseKey =
  | { kind: "jwt"; role: string | null; ref: string | null }
  | { kind: "publishable" | "secret" | "unknown" }

export function inspectSupabaseKey(value: string): SupabaseKey {
  if (value.startsWith("sb_publishable_")) return { kind: "publishable" }
  if (value.startsWith("sb_secret_")) return { kind: "secret" }
  const parts = value.split(".")
  if (parts.length !== 3) return { kind: "unknown" }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>
    return {
      kind: "jwt",
      role: typeof payload.role === "string" ? payload.role : null,
      ref: typeof payload.ref === "string" ? payload.ref : null,
    }
  } catch {
    return { kind: "unknown" }
  }
}

export function clerkFrontendApi(publishableKey: string): string | null {
  const match = /^pk_(?:test|live)_(.+)$/.exec(publishableKey)
  if (!match) return null
  const decoded = Buffer.from(match[1], "base64").toString("utf8")
  return decoded.endsWith("$") ? decoded.slice(0, -1) : null
}

function supabaseRefFromUrl(value: string): string | null {
  try {
    const url = new URL(value)
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)
    return url.protocol === "https:" && match ? match[1] : null
  } catch {
    return null
  }
}

function looksHighEntropy(value: string) {
  return Buffer.byteLength(value, "utf8") >= 32 && new Set(value).size >= 16
}

function isPlaceholder(value: string) {
  return /^<.*>$|changeme|placeholder|^x+$|^\.\.\.$/i.test(value)
}

function keyType(value: string) {
  const prefix = /^(sk_test|sk_live|rk_test|rk_live|pk_test|pk_live|whsec|sb_publishable|sb_secret)_/.exec(value)
  return prefix ? prefix[1] : "other"
}

export function checkEnvironmentSet(
  environment: EnvironmentName,
  file: EnvFile,
  options: { productionRef?: string } = {},
): Finding[] {
  const findings: Finding[] = []
  const env = file.values
  const get = (key: string) => env[key]?.trim() ?? ""
  const add = (status: Status, check: string, detail?: string) => findings.push({ status, check, detail })
  const isStaging = environment === "staging"

  add(file.duplicates.length ? "FAIL" : "PASS", "one value per key", file.duplicates.length ? `duplicated: ${file.duplicates.join(", ")}` : undefined)
  if (file.malformedLines.length) add("FAIL", "parseable lines", `malformed line numbers: ${file.malformedLines.join(", ")}`)

  const missing = requiredKeys.filter((key) => !get(key))
  add(missing.length ? "FAIL" : "PASS", "required variables present", missing.length ? `blank or absent: ${missing.join(", ")}` : undefined)
  const placeholders = Object.keys(env).filter((key) => get(key) && isPlaceholder(get(key)))
  if (placeholders.length) add("FAIL", "no placeholder values", placeholders.join(", "))
  const known = new Set<string>([...requiredKeys, ...optionalKeys])
  const unknown = Object.keys(env).filter((key) => !known.has(key))
  if (unknown.length) add("WARN", "unrecognised variables", unknown.join(", "))

  const exposed = Object.keys(env).filter((key) => {
    if (!key.startsWith("NEXT_PUBLIC_")) return false
    const value = get(key)
    const supabase = inspectSupabaseKey(value)
    return /^(sk|rk)_(test|live)_|^whsec_|^sb_secret_/.test(value) || (supabase.kind === "jwt" && supabase.role === "service_role")
  })
  add(exposed.length ? "FAIL" : "PASS", "no secrets in NEXT_PUBLIC_*", exposed.length ? exposed.join(", ") : undefined)

  // Deployment class and origins, using the app's own checkout origin resolver.
  const expectedDeployment = isStaging ? "preview" : "production"
  add(
    get("HARBOR_DEPLOYMENT_ENVIRONMENT") === expectedDeployment ? "PASS" : "FAIL",
    `HARBOR_DEPLOYMENT_ENVIRONMENT is ${expectedDeployment}`,
  )
  add(
    get("CHECKOUT_REDIRECT_ORIGIN") && get("CHECKOUT_REDIRECT_ORIGIN") === get("NEXT_PUBLIC_APP_URL") ? "PASS" : "FAIL",
    "CHECKOUT_REDIRECT_ORIGIN equals NEXT_PUBLIC_APP_URL",
  )
  add(
    resolveCheckoutRedirectOrigin(env) ? "PASS" : "FAIL",
    "checkout redirect origin resolves (lib/payments/product-catalogue)",
    isStaging ? "preview origin must be HTTPS, path-free, and differ from HARBOR_PRODUCTION_APP_ORIGIN" : "production origin must equal HARBOR_PRODUCTION_APP_ORIGIN",
  )
  if (isStaging) {
    let host = ""
    try { host = new URL(get("NEXT_PUBLIC_APP_URL")).hostname } catch { /* reported above */ }
    add(host.endsWith(".onrender.com") ? "PASS" : "WARN", "staging origin is a Render hostname", "preview test lanes refuse non-onrender.com hosts")
  }

  // Supabase project binding.
  const urlRef = supabaseRefFromUrl(get("NEXT_PUBLIC_SUPABASE_URL"))
  add(urlRef ? "PASS" : "FAIL", "NEXT_PUBLIC_SUPABASE_URL is https://<ref>.supabase.co", urlRef ? `ref ${urlRef}` : undefined)
  if (urlRef) {
    if (isStaging) {
      add(urlRef === stagingSupabaseRef ? "PASS" : "FAIL", `Supabase ref is staging ${stagingSupabaseRef}`)
    } else {
      if (urlRef === stagingSupabaseRef) add("FAIL", "production Supabase ref differs from staging")
      if (retiredSupabaseRefs.includes(urlRef)) add("FAIL", "production Supabase ref is not a paused legacy project", urlRef)
      if (!options.productionRef) add("PENDING", "production Supabase ref confirmed at Gate G4", "pass --production-ref <ref> once decided")
      else add(urlRef === options.productionRef ? "PASS" : "FAIL", `Supabase ref equals confirmed PROD ref ${options.productionRef}`)
    }
  }
  for (const [key, expectedRole, newKind] of [
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon", "publishable"],
    ["SUPABASE_SERVICE_ROLE_KEY", "service_role", "secret"],
  ] as const) {
    if (!get(key)) continue
    const inspected = inspectSupabaseKey(get(key))
    if (inspected.kind === "jwt") {
      add(inspected.role === expectedRole ? "PASS" : "FAIL", `${key} role is ${expectedRole}`, `role ${inspected.role ?? "missing"}`)
      add(inspected.ref && inspected.ref === urlRef ? "PASS" : "FAIL", `${key} ref matches URL`, `key ref ${inspected.ref ?? "missing"}`)
    } else if (inspected.kind === newKind) {
      add("WARN", `${key} ref matches URL`, `sb_${newKind}_ keys do not encode a ref; confirm in the dashboard`)
    } else {
      add("FAIL", `${key} is a Supabase ${expectedRole} key`, `type ${inspected.kind}`)
    }
  }
  const dbUrlKey = isStaging ? "SUPABASE_STAGING_DB_URL" : "SUPABASE_PRODUCTION_DB_URL"
  if (get(dbUrlKey)) {
    add(urlRef && get(dbUrlKey).includes(urlRef) ? "PASS" : "FAIL", `${dbUrlKey} targets the same project ref`)
  }

  // Clerk instance.
  const clerkMode = isStaging ? "test" : "live"
  const publishable = get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
  add(publishable.startsWith(`pk_${clerkMode}_`) ? "PASS" : "FAIL", `Clerk publishable key is pk_${clerkMode}`, `type ${keyType(publishable)}`)
  add(get("CLERK_SECRET_KEY").startsWith(`sk_${clerkMode}_`) ? "PASS" : "FAIL", `Clerk secret key is sk_${clerkMode}`, `type ${keyType(get("CLERK_SECRET_KEY"))}`)
  const frontendApi = clerkFrontendApi(publishable)
  if (frontendApi) {
    const ok = isStaging ? frontendApi.endsWith(".clerk.accounts.dev") : frontendApi === productionClerkFrontendApi
    add(ok ? "PASS" : "FAIL", isStaging ? "Clerk instance is the Development instance" : `Clerk instance is ${productionClerkFrontendApi}`, `frontend API ${frontendApi}`)
  }
  add(get("CLERK_WEBHOOK_SIGNING_SECRET").startsWith("whsec_") ? "PASS" : "FAIL", "CLERK_WEBHOOK_SIGNING_SECRET is a Svix whsec_ secret")

  // Stripe mode.
  const stripeMode = isStaging ? "test" : "live"
  const stripeKey = get("STRIPE_SECRET_KEY")
  add(new RegExp(`^(sk|rk)_${stripeMode}_`).test(stripeKey) ? "PASS" : "FAIL", `Stripe secret key is ${stripeMode} mode`, `type ${keyType(stripeKey)}`)
  add(get("STRIPE_WEBHOOK_SECRET").startsWith("whsec_") ? "PASS" : "FAIL", "STRIPE_WEBHOOK_SECRET is a whsec_ secret")
  if (get("STRIPE_WEBHOOK_SECRET") && get("STRIPE_WEBHOOK_SECRET") === get("CLERK_WEBHOOK_SIGNING_SECRET")) {
    add("FAIL", "Stripe and Clerk webhook secrets differ")
  }
  for (const [key, liveId] of Object.entries(liveStripePriceIds)) {
    const value = get(key)
    if (!value) continue
    if (!value.startsWith("price_")) add("FAIL", `${key} is a Stripe price ID`)
    else if (isStaging) add(value === liveId ? "FAIL" : "PASS", `${key} is not the live-mode price`)
    else add(value === liveId ? "PASS" : "WARN", `${key} matches the reviewed live price`)
  }

  // Generated shared secrets.
  add(Buffer.byteLength(get("EDGE_PROXY_HMAC_SECRET"), "utf8") >= 32 ? "PASS" : "FAIL", "EDGE_PROXY_HMAC_SECRET is at least 32 bytes", `${Buffer.byteLength(get("EDGE_PROXY_HMAC_SECRET"), "utf8")} bytes`)
  for (const key of generatedSecretKeys) {
    if (get(key)) add(looksHighEntropy(get(key)) ? "PASS" : "FAIL", `${key} is high-entropy`, `${get(key).length} chars`)
  }
  const generated = generatedSecretKeys.map(get).filter(Boolean)
  add(new Set(generated).size === generated.length ? "PASS" : "FAIL", "generated secrets are distinct from each other")

  // Email.
  const smtpHost = get("SMTP_HOST").toLowerCase()
  if (smtpHost) {
    const sandbox = smtpHost === "sandbox.smtp.mailtrap.io"
    if (isStaging) add(sandbox ? "PASS" : "WARN", "staging SMTP is the Mailtrap sandbox", `host ${smtpHost}`)
    else add(sandbox ? "FAIL" : "PASS", "production SMTP is not a sandbox", `host ${smtpHost}`)
  }
  if (!isStaging && get("EMAIL_FROM")) {
    add(/@guidebuoyai\.sg>?$/i.test(get("EMAIL_FROM")) ? "PASS" : "WARN", "production EMAIL_FROM uses the verified guidebuoyai.sg domain")
  }

  return findings
}

export function compareEnvironmentSets(staging: EnvFile, production: EnvFile): Finding[] {
  const findings: Finding[] = []
  for (const key of generatedSecretKeys) {
    const a = staging.values[key]?.trim()
    const b = production.values[key]?.trim()
    if (a && b) findings.push({ status: a === b ? "FAIL" : "PASS", check: `${key} differs between staging and production` })
  }
  const shared = providerSecretKeys.filter((key) => {
    const a = staging.values[key]?.trim()
    return a && a === production.values[key]?.trim()
  })
  findings.push({
    status: shared.length ? "WARN" : "PASS",
    check: "provider secrets are separate per environment",
    detail: shared.length ? `identical in both: ${shared.join(", ")}` : undefined,
  })
  return findings
}

export async function verifyStripePrices(environment: EnvironmentName, file: EnvFile): Promise<Finding[]> {
  const secret = file.values.STRIPE_SECRET_KEY?.trim()
  if (!secret) return [{ status: "FAIL", check: "Stripe price lookup", detail: "STRIPE_SECRET_KEY is blank" }]
  const findings: Finding[] = []
  for (const [key, amount] of Object.entries(expectedPriceAmounts)) {
    const priceId = file.values[key]?.trim()
    if (!priceId) continue
    const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    if (!response.ok) {
      findings.push({ status: "FAIL", check: `${key} exists in this Stripe mode`, detail: `HTTP ${response.status}` })
      continue
    }
    const price = (await response.json()) as { livemode: boolean; currency: string; unit_amount: number | null; type: string; active: boolean }
    const ok = price.livemode === (environment === "production") && price.currency === "sgd" && price.unit_amount === amount && price.type === "one_time" && price.active
    findings.push({
      status: ok ? "PASS" : "FAIL",
      check: `${key} is an active one-time S$${amount / 100} ${environment === "production" ? "live" : "test"} price`,
      detail: `livemode=${price.livemode} currency=${price.currency} amount=${price.unit_amount} type=${price.type} active=${price.active}`,
    })
  }
  return findings
}

type RenderVariable = { key: string; mode: string }

export function parseRenderBlueprint(text: string): Record<string, RenderVariable[]> {
  const services: Record<string, RenderVariable[]> = {}
  let service = ""
  let current: RenderVariable | null = null
  for (const line of text.split(/\r?\n/)) {
    const name = /^\s{4}name:\s*(\S+)/.exec(line)
    if (name) service = name[1]
    const key = /^\s+- key:\s*(\S+)/.exec(line)
    if (key && service) {
      current = { key: key[1], mode: "" }
      ;(services[service] ??= []).push(current)
      continue
    }
    const mode = /^\s{8}(sync|value|generateValue|fromService):\s*(.*)$/.exec(line)
    if (mode && current && !current.mode) {
      current.mode =
        mode[1] === "sync" ? "enter in dashboard"
          : mode[1] === "value" ? `fixed in render.yaml (${mode[2].replace(/"/g, "")})`
            : mode[1] === "generateValue" ? "generated by Render"
              : "copied from web service"
    }
  }
  return services
}

export function renderChecklist(blueprint: Record<string, RenderVariable[]>, sets: Partial<Record<EnvironmentName, EnvFile>>) {
  const status = (file: EnvFile | undefined, variable: RenderVariable) => {
    if (!variable.mode.startsWith("enter")) return "n/a"
    if (!file) return "no file"
    const value = file.values[variable.key]?.trim()
    return value ? "ready" : "BLANK"
  }
  const lines: string[] = []
  for (const [service, variables] of Object.entries(blueprint)) {
    lines.push(`\n### ${service}\n`, "| Variable | How it is set | Staging | Production |", "| --- | --- | --- | --- |")
    for (const variable of variables) {
      lines.push(`| \`${variable.key}\` | ${variable.mode} | ${status(sets.staging, variable)} | ${status(sets.production, variable)} |`)
    }
  }
  lines.push(
    "\nNot on Render: `RENDER_GIT_COMMIT` is injected by Render. `GuideBuoy_EdgeFunction`, `GEMINI_API_KEY`, `SIMULATION_KEY` and `EDGE_PROXY_HMAC_SECRET` must also be set as Supabase function secrets.",
    "`WORKER_SECRET` is generated per Render service pair, so the env-file value is for local runs only.",
  )
  return lines.join("\n")
}

function parseArgs(args: string[]) {
  const options: { staging?: string; production?: string; productionRef?: string; verifyStripe: boolean; renderChecklist: boolean } = {
    verifyStripe: false,
    renderChecklist: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--staging") options.staging = args[++index]
    else if (arg === "--production") options.production = args[++index]
    else if (arg === "--production-ref") options.productionRef = args[++index]
    else if (arg === "--verify-stripe") options.verifyStripe = true
    else if (arg === "--render-checklist") options.renderChecklist = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!options.staging && !options.production) {
    throw new Error("Usage: check-env-set --staging <file> --production <file> [--production-ref <ref>] [--verify-stripe] [--render-checklist]")
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const sets: Partial<Record<EnvironmentName, EnvFile>> = {}
  const all: Finding[] = []

  for (const environment of ["staging", "production"] as const) {
    const path = options[environment]
    if (!path) continue
    const file = parseEnvFile(readFileSync(resolve(process.cwd(), path), "utf8"))
    sets[environment] = file
    const findings = checkEnvironmentSet(environment, file, { productionRef: options.productionRef })
    if (options.verifyStripe) findings.push(...(await verifyStripePrices(environment, file)))
    printFindings(`${environment} (${path})`, findings)
    all.push(...findings)
  }
  if (sets.staging && sets.production) {
    const findings = compareEnvironmentSets(sets.staging, sets.production)
    printFindings("cross-environment", findings)
    all.push(...findings)
  }
  if (options.renderChecklist) {
    const blueprint = parseRenderBlueprint(readFileSync(resolve(process.cwd(), "render.yaml"), "utf8"))
    console.log("\n## Render variable checklist")
    console.log(renderChecklist(blueprint, sets))
  }

  const failed = all.filter((finding) => finding.status === "FAIL").length
  const pending = all.filter((finding) => finding.status === "PENDING").length
  console.log(`\n${failed} failed, ${pending} pending, ${all.filter((finding) => finding.status === "WARN").length} warnings`)
  process.exitCode = failed ? 1 : pending ? 2 : 0
}

function printFindings(title: string, findings: Finding[]) {
  console.log(`\n## ${title}`)
  for (const finding of findings) {
    console.log(`${finding.status.padEnd(7)} ${finding.check}${finding.detail ? ` — ${finding.detail}` : ""}`)
  }
}

const entryPoint = process.argv[1]?.replace(/\\/g, "/")
if (entryPoint?.endsWith("/check-env-set.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
