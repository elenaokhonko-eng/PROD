import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'
import { SiteHeader } from '@/components/site-header'
import { StateMachineErrorCard } from '@/components/state-machine/error-card'
import DashboardClient from './_components/dashboard-client'

export default async function UnifiedCaseDashboard({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: caseId } = await params

  let user: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    user = await getCurrentUser()
  } catch (error) {
    return (
      <DashboardFallback>
        <StateMachineErrorCard kind="internal" context={error instanceof Error ? error.message : String(error)} />
      </DashboardFallback>
    )
  }

  if (!user) {
    return (
      <DashboardFallback>
        <StateMachineErrorCard
          kind="unauthorised"
          context="No Clerk session or missing Supabase JWT was available to the dashboard server route."
        />
      </DashboardFallback>
    )
  }

  let supabase: Awaited<ReturnType<typeof createUserClient>>
  try {
    supabase = await createUserClient()
  } catch (error) {
    return (
      <DashboardFallback>
        <StateMachineErrorCard kind="unauthorised" context={error instanceof Error ? error.message : String(error)} />
      </DashboardFallback>
    )
  }

  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .eq('user_id', user.supabaseUuid)
    .maybeSingle()

  if (caseError) {
    return (
      <DashboardFallback>
        <StateMachineErrorCard
          kind={caseError.code === '42501' ? 'rls_violation' : 'internal'}
          context={`${caseError.code ?? 'unknown'}: ${caseError.message}`}
        />
      </DashboardFallback>
    )
  }

  if (!caseData) {
    return (
      <DashboardFallback>
        <StateMachineErrorCard
          kind="not_found"
          context={`No case row returned for case ${caseId} and Supabase UUID ${user.supabaseUuid}.`}
        />
      </DashboardFallback>
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', user.supabaseUuid)
    .maybeSingle()

  const { data: latestExtract } = await supabase
    .from('case_extract_runs')
    .select('extract_json')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const extract = (latestExtract?.extract_json ?? null) as
    | {
        reported_loss?: { amount?: number | string | null }
        losses?: { reported_loss?: { amount?: number | string | null } } | Array<{ amount?: number | string | null }>
        case_meta?: { claim_amount?: number | string | null; institution_name?: string | null }
      }
    | null
  const extractedAmount = extractReportedLossAmount(extract)

  return (
    <DashboardClient
      caseId={caseId}
      initialUser={{ id: user.supabaseUuid, email: profile?.email ?? '' }}
      initialCaseSnapshot={{
        institutionName: extract?.case_meta?.institution_name ?? caseData.institution_name ?? null,
        claimAmount: extractedAmount ?? coerceNumber(caseData.claim_amount),
      }}
    />
  )
}

function extractReportedLossAmount(
  extract:
    | {
        reported_loss?: { amount?: number | string | null }
        losses?: { reported_loss?: { amount?: number | string | null } } | Array<{ amount?: number | string | null }>
        case_meta?: { claim_amount?: number | string | null }
      }
    | null,
): number | null {
  return (
    coerceNumber(extract?.reported_loss?.amount) ??
    coerceNumber(Array.isArray(extract?.losses) ? extract.losses[0]?.amount : extract?.losses?.reported_loss?.amount) ??
    coerceNumber(extract?.case_meta?.claim_amount)
  )
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function DashboardFallback({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="container mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
