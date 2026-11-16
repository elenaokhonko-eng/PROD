import { auth } from '@clerk/nextjs/server'
import { getCurrentUser } from '@/lib/auth'
import { provisionClerkProfileWithRuntimeDependencies } from '@/lib/server/clerk-profile-provisioner'

// A brand-new account can arrive before Clerk's user.created webhook has linked it to its profile, so its token has no
// supabase_uuid yet (G3b re-check, 11 Nov). Callers use `(await getCurrentUser()) ?? (await linkNewAccount())`, so a
// signed-in person is linked on the spot instead of being sent back to sign-in (smoke test, 12 Nov). Provisioning is
// idempotent, so racing the webhook is harmless.
export async function linkNewAccount() {
  const { userId } = await auth()
  if (!userId) return null
  try {
    await provisionClerkProfileWithRuntimeDependencies(userId)
  } catch (error) {
    console.warn('[auth] New account could not be linked yet', { name: (error as Error)?.name })
    return null
  }
  return getCurrentUser()
}
