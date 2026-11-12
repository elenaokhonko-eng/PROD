import { clerkClient } from "@clerk/nextjs/server"
import { createServiceClient } from "@/lib/supabase/service"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const clerkUserIdPattern = /^user_[A-Za-z0-9]{3,}$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type ClerkProfileUser = {
  id: string
  primaryEmailAddress: string | null
  firstName: string | null
  lastName: string | null
  publicMetadata: Record<string, unknown>
}

export type ClerkProfileProvisioningDependencies = {
  getClerkUser(userId: string): Promise<ClerkProfileUser>
  findProfileId(userId: string): Promise<string | null>
  provisionProfile(input: {
    userId: string
    email: string
    firstName: string | null
    lastName: string | null
  }): Promise<string>
  setSupabaseUuid(userId: string, profileId: string): Promise<void>
}

export type ClerkProfileMappingAssessment =
  | { disposition: "consistent"; profileId: string }
  | { disposition: "requires_metadata_repair"; profileId: string }
  | { disposition: "requires_provisioning" }

export class ClerkProfileProvisioningError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ClerkProfileProvisioningError"
  }
}

function requireClerkUserId(value: string): string {
  const userId = value.trim()
  if (!clerkUserIdPattern.test(userId) || userId.length > 128) {
    throw new ClerkProfileProvisioningError("Invalid Clerk user identity")
  }
  return userId
}

function optionalMetadataUuid(metadata: Record<string, unknown>): string | null {
  const value = metadata.supabase_uuid
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ClerkProfileProvisioningError("Conflicting Clerk profile mapping")
  }
  return value.toLowerCase()
}

function normalizeUser(user: ClerkProfileUser, expectedUserId: string) {
  if (requireClerkUserId(user.id) !== expectedUserId) {
    throw new ClerkProfileProvisioningError("Clerk user lookup returned an unexpected identity")
  }
  const email = user.primaryEmailAddress?.trim().toLowerCase() ?? ""
  if (!emailPattern.test(email) || email.length > 320) {
    throw new ClerkProfileProvisioningError("Clerk user requires a primary email address")
  }
  return {
    email,
    firstName: user.firstName?.trim().slice(0, 200) || null,
    lastName: user.lastName?.trim().slice(0, 200) || null,
    metadataProfileId: optionalMetadataUuid(user.publicMetadata),
  }
}

export async function assessClerkProfileMapping(
  inputUserId: string,
  dependencies: ClerkProfileProvisioningDependencies,
): Promise<ClerkProfileMappingAssessment> {
  const userId = requireClerkUserId(inputUserId)
  const [user, profileId] = await Promise.all([
    dependencies.getClerkUser(userId),
    dependencies.findProfileId(userId),
  ])
  const normalized = normalizeUser(user, userId)
  const canonicalProfileId = profileId?.toLowerCase() ?? null

  if (canonicalProfileId && !uuidPattern.test(canonicalProfileId)) {
    throw new ClerkProfileProvisioningError("Invalid database profile mapping")
  }
  if (normalized.metadataProfileId && normalized.metadataProfileId !== canonicalProfileId) {
    throw new ClerkProfileProvisioningError("Conflicting Clerk profile mapping")
  }
  if (!canonicalProfileId) return { disposition: "requires_provisioning" }
  if (!normalized.metadataProfileId) {
    return { disposition: "requires_metadata_repair", profileId: canonicalProfileId }
  }
  return { disposition: "consistent", profileId: canonicalProfileId }
}

export async function provisionClerkProfile(
  inputUserId: string,
  dependencies: ClerkProfileProvisioningDependencies,
): Promise<{ profileId: string; disposition: "consistent" | "provisioned" }> {
  const userId = requireClerkUserId(inputUserId)
  const initialAssessment = await assessClerkProfileMapping(userId, dependencies)
  if (initialAssessment.disposition === "consistent") {
    return { profileId: initialAssessment.profileId, disposition: "consistent" }
  }

  let profileId: string
  if (initialAssessment.disposition === "requires_metadata_repair") {
    profileId = initialAssessment.profileId
  } else {
    const user = await dependencies.getClerkUser(userId)
    const normalized = normalizeUser(user, userId)
    try {
      profileId = (await dependencies.provisionProfile({
        userId,
        email: normalized.email,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
      })).toLowerCase()
    } catch {
      throw new ClerkProfileProvisioningError("Database profile provisioning failed")
    }
    if (!uuidPattern.test(profileId)) {
      throw new ClerkProfileProvisioningError("Database profile provisioning returned an invalid identity")
    }
  }

  const beforeUpdate = normalizeUser(await dependencies.getClerkUser(userId), userId)
  if (beforeUpdate.metadataProfileId && beforeUpdate.metadataProfileId !== profileId) {
    throw new ClerkProfileProvisioningError("Conflicting Clerk profile mapping")
  }

  if (!beforeUpdate.metadataProfileId) {
    try {
      await dependencies.setSupabaseUuid(userId, profileId)
    } catch {
      throw new ClerkProfileProvisioningError("Clerk metadata update failed")
    }
  }

  const confirmed = normalizeUser(await dependencies.getClerkUser(userId), userId)
  if (confirmed.metadataProfileId !== profileId) {
    throw new ClerkProfileProvisioningError("Clerk metadata update could not be confirmed")
  }

  return { profileId, disposition: "provisioned" }
}

export async function createClerkProfileProvisioningDependencies(): Promise<ClerkProfileProvisioningDependencies> {
  const clerk = await clerkClient()
  const supabase = createServiceClient()

  return {
    getClerkUser: async (userId) => {
      const user = await clerk.users.getUser(userId)
      return {
        id: user.id,
        primaryEmailAddress: user.primaryEmailAddress?.emailAddress ?? null,
        firstName: user.firstName,
        lastName: user.lastName,
        publicMetadata: user.publicMetadata as Record<string, unknown>,
      }
    },
    findProfileId: async (userId) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("clerk_id", userId)
        .maybeSingle()
      if (error) throw new ClerkProfileProvisioningError("Database profile lookup failed")
      return data?.id ?? null
    },
    provisionProfile: async ({ userId, email, firstName, lastName }) => {
      const { data, error } = await supabase.rpc("provision_clerk_profile_v1", {
        p_clerk_id: userId,
        p_email: email,
        p_first_name: firstName,
        p_last_name: lastName,
      })
      if (error || typeof data !== "string") {
        throw new ClerkProfileProvisioningError("Database profile provisioning failed")
      }
      return data
    },
    setSupabaseUuid: async (userId, profileId) => {
      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: { supabase_uuid: profileId },
      })
    },
  }
}

export async function provisionClerkProfileWithRuntimeDependencies(userId: string) {
  return provisionClerkProfile(userId, await createClerkProfileProvisioningDependencies())
}
