import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'
import { StateMachineErrorCard } from '@/components/state-machine/error-card'
import { parseStage } from '@/lib/server/facts/facts-service'
import FactsClient from './_components/facts-client'

// Confirm your facts for one stage. Part C embeds the same panel in the dashboard flow before each generation.
export default async function CaseFactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ stage?: string }>
}) {
  const { id: caseId } = await params
  const stage = parseStage((await searchParams).stage ?? 'free') ?? 'free'

  const user = await getCurrentUser().catch(() => null)
  if (!user) {
    return (
      <Shell>
        <StateMachineErrorCard kind="unauthorised" context="Sign in to continue to this case." />
      </Shell>
    )
  }

  const supabase = await createUserClient()
  const { data: caseRow, error } = await supabase.from('cases').select('id, user_id').eq('id', caseId).maybeSingle()
  if (error || !caseRow) {
    return (
      <Shell>
        <StateMachineErrorCard kind={error ? 'internal' : 'not_found'} context="This case was not found or is not available to this account." />
      </Shell>
    )
  }
  if (caseRow.user_id !== user.supabaseUuid) {
    return (
      <Shell>
        <StateMachineErrorCard kind="unauthorised" context="Only the person who opened this case can confirm its facts." />
      </Shell>
    )
  }

  return (
    <Shell>
      <FactsClient caseId={caseId} stage={stage} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  )
}
