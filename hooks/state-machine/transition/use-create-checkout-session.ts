'use client'

import { useMutation } from '@tanstack/react-query'

interface CreateCheckoutSessionResponse {
  url?: string | null
  error?: string
}

export interface CreateCheckoutSessionInput {
  caseId: string
}

export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: async ({ caseId }: CreateCheckoutSessionInput) => {
      const response = await fetch('/api/payments/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId }),
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
