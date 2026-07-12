'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import { useSupabaseBrowser } from '@/hooks/state-machine/use-supabase-browser'
import type { CaseEntitlementPlan } from '@/lib/types/case'

export interface UsePaymentStatusOptions {
  enabled?: boolean
}

export interface PaymentStatusResult {
  plan: CaseEntitlementPlan | null
  updatedAt: string | null
}

export function usePaymentStatus(caseId: string | null | undefined, options?: UsePaymentStatusOptions) {
  const supabase = useSupabaseBrowser()
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  return useQuery({
    queryKey: caseId ? qk.entitlement(caseId) : ['entitlement', 'missing-case-id'],
    enabled,
    queryFn: async (): Promise<PaymentStatusResult> => {
      const { data, error } = await supabase
        .from('case_entitlements')
        .select('plan, features, updated_at')
        .eq('case_id', caseId as string)
        .maybeSingle()

      if (error) throw error
      const features = data?.features as Record<string, unknown> | null | undefined
      const allowsEscalationPack = features?.allow_escalation_pack === true
      const plan = (data?.plan as CaseEntitlementPlan | null) ?? null

      return {
        plan: allowsEscalationPack ? 'escalation_pack' : plan,
        updatedAt: data?.updated_at ?? null,
      }
    },
    refetchInterval: (query) => {
      const currentPlan = query.state.data?.plan ?? null
      if (currentPlan === 'self_serve_report' || currentPlan === 'escalation_pack') {
        return false
      }
      return 2_000
    },
  })
}
