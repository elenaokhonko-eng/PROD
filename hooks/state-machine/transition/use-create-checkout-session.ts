'use client'

import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@clerk/nextjs'

export type ProductKey = 'self_serve_report' | 'fidrec_tier2_pack' | 'human_consult_30m'

interface CreateCheckoutSessionResponse {
  url?: string | null
  error?: string
}

export interface CreateCheckoutSessionInput {
  caseId: string
  productKey: ProductKey
}

export function useCreateCheckoutSession() {
  const { getToken } = useAuth()

  return useMutation({
    mutationFn: async ({ caseId, productKey }: CreateCheckoutSessionInput) => {
      const token = await getToken({ template: 'supabase' })
      if (!token) {
        throw new Error('Missing Supabase token')
      }

      const response = await fetch('/api/payments/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ caseId, productKey }),
      })

      const json = (await response.json().catch(() => null)) as CreateCheckoutSessionResponse | null
      if (!response.ok) {
        throw new Error(json?.error ?? 'Failed to create checkout session')
      }

      if (!json?.url) {
        throw new Error('Checkout session did not return a redirect URL')
      }

      return { url: json.url }
    },
  })
}
