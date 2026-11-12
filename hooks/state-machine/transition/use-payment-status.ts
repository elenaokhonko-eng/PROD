'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@clerk/nextjs'
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
  const { getToken, isLoaded } = useAuth()
  // Wait for Clerk so the first call can refresh an expired session cookie (see queryFn).
  const enabled = Boolean(caseId) && isLoaded && (options?.enabled ?? true)

  return useQuery({
    queryKey: caseId ? qk.entitlement(caseId) : ['entitlement', 'missing-case-id'],
    enabled,
    queryFn: async (): Promise<PaymentStatusResult> => {
      // The route authenticates with Clerk's __session cookie, which expires after about a minute. A dashboard opened
      // from an idle tab would otherwise send the expired cookie (401). getToken() refreshes it when expired; if the
      // cookie still loses a race, force a fresh token and retry once.
      await getToken()
      const load = () =>
        fetch(`/api/cases/${caseId}/capabilities`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
      let response = await load()
      if (response.status === 401) {
        await getToken({ skipCache: true })
        response = await load()
      }
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
