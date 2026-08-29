import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'
import { StateMachineErrorCard } from '@/components/state-machine/error-card'
import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'
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
  } catch {
    return (
      <DashboardFallback>
        <StateMachineErrorCard kind="internal" context="The signed-in account could not be loaded." />
      </DashboardFallback>
    )
  }

  if (!user) {
    return (
      <DashboardFallback>
        <StateMachineErrorCard
          kind="unauthorised"
          context="Sign in to continue to this case."
        />
      </DashboardFallback>
    )
  }

  let supabase: Awaited<ReturnType<typeof createUserClient>>
  try {
    supabase = await createUserClient()
  } catch {
    return (
      <DashboardFallback>
        <StateMachineErrorCard kind="unauthorised" context="The case service is not available right now." />
      </DashboardFallback>
    )
  }

  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .maybeSingle()

  if (caseError) {
    return (
      <DashboardFallback>
        <StateMachineErrorCard
          kind={caseError.code === '42501' ? 'rls_violation' : 'internal'}
          context="The case could not be loaded."
        />
      </DashboardFallback>
    )
  }

  if (!caseData) {
    return (
      <DashboardFallback>
        <StateMachineErrorCard
          kind="not_found"
          context="This case was not found or is not available to this account."
        />
      </DashboardFallback>
    )
  }

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
      initialCaseSnapshot={{
        institutionName: extract?.case_meta?.institution_name ?? caseData.institution_name ?? null,
        claimAmount: extractedAmount ?? coerceNumber(caseData.claim_amount),
      }}
      priceLabels={{
        report: `S$${PRODUCT_CATALOGUE.self_serve_report.amountSgd}`,
        tier2: `S$${PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd}`,
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
      <main className="container mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
