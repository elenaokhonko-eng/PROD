import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import SettingsClient from './_components/settings-client'

export default async function SettingsPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.profileId)
    .single()

  return (
    <SettingsClient
      initialUser={{ id: user.profileId, email: user.email }}
      initialProfile={profile}
    />
  )
}
