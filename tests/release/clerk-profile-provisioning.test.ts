import assert from "node:assert/strict"
import test from "node:test"
import {
  provisionClerkProfile,
  type ClerkProfileProvisioningDependencies,
  type ClerkProfileUser,
} from "../../lib/server/clerk-profile-provisioner"

const userId = "user_fixtureA"
const otherUserId = "user_fixtureB"
const profileId = "10000000-0000-4000-8000-000000000001"
const conflictingProfileId = "20000000-0000-4000-8000-000000000002"

function createFixture(overrides?: {
  metadataProfileId?: string
  mappedProfileId?: string
  failMetadataUpdates?: number
  provisioningDelayMs?: number
}) {
  const users = new Map<string, ClerkProfileUser>([
    [userId, {
      id: userId,
      primaryEmailAddress: "USER-A@EXAMPLE.TEST",
      firstName: " User ",
      lastName: " A ",
      publicMetadata: {
        release_fixture: true,
        ...(overrides?.metadataProfileId ? { supabase_uuid: overrides.metadataProfileId } : {}),
      },
    }],
    [otherUserId, {
      id: otherUserId,
      primaryEmailAddress: "user-b@example.test",
      firstName: "User",
      lastName: "B",
      publicMetadata: {},
    }],
  ])
  const mappings = new Map<string, string>()
  if (overrides?.mappedProfileId) mappings.set(userId, overrides.mappedProfileId)
  let provisionCalls = 0
  let metadataUpdates = 0
  let remainingUpdateFailures = overrides?.failMetadataUpdates ?? 0

  const dependencies: ClerkProfileProvisioningDependencies = {
    getClerkUser: async (requestedUserId) => structuredClone(users.get(requestedUserId)!),
    findProfileId: async (requestedUserId) => mappings.get(requestedUserId) ?? null,
    provisionProfile: async (input) => {
      provisionCalls += 1
      assert.equal(input.email, "user-a@example.test")
      assert.equal(input.firstName, "User")
      assert.equal(input.lastName, "A")
      if (overrides?.provisioningDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, overrides.provisioningDelayMs))
      }
      const existing = mappings.get(input.userId)
      if (existing) return existing
      mappings.set(input.userId, profileId)
      return profileId
    },
    setSupabaseUuid: async (requestedUserId, requestedProfileId) => {
      metadataUpdates += 1
      if (remainingUpdateFailures > 0) {
        remainingUpdateFailures -= 1
        throw new Error("fixture metadata failure")
      }
      const user = users.get(requestedUserId)!
      user.publicMetadata = { ...user.publicMetadata, supabase_uuid: requestedProfileId }
    },
  }

  return {
    dependencies,
    users,
    mappings,
    counts: () => ({ provisionCalls, metadataUpdates }),
  }
}

test("first delivery provisions one profile and preserves unrelated Clerk metadata", async () => {
  const fixture = createFixture()
  const result = await provisionClerkProfile(userId, fixture.dependencies)
  assert.deepEqual(result, { profileId, disposition: "provisioned" })
  assert.equal(fixture.mappings.get(userId), profileId)
  assert.deepEqual(fixture.users.get(userId)?.publicMetadata, {
    release_fixture: true,
    supabase_uuid: profileId,
  })
  assert.deepEqual(fixture.counts(), { provisionCalls: 1, metadataUpdates: 1 })
})

test("replayed delivery reuses the durable mapping without another write", async () => {
  const fixture = createFixture()
  await provisionClerkProfile(userId, fixture.dependencies)
  const replay = await provisionClerkProfile(userId, fixture.dependencies)
  assert.deepEqual(replay, { profileId, disposition: "consistent" })
  assert.deepEqual(fixture.counts(), { provisionCalls: 1, metadataUpdates: 1 })
})

test("concurrent deliveries converge on one profile UUID", async () => {
  const fixture = createFixture({ provisioningDelayMs: 10 })
  const [first, second] = await Promise.all([
    provisionClerkProfile(userId, fixture.dependencies),
    provisionClerkProfile(userId, fixture.dependencies),
  ])
  assert.equal(first.profileId, profileId)
  assert.equal(second.profileId, profileId)
  assert.equal(fixture.mappings.size, 1)
  assert.equal(fixture.users.get(userId)?.publicMetadata.supabase_uuid, profileId)
})

test("a failed Clerk metadata write can retry against the same database UUID", async () => {
  const fixture = createFixture({ failMetadataUpdates: 1 })
  await assert.rejects(() => provisionClerkProfile(userId, fixture.dependencies), /metadata update failed/)
  assert.equal(fixture.mappings.get(userId), profileId)
  assert.equal(fixture.users.get(userId)?.publicMetadata.supabase_uuid, undefined)

  const retry = await provisionClerkProfile(userId, fixture.dependencies)
  assert.equal(retry.profileId, profileId)
  assert.equal(fixture.users.get(userId)?.publicMetadata.supabase_uuid, profileId)
  assert.deepEqual(fixture.counts(), { provisionCalls: 1, metadataUpdates: 2 })
})

test("matching pre-existing mappings are accepted without mutation", async () => {
  const fixture = createFixture({ metadataProfileId: profileId, mappedProfileId: profileId })
  const result = await provisionClerkProfile(userId, fixture.dependencies)
  assert.deepEqual(result, { profileId, disposition: "consistent" })
  assert.deepEqual(fixture.counts(), { provisionCalls: 0, metadataUpdates: 0 })
})

test("conflicting or orphaned Clerk metadata fails before database creation", async () => {
  const conflict = createFixture({ metadataProfileId: conflictingProfileId, mappedProfileId: profileId })
  await assert.rejects(() => provisionClerkProfile(userId, conflict.dependencies), /Conflicting Clerk profile mapping/)
  assert.deepEqual(conflict.counts(), { provisionCalls: 0, metadataUpdates: 0 })

  const orphan = createFixture({ metadataProfileId: conflictingProfileId })
  await assert.rejects(() => provisionClerkProfile(userId, orphan.dependencies), /Conflicting Clerk profile mapping/)
  assert.equal(orphan.mappings.size, 0)
  assert.deepEqual(orphan.counts(), { provisionCalls: 0, metadataUpdates: 0 })
})
