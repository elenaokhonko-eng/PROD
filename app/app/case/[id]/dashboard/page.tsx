import { getOrCreateProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import DashboardClient from './_components/dashboard-client'

export default async function UnifiedCaseDashboard({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getOrCreateProfile()
  if (!user) return null

  const { id: caseId } = await params
  const supabase = await createClient()

  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .eq('user_id', user.profileId)
    .single()

  if (caseError || !caseData) return null

  const { data: paymentData } = await supabase
    .from('payments')
    .select('*')
    .eq('case_id', caseId)
    .eq('user_id', user.profileId)
    .eq('payment_status', 'completed')
    .maybeSingle()

  const { data: existingResponses } = await supabase
    .from('case_responses')
    .select('*')
    .eq('case_id', caseId)

  const { data: existingFiles } = await supabase
    .from('evidence')
    .select('id, filename, file_type, file_size, category')
    .eq('case_id', caseId)

  return (
    <DashboardClient
      caseId={caseId}
      initialUser={{ id: user.profileId, email: user.email }}
      initialCase={caseData}
      initialPayment={paymentData ?? null}
      initialResponses={existingResponses ?? []}
      initialFiles={existingFiles ?? []}
    />
  )
}
