import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'
import SettingsClient from './_components/settings-client'

export default async function SettingsPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const supabase = await createUserClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.supabaseUuid)
    .maybeSingle()

  return (
    <SettingsClient
      initialUser={{ id: user.supabaseUuid, email: profile?.email ?? '' }}
      initialProfile={profile}
    />
  )
}
