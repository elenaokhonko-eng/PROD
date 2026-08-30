'use client'

import { useQuery } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import type { CaseCapabilityBillingResponse } from '@/lib/billing/case-capabilities'
import type { CaseEntitlementPlan } from '@/lib/types/case'

export interface UsePaymentStatusOptions {
  enabled?: boolean
}

export interface PaymentStatusResult {
  plan: CaseEntitlementPlan | null
  updatedAt: string | null
  capabilityBilling: CaseCapabilityBillingResponse
}

export function usePaymentStatus(caseId: string | null | undefined, options?: UsePaymentStatusOptions) {
  const enabled = Boolean(caseId) && (options?.enabled ?? true)

  return useQuery({
    queryKey: caseId ? qk.entitlement(caseId) : ['entitlement', 'missing-case-id'],
    enabled,
    queryFn: async (): Promise<PaymentStatusResult> => {
      const response = await fetch(`/api/cases/${caseId}/capabilities`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => null)) as
        | (CaseCapabilityBillingResponse & { error?: string })
        | null

      if (!response.ok || !payload || payload.version !== 1) {
        throw new Error(payload?.error ?? 'Failed to load case capabilities')
      }

      const plan: CaseEntitlementPlan | null = payload.capabilities.fidrecPack.entitled
        ? 'escalation_pack'
        : payload.capabilities.report.entitled
          ? 'self_serve_report'
          : null

      return {
        plan,
        updatedAt: payload.generatedAt,
        capabilityBilling: payload,
      }
    },
    refetchInterval: (query) => {
      const capabilities = query.state.data?.capabilityBilling.capabilities
      if (!capabilities) return 2_000

      const fulfilmentPending =
        capabilities.report.checkoutInProgress ||
        capabilities.report.reconciliationRequired ||
        capabilities.fidrecPack.checkoutInProgress ||
        capabilities.fidrecPack.reconciliationRequired

      return fulfilmentPending ? 2_000 : false
    },
  })
}
