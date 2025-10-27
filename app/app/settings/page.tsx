import { createClient } from "@/lib/supabase/server"
import SettingsClient from "./_components/settings-client"

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  return <SettingsClient initialUser={user} initialProfile={profile} />
}
