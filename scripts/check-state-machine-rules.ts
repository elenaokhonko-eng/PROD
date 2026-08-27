import fs from "node:fs"
import path from "node:path"

type Finding = {
  rule: string
  file: string
  detail: string
}

const root = process.cwd()
const codeRoots = ["app", "components", "hooks", "lib", "worker"]
const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])
const findings: Finding[] = []

const activeFunctions = [
  "evidence_processed_v2",
  "run_case_extract_v4",
  "bright-function",
  "run_case_decision_v1",
  "run_report_selfserve_v1",
]

const archivedOrFallbackNames = [
  "candidate-transactions",
  "compute-loss",
  "gemini-task",
  "run_case_extract_v1",
  "run_case_extract_v2",
  "run_case_extract_v3",
]

const archivedFunctionFolders = [
  "supabase/functions/gemini-task",
  "supabase/functions/candidate-transactions",
  "supabase/functions/compute-loss",
  "supabase/functions/run_case_extract_v1",
  "supabase/functions/run_case_extract_v2",
  "supabase/functions/run_case_extract_v3",
]

const layer3LegacyNames = [
  "WaitlistForm",
  "WaitlistConfirmed",
  "waitlist-form",
  "waitlist-confirmed",
]

const layer3LegacyPhrases = [
  "/api/escalation-waitlist",
  "You're on the list",
  "You&apos;re on the list",
  "You’re on the list",
]

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/")
}

function exists(relPath: string): boolean {
  return fs.existsSync(path.join(root, relPath))
}

function readCodeWithoutComments(filePath: string): string {
  const source = fs.readFileSync(filePath, "utf8")
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function walk(dir: string, out: string[] = []): string[] {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) return out

  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") {
      continue
    }

    const child = path.join(abs, entry.name)
    if (entry.isDirectory()) {
      walk(path.relative(root, child), out)
      continue
    }

    if (entry.isFile() && codeExtensions.has(path.extname(entry.name))) {
      out.push(child)
    }
  }

  return out
}

function add(rule: string, file: string, detail: string) {
  findings.push({ rule, file: toPosix(path.relative(root, file)), detail })
}

function isAllowedFunctionsV1File(rel: string): boolean {
  return rel === "lib/server/edge-proxy.ts" || /^app\/api\/edge\/[^/]+\/route\.ts$/.test(rel)
}

function isAllowedActiveFunctionNameFile(rel: string): boolean {
  return rel === "lib/edge-functions.ts" || /^app\/api\/edge\/[^/]+\/route\.ts$/.test(rel)
}

function includesAny(text: string, names: string[]): string[] {
  return names.filter((name) => text.includes(name))
}

const codeFiles = codeRoots.flatMap((dir) => walk(dir))

for (const file of codeFiles) {
  const rel = toPosix(path.relative(root, file))
  const text = readCodeWithoutComments(file)

  if (text.includes("functions/v1") && !isAllowedFunctionsV1File(rel)) {
    add("R1", file, "`functions/v1` must stay inside the edge proxy surface")
  }

  const activeHits = includesAny(text, activeFunctions)
  if (activeHits.length > 0 && !isAllowedActiveFunctionNameFile(rel)) {
    add("R2", file, `active function name(s) outside allowlist: ${activeHits.join(", ")}`)
  }

  const archivedHits = includesAny(text, archivedOrFallbackNames)
  if (archivedHits.length > 0) {
    add("R2", file, `archived/fallback function name(s) in app source: ${archivedHits.join(", ")}`)
  }

  if ((rel.startsWith("app/") || rel.startsWith("lib/")) && /force\s*:\s*true/.test(text)) {
    add("R4", file, "`force: true` must not be present in app/lib code")
  }

  if ((rel.startsWith("app/") || rel.startsWith("lib/")) && text.includes("v_latest_validation")) {
    add("R5", file, "`v_latest_validation` is deprecated")
  }

  if (
    (rel.startsWith("app/") || rel.startsWith("lib/")) &&
    /import\s*\{[^}]*createClient[^}]*\}\s*from\s*["']@\/lib\/supabase\/server["']/.test(text)
  ) {
    add("R15", file, "legacy service-role `createClient` alias must not be imported")
  }

  const isLayer3Ui = rel.startsWith("components/state-machine/layer3/")
  const isContactRoute = rel === "app/api/contact-requests/route.ts"
  if ((isLayer3Ui || isContactRoute) && (text.includes("/api/edge/") || text.includes("functions/v1"))) {
    add("R12", file, "Layer 3/contact path must not call edge functions")
  }

  if (isLayer3Ui || isContactRoute) {
    const legacyNameHits = includesAny(text, layer3LegacyNames)
    if (legacyNameHits.length > 0) {
      add("R13", file, `Layer 3/contact path must not use waitlist legacy names: ${legacyNameHits.join(", ")}`)
    }

    const legacyPhraseHits = layer3LegacyPhrases.filter((phrase) => text.includes(phrase))
    if (legacyPhraseHits.length > 0) {
      add("R13", file, `Layer 3/contact path must not use waitlist legacy phrasing: ${legacyPhraseHits.join(", ")}`)
    }

    if (text.includes("linkedinUrl")) {
      add("R13", file, "Layer 3/contact path must not include LinkedIn CTA props/rendering")
    }
  }
}

if (codeFiles.some((file) => toPosix(path.relative(root, file)).startsWith("app/api/debug/"))) {
  findings.push({
    rule: "R15",
    file: "app/api/debug",
    detail: "debug API routes must not ship in the production route tree",
  })
}

for (const rel of archivedFunctionFolders) {
  if (exists(rel)) {
    findings.push({
      rule: "R2",
      file: rel,
      detail: "archived/fallback Supabase function folder must not live under supabase/functions",
    })
  }
}

// Slice 7: Pattern B remnants must not reappear in app/lib code.
const patternBIndicators = [
  "crypto.randomUUID",
  "public_metadata",
  "from('profiles').insert",
  "clerk_id",
]
const clerkWebhookPath = "app/api/webhooks/clerk/route.ts"
if (exists(clerkWebhookPath)) {
  const webhookText = readCodeWithoutComments(path.join(root, clerkWebhookPath))
  const webhookHits = patternBIndicators.filter((indicator) => webhookText.includes(indicator))
  if (webhookHits.length > 0) {
    findings.push({
      rule: "R14",
      file: clerkWebhookPath,
      detail: `Clerk webhook must not contain Pattern B profile/metadata sync remnants: ${webhookHits.join(", ")}`,
    })
  }
}

for (const file of codeFiles) {
  const rel = toPosix(path.relative(root, file))
  if (!rel.startsWith("app/") && !rel.startsWith("lib/")) continue
  if (rel === clerkWebhookPath) continue

  const text = readCodeWithoutComments(file)
  if (text.includes("crypto.randomUUID") && (text.includes("profiles") || text.includes("clerk"))) {
    findings.push({
      rule: "R14",
      file: rel,
      detail: "Pattern B random UUID/profile mapping must not appear outside the Clerk webhook",
    })
  }
}

if (findings.length > 0) {
  console.error("State-machine rule check failed:\n")
  for (const finding of findings) {
    console.error(`[${finding.rule}] ${finding.file}: ${finding.detail}`)
  }
  process.exit(1)
}

console.log("State-machine rule check passed.")
