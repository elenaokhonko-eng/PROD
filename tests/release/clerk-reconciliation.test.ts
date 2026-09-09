import assert from "node:assert/strict"
import test from "node:test"
import type { ClerkProfileProvisioningDependencies, ClerkProfileUser } from "../../lib/server/clerk-profile-provisioner"
import { parseReconciliationPlan, runReconciliation } from "../../scripts/reconcile-staging-clerk-profiles"

const allowlist = {
  userA: "user_fixtureA",
  userB: "user_fixtureB",
  deletionUser: "user_fixtureDeletion",
}

function safeEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    CLERK_SECRET_KEY: "sk_test_fixture_only",
    NEXT_PUBLIC_SUPABASE_URL: "https://yqqkkftfddxuxmpxwbcj.supabase.co",
    CLERK_RECONCILIATION_USER_ALLOWLIST_JSON: JSON.stringify(allowlist),
    ...overrides,
  }
}

function reconciliationDependencies() {
  const users = new Map<string, ClerkProfileUser>()
  Object.values(allowlist).forEach((id, index) => {
    users.set(id, {
      id,
      primaryEmailAddress: `fixture-${index}@example.test`,
      firstName: "Fixture",
      lastName: String(index),
      publicMetadata: { preserved: true },
    })
  })
  const mappings = new Map<string, string>()
  let provisionCount = 0
  const dependencies: ClerkProfileProvisioningDependencies = {
    getClerkUser: async (id) => structuredClone(users.get(id)!),
    findProfileId: async (id) => mappings.get(id) ?? null,
    provisionProfile: async ({ userId }) => {
      provisionCount += 1
      const profileId = `10000000-0000-4000-8000-00000000000${provisionCount}`
      mappings.set(userId, profileId)
      return profileId
    },
    setSupabaseUuid: async (id, profileId) => {
      const user = users.get(id)!
      user.publicMetadata = { ...user.publicMetadata, supabase_uuid: profileId }
    },
  }
  return { dependencies, mappings, users, provisionCount: () => provisionCount }
}

test("reconciliation is dry-run by default and requires exactly three labelled users", () => {
  const plan = parseReconciliationPlan([], safeEnvironment())
  assert.equal(plan.apply, false)
  assert.deepEqual(plan.users, allowlist)
})

test("dry-run inspects all allowlisted users without provisioning", async () => {
  const fixture = reconciliationDependencies()
  const results = await runReconciliation(parseReconciliationPlan([], safeEnvironment()), fixture.dependencies)
  assert.deepEqual(results, [
    { label: "userA", disposition: "requires_provisioning" },
    { label: "userB", disposition: "requires_provisioning" },
    { label: "deletionUser", disposition: "requires_provisioning" },
  ])
  assert.equal(fixture.provisionCount(), 0)
  assert.equal(fixture.mappings.size, 0)
})

test("explicit apply provisions only the three allowlisted users", async () => {
  const fixture = reconciliationDependencies()
  const results = await runReconciliation(
    parseReconciliationPlan(["--apply"], safeEnvironment()),
    fixture.dependencies,
  )
  assert.deepEqual(results.map((item) => item.label), ["userA", "userB", "deletionUser"])
  assert.ok(results.every((item) => item.disposition === "provisioned"))
  assert.equal(fixture.provisionCount(), 3)
  assert.equal(fixture.mappings.size, 3)
  for (const id of Object.values(allowlist)) {
    assert.equal(fixture.users.get(id)?.publicMetadata.preserved, true)
    assert.equal(typeof fixture.users.get(id)?.publicMetadata.supabase_uuid, "string")
  }
})

test("reconciliation refuses production Clerk and non-staging Supabase environments", () => {
  assert.throws(
    () => parseReconciliationPlan([], safeEnvironment({ CLERK_SECRET_KEY: "sk_live_fixture_only" })),
    /Development/,
  )
  assert.throws(
    () => parseReconciliationPlan([], safeEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co" })),
    /restricted to the staging/,
  )
})

test("reconciliation rejects broad, duplicate, malformed, or implicit selectors", () => {
  assert.throws(
    () => parseReconciliationPlan([], safeEnvironment({
      CLERK_RECONCILIATION_USER_ALLOWLIST_JSON: JSON.stringify({ ...allowlist, allUsers: "user_everyone" }),
    })),
    /exactly the three/,
  )
  assert.throws(
    () => parseReconciliationPlan([], safeEnvironment({
      CLERK_RECONCILIATION_USER_ALLOWLIST_JSON: JSON.stringify({ ...allowlist, userB: allowlist.userA }),
    })),
    /three distinct/,
  )
  assert.throws(
    () => parseReconciliationPlan([], safeEnvironment({
      CLERK_RECONCILIATION_USER_ALLOWLIST_JSON: JSON.stringify({ ...allowlist, deletionUser: "*" }),
    })),
    /one explicit Clerk user/,
  )
  assert.throws(() => parseReconciliationPlan(["--all"], safeEnvironment()), /Only one optional --apply/)
  assert.throws(() => parseReconciliationPlan(["--apply", "--apply"], safeEnvironment()), /Only one optional --apply/)
})
