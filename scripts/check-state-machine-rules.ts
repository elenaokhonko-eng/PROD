import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

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

const functionsV1Allowlist = new Set([
  "lib/server/edge-proxy.ts",
  "lib/server/edge-request-signing.ts",
])

function isAllowedFunctionsV1File(rel: string): boolean {
  return functionsV1Allowlist.has(rel) || /^app\/api\/edge\/[^/]+\/route\.ts$/.test(rel)
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
const patternBProfileSyncIndicators = ["public_metadata", "clerk_id"]

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

type PatternBValue = {
  stringValue?: string
  tableBuilder?: string
  generated?: boolean
}

type DataMutationInspection = {
  profileMutation: boolean
  generatedProfileIdentity: boolean
  invitationMutation: boolean
}

function inspectDataMutations(text: string): DataMutationInspection {
  const sourceFile = ts.createSourceFile("pattern-b-check.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const scopes: Map<string, PatternBValue>[] = [new Map()]
  let profileMutation = false
  let generatedProfileIdentity = false
  let invitationMutation = false

  const lookup = (name: string): PatternBValue => {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const value = scopes[index].get(name)
      if (value) return value
    }
    return {}
  }

  const assign = (name: string, value: PatternBValue, declaration = false) => {
    if (declaration) {
      scopes[scopes.length - 1].set(name, value)
      return
    }
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      if (scopes[index].has(name)) {
        scopes[index].set(name, value)
        return
      }
    }
    scopes[scopes.length - 1].set(name, value)
  }

  const evaluate = (expression: ts.Expression): PatternBValue => {
    const value = unwrapExpression(expression)
    if (ts.isStringLiteralLike(value)) return { stringValue: value.text }
    if (ts.isIdentifier(value)) return { ...lookup(value.text) }
    if (ts.isCallExpression(value)) {
      const callee = unwrapExpression(value.expression)
      const generatedName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ""
      if (["randomUUID", "uuidv4", "v4", "nanoid"].includes(generatedName)) return { generated: true }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "from" && value.arguments[0]) {
        const tableName = evaluate(value.arguments[0]).stringValue
        if (tableName) return { tableBuilder: tableName }
      }
    }

    let generated = false
    const inspectChild = (child: ts.Node) => {
      if (generated) return
      if (ts.isExpression(child) && evaluate(child).generated) {
        generated = true
        return
      }
      ts.forEachChild(child, inspectChild)
    }
    ts.forEachChild(value, inspectChild)
    return generated ? { generated: true } : {}
  }

  let visit: (node: ts.Node) => void

  const inspectExpression = (expression: ts.Expression) => {
    const value = unwrapExpression(expression)
    if (ts.isFunctionLike(value)) {
      visit(value)
      return
    }
    if (
      ts.isBinaryExpression(value) &&
      value.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(value.left)
    ) {
      inspectExpression(value.right)
      assign(value.left.text, evaluate(value.right))
      return
    }
    if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
      const method = value.expression.name.text
      if (["insert", "upsert"].includes(method)) {
        const tableName = evaluate(value.expression.expression).tableBuilder
        if (tableName === "profiles") {
          profileMutation = true
          if (value.arguments.some((argument) => evaluate(argument).generated)) generatedProfileIdentity = true
        }
        if (tableName === "invitations") invitationMutation = true
      }
    }
    const inspectChild = (child: ts.Node) => {
      if (ts.isExpression(child)) {
        inspectExpression(child)
      } else {
        ts.forEachChild(child, inspectChild)
      }
    }
    ts.forEachChild(value, inspectChild)
  }

  const predeclareConstants = (statements: ts.NodeArray<ts.Statement>) => {
    for (let pass = 0; pass < statements.length; pass += 1) {
      for (const statement of statements) {
        if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
          const initializer = unwrapExpression(declaration.initializer)
          if (!ts.isFunctionLike(initializer)) assign(declaration.name.text, evaluate(initializer), true)
        }
      }
    }
  }

  visit = (node: ts.Node) => {
    if (ts.isSourceFile(node)) {
      predeclareConstants(node.statements)
      node.statements.forEach(visit)
      return
    }
    if (ts.isBlock(node) || ts.isFunctionLike(node)) {
      scopes.push(new Map())
      if (ts.isFunctionLike(node)) {
        for (const parameter of node.parameters) {
          if (ts.isIdentifier(parameter.name)) assign(parameter.name.text, {}, true)
        }
        if ("body" in node && node.body) {
          if (ts.isBlock(node.body)) visit(node.body)
          else inspectExpression(node.body)
        }
      } else {
        predeclareConstants(node.statements)
        node.statements.forEach(visit)
      }
      scopes.pop()
      return
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      scopes.push(new Map())
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const declaration of node.initializer.declarations) {
          if (ts.isIdentifier(declaration.name)) assign(declaration.name.text, {}, true)
        }
      } else {
        inspectExpression(node.initializer)
      }
      inspectExpression(node.expression)
      visit(node.statement)
      scopes.pop()
      return
    }
    if (ts.isForStatement(node)) {
      scopes.push(new Map())
      if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
        for (const declaration of node.initializer.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue
          if (declaration.initializer) inspectExpression(declaration.initializer)
          assign(declaration.name.text, declaration.initializer ? evaluate(declaration.initializer) : {}, true)
        }
      } else if (node.initializer) {
        inspectExpression(node.initializer as ts.Expression)
      }
      if (node.condition) inspectExpression(node.condition)
      visit(node.statement)
      if (node.incrementor) inspectExpression(node.incrementor)
      scopes.pop()
      return
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        if (declaration.initializer) inspectExpression(declaration.initializer)
        const isFunction = declaration.initializer && ts.isFunctionLike(unwrapExpression(declaration.initializer))
        assign(declaration.name.text, declaration.initializer && !isFunction ? evaluate(declaration.initializer) : {}, true)
      }
      return
    }
    if (ts.isExpressionStatement(node)) {
      inspectExpression(node.expression)
      return
    }
    ts.forEachChild(node, (child) => {
      if (ts.isExpression(child)) inspectExpression(child)
      else visit(child)
    })
  }

  visit(sourceFile)
  return { profileMutation, generatedProfileIdentity, invitationMutation }
}

export function inspectProfileMutations(text: string): { found: boolean; generatedIdentity: boolean } {
  const result = inspectDataMutations(text)
  return { found: result.profileMutation, generatedIdentity: result.generatedProfileIdentity }
}

export function inspectInvitationMutations(text: string): boolean {
  return inspectDataMutations(text).invitationMutation
}

function patternBHits(text: string): string[] {
  const hits = patternBProfileSyncIndicators.filter((indicator) => text.includes(indicator))
  const profileMutation = inspectProfileMutations(text)
  if (profileMutation.generatedIdentity) {
    hits.push("locally generated profile identity")
  }
  if (profileMutation.found) {
    hits.push("profiles insert/upsert")
  }
  return hits
}

const clerkWebhookPath = "app/api/webhooks/clerk/route.ts"
if (exists(clerkWebhookPath)) {
  const webhookText = readCodeWithoutComments(path.join(root, clerkWebhookPath))
  const webhookHits = patternBHits(webhookText)
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
  const hits = patternBHits(text)
  if (hits.length > 0) {
    findings.push({
      rule: "R14",
      file: rel,
      detail: `Pattern B profile-mapping remnant must not appear outside the Clerk webhook: ${hits.join(", ")}`,
    })
  }
}

for (const file of codeFiles) {
  if (inspectInvitationMutations(readCodeWithoutComments(file))) {
    add("R16", file, "invitation inserts/upserts must use the create_case_invitation RPC")
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
