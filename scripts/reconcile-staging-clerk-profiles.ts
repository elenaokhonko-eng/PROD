import {
  assessClerkProfileMapping,
  createClerkProfileProvisioningDependencies,
  provisionClerkProfile,
  type ClerkProfileProvisioningDependencies,
} from "../lib/server/clerk-profile-provisioner"

const stagingSupabaseHost = "yqqkkftfddxuxmpxwbcj.supabase.co"
const labels = ["userA", "userB", "deletionUser"] as const
const clerkUserIdPattern = /^user_[A-Za-z0-9]{3,}$/

type Label = (typeof labels)[number]
type Environment = Record<string, string | undefined>

export type ReconciliationPlan = {
  apply: boolean
  users: Record<Label, string>
}

function requiredEnvironment(environment: Environment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function parseReconciliationPlan(
  args: string[],
  environment: Environment,
): ReconciliationPlan {
  if (args.some((arg) => arg !== "--apply") || args.filter((arg) => arg === "--apply").length > 1) {
    throw new Error("Only one optional --apply flag is accepted")
  }

  const clerkSecretKey = requiredEnvironment(environment, "CLERK_SECRET_KEY")
  if (!clerkSecretKey.startsWith("sk_test_") || clerkSecretKey.startsWith("sk_live_")) {
    throw new Error("Reconciliation requires a Clerk Development secret key")
  }

  let supabaseUrl: URL
  try {
    supabaseUrl = new URL(requiredEnvironment(environment, "NEXT_PUBLIC_SUPABASE_URL"))
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL")
  }
  if (supabaseUrl.protocol !== "https:" || supabaseUrl.hostname.toLowerCase() !== stagingSupabaseHost) {
    throw new Error("Reconciliation is restricted to the staging Supabase project")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(requiredEnvironment(environment, "CLERK_RECONCILIATION_USER_ALLOWLIST_JSON"))
  } catch {
    throw new Error("The reconciliation allowlist must be valid JSON")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The reconciliation allowlist must be a labelled object")
  }

  const record = parsed as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !== [...labels].sort().join(",")) {
    throw new Error("The reconciliation allowlist must contain exactly the three disposable labels")
  }

  const users = Object.fromEntries(labels.map((label) => [label, record[label]])) as Record<Label, unknown>
  for (const label of labels) {
    if (typeof users[label] !== "string" || !clerkUserIdPattern.test(users[label])) {
      throw new Error(`The ${label} selector must be one explicit Clerk user identity`)
    }
  }
  const userIds = labels.map((label) => users[label] as string)
  if (new Set(userIds).size !== labels.length) {
    throw new Error("The reconciliation allowlist must contain three distinct users")
  }

  return {
    apply: args.includes("--apply"),
    users: users as Record<Label, string>,
  }
}

export async function runReconciliation(
  plan: ReconciliationPlan,
  dependencies: ClerkProfileProvisioningDependencies,
): Promise<Array<{ label: Label; disposition: string }>> {
  const results: Array<{ label: Label; disposition: string }> = []
  for (const label of labels) {
    const userId = plan.users[label]
    if (plan.apply) {
      const result = await provisionClerkProfile(userId, dependencies)
      results.push({ label, disposition: result.disposition })
    } else {
      const result = await assessClerkProfileMapping(userId, dependencies)
      results.push({ label, disposition: result.disposition })
    }
  }
  return results
}

async function main() {
  const plan = parseReconciliationPlan(process.argv.slice(2), process.env)
  const results = await runReconciliation(plan, await createClerkProfileProvisioningDependencies())
  for (const result of results) console.log(`${result.label}: ${result.disposition}`)
}

const entryPoint = process.argv[1]?.replace(/\\/g, "/")
if (entryPoint?.endsWith("/reconcile-staging-clerk-profiles.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Reconciliation failed")
    process.exitCode = 1
  })
}
