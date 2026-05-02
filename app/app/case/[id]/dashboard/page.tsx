import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'
import DashboardClient from './_components/dashboard-client'

export default async function UnifiedCaseDashboard({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const { id: caseId } = await params
  const supabase = await createUserClient()

  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .eq('user_id', user.supabaseUuid)
    .single()

  if (caseError || !caseData) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', user.supabaseUuid)
    .maybeSingle()

  return (
    <DashboardClient
      caseId={caseId}
      initialUser={{ id: user.supabaseUuid, email: profile?.email ?? '' }}
    />
  )
}
