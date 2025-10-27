import { createClient } from "@/lib/supabase/server"
import DashboardClient from "./_components/dashboard-client"

export default async function UnifiedCaseDashboard({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const caseId = params.id

  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .eq("user_id", user.id)
    .single()

  if (caseError || !caseData) {
    return null
  }

  const { data: paymentData } = await supabase
    .from("payments")
    .select("*")
    .eq("case_id", caseId)
    .eq("user_id", user.id)
    .eq("payment_status", "completed")
    .maybeSingle()

  const { data: existingResponses } = await supabase
    .from("case_responses")
    .select("*")
    .eq("case_id", caseId)

  const { data: existingFiles } = await supabase
    .from("evidence")
    .select("id, filename, file_type, file_size, category")
    .eq("case_id", caseId)

  return (
    <DashboardClient
      caseId={caseId}
      initialUser={user}
      initialCase={caseData}
      initialPayment={paymentData ?? null}
      initialResponses={existingResponses ?? []}
      initialFiles={existingFiles ?? []}
    />
  )
}
