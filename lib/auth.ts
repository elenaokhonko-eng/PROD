import { auth, currentUser } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'

export type CurrentUser = {
  clerkId: string
  profileId: string
  email: string
}

export async function getOrCreateProfile(): Promise<CurrentUser | null> {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('clerk_id', userId)
    .single()

  if (profile) {
    return {
      clerkId: userId,
      profileId: profile.id,
      email: profile.email,
    }
  }

  // Profile not yet created by webhook; create it now as fallback
  const clerkUser = await currentUser()
  if (!clerkUser) return null

  const id = crypto.randomUUID()
  const email =
    clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId
    )?.emailAddress ?? ''

  const { error } = await supabase.from('profiles').insert({
    id,
    clerk_id: userId,
    email,
    first_name: clerkUser.firstName,
    last_name: clerkUser.lastName,
  })

  if (error) {
    console.error('[auth] failed to create profile fallback:', error.message)
    return null
  }

  return { clerkId: userId, profileId: id, email }
}
